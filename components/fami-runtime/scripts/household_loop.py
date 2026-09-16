"""Private, one-shot household ledger. No model calls, scheduler or worker launcher.

The caller is the trusted Fami control plane. JSON and artifacts are data, never
executable instructions. See notes/household-loop.md for the trust boundary.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

VERSION = 1
REPO = Path(__file__).resolve().parents[1]
MAX_BYTES = 1024 * 1024
TERMINAL = {"complete", "cancelled"}


class Denied(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Denied(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def number(value, minimum=0, maximum=10**15):
    require(type(value) in (int, float) and math.isfinite(value)
            and minimum <= value <= maximum, "invalid finite numeric value")
    return value


def ident(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,96}", value), "invalid identifier")
    return value


def brief(value):
    require(isinstance(value, str) and 0 < len(value) <= 2000, "use a brief reference/summary")
    return value


def safe_json(value):
    # A minimization check, not a general secret/PII detector.
    banned = {"raw_chat", "raw_email", "messages", "credentials", "password",
              "access_token", "refresh_token", "cookie", "accountid", "account_id"}
    def visit(x):
        if isinstance(x, dict):
            require(not (set(k.lower() for k in x) & banned), "raw/private field is not accepted")
            for v in x.values():
                visit(v)
        elif isinstance(x, list):
            for v in x:
                visit(v)
        elif isinstance(x, str):
            require(len(x) <= 8000, "store source material outside the ledger")
    visit(value)
    require(len(canonical(value)) <= 128000, "input too large")


def plain_path(path, exists=True):
    """Reject redirects on every existing ancestor, including Windows junctions."""
    p = Path(os.path.abspath(path))
    require(not str(p).startswith("\\\\"), "network/device paths are unsupported")
    for part in [*reversed(p.parents), p]:
        try:
            s = part.lstat()
        except FileNotFoundError:
            continue
        require(not stat.S_ISLNK(s.st_mode) and not
                (getattr(s, "st_file_attributes", 0) & 0x400), "redirected path")
        if stat.S_ISREG(s.st_mode):
            require(s.st_nlink == 1, "hard-linked file")
    require(not exists or p.exists(), "required path missing")
    # Windows short names and alternate casing must not bypass root/protected
    # comparisons. Redirects were rejected above; resolve expands native aliases.
    return p.resolve(strict=exists)


def inside(path, root):
    return path == root or root in path.parents


def relative(root, value, exists=True):
    require(isinstance(value, str) and value and "\\" not in value and ":" not in value,
            "use a plain relative path with forward slashes")
    parts = value.split("/")
    require(all(p not in ("", ".", "..") and not p.endswith((".", " "))
                and not re.fullmatch(r"(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?", p)
                for p in parts), "unsafe path component")
    p = plain_path(root / value, exists)
    require(inside(p, root) and p != root, "path outside root")
    return p


def read_bytes(path):
    p = plain_path(path)
    require(p.is_file() and p.stat().st_size <= MAX_BYTES, "only bounded regular files are supported")
    return p.read_bytes()


def read_json(path):
    try:
        return json.loads(read_bytes(path))
    except (ValueError, UnicodeError):
        raise Denied("invalid JSON") from None


def durable_write(path, data):
    """Exclusive creation, never overwrites an existing operational record."""
    plain_path(path, False)
    with open(path, "xb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())


def controls(policy):
    text = read_bytes(policy["controls_path"]).decode("utf-8-sig")
    sections = text.split("## CONTROL BLOCK")
    require(len(sections) == 2, "missing/ambiguous control block")
    block = re.split(r"\r?\n## ", sections[1])[0]
    a = re.findall(r"^- \*\*Authority: (ACTIVE|DRAFT|STOOD DOWN)\*\*", block, re.M)
    c = re.findall(r"^- \*\*Clock: (ON|OFF)\*\*", block, re.M)
    require(len(a) == len(c) == 1, "invalid/ambiguous controls")
    pause = read_json(policy["pause_path"])
    require(type(pause.get("paused")) is bool, "unknown pause state")
    require(a == ["ACTIVE"] and c == ["ON"] and pause["paused"] is False,
            "admissions and effects blocked by controls/pause")


class Ledger:
    def __init__(self, home, now=None):
        self.home = plain_path(home)
        require(inside(self.home, REPO / ".private"), "ledger home must be under this repository's .private")
        self.now = now or time.time
        self.policy = read_json(self.home / "policy.json")
        self.policy_hash = digest(read_bytes(self.home / "policy.json"))
        plain_path(self.home / "ledger.sqlite3")
        for suffix in ("-journal", "-wal", "-shm"):
            plain_path(self.home / ("ledger.sqlite3" + suffix), False)
        self.db = sqlite3.connect(self.home / "ledger.sqlite3", timeout=10, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.check_policy()

    def close(self):
        self.db.close()

    def check_policy(self):
        row = self.db.execute("SELECT value FROM meta WHERE key='policy_hash'").fetchone()
        require(row and row[0] == self.policy_hash == digest(read_bytes(self.home / "policy.json")),
                "policy changed; explicit migration/requalification required")
        require(self.db.execute("SELECT value FROM meta WHERE key='version'").fetchone()[0] == str(VERSION),
                "unsupported ledger version")
        pending = self.db.execute("SELECT value FROM meta WHERE key='migration_pending'").fetchone()
        require(not pending or pending[0] == "false", "destination migration incomplete; retain original home")

    @contextlib.contextmanager
    def tx(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.check_policy()
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def get(self, table, key):
        row = self.db.execute(f"SELECT data FROM {table} WHERE id=?", (key,)).fetchone()
        require(row is not None, f"unknown {table} record")
        return json.loads(row[0])

    def all(self, table):
        return [json.loads(r[0]) for r in self.db.execute(f"SELECT data FROM {table} ORDER BY id")]

    def put(self, table, key, value):
        self.db.execute(f"INSERT INTO {table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                        (key, canonical(value)))

    def event(self, kind, reference, details=None):
        self.db.execute("INSERT INTO events(at,kind,reference,data) VALUES(?,?,?,?)",
                        (self.now(), kind, reference, canonical(details or {})))

    def authority(self, responsibility):
        controls(self.policy)
        grant = self.policy["grants"].get(responsibility["authority"])
        require(grant is not None, "authority not allowlisted")
        require(grant["project"] == responsibility["project"], "authority/project mismatch")
        require(digest(read_bytes(grant["path"])) == grant["sha256"], "authority revision changed")
        require(responsibility["active"] is True, "responsibility parked")
        return grant

    def revisions(self, r):
        paths = r["sources"] + [r["method_path"]]
        return {p: digest(read_bytes(p)) for p in paths}

    def job_revisions_valid(self, j, r):
        # The assigned method is an immutable snapshot. A new method affects later
        # jobs; it does not silently change a running worker's assignment.
        require(digest(read_bytes(self.home / j["method_snapshot"])) == j["method_revision"],
                "pinned method snapshot changed")
        for p in r["sources"]:
            require(digest(read_bytes(p)) == j["source_revisions"][p], "source revision changed")

    def project(self, r):
        require(r["project"] in self.policy["projects"], "unconfigured project")
        return self.policy["projects"][r["project"]]

    def responsibility(self, x):
        safe_json(x)
        for key in ("id", "project", "authority"):
            ident(x[key])
        for key in ("trigger", "definition_of_done", "burden_to_remove"):
            brief(x[key])
        require(type(x["active"]) is bool, "active must be explicit")
        number(x["next_due"])
        number(x["deadline"])
        number(x["interval_seconds"], 1)
        require(isinstance(x["sources"], list) and len(x["sources"]) <= 32, "invalid sources")
        self.project(x)
        for p in x["sources"] + [x["method_path"]]:
            plain_path(p)
        with self.tx():
            prior = next((r for r in self.all("responsibilities") if r["id"] == x["id"]), None)
            if prior:
                require(not any(j["responsibility"] == x["id"] and j["state"] not in TERMINAL
                                for j in self.all("jobs")), "active job pins responsibility")
                x["last_revisions"] = prior.get("last_revisions")
                x["source_generation"] = prior.get("source_generation", 0)
            self.put("responsibilities", x["id"], x)
            self.event("responsibility", x["id"])
        return {"responsibility": x["id"]}

    def heartbeat(self, x):
        """Reconcile missed occurrences into ONE candidate with a full denominator."""
        ident(x["id"])
        with self.tx():
            prior = self.db.execute("SELECT data FROM wakes WHERE id=?", (x["id"],)).fetchone()
            if prior:
                return json.loads(prior[0])
            blocked = None
            try:
                controls(self.policy)
            except (Denied, OSError):
                blocked = "controls/pause unavailable or stopped"
            due, unknown = [], []
            for r in self.all("responsibilities"):
                if not r["active"]:
                    continue
                try:
                    revisions = self.revisions(r)
                except (OSError, Denied):
                    unknown.append(r["id"])
                    revisions = None
                changed = revisions is not None and r.get("last_revisions") not in (None, revisions)
                missed = 0
                if self.now() >= r["next_due"]:
                    missed = int((self.now() - r["next_due"]) // r["interval_seconds"]) + 1
                    first = r["next_due"]
                    occurrence = digest(f'{r["id"]}:{first}'.encode())[:24]
                    r["next_due"] += missed * r["interval_seconds"]
                elif changed:
                    generation = r.get("source_generation", 0) + 1
                    r["source_generation"] = generation
                    occurrence = digest((r["id"] + str(generation) + canonical(revisions)).encode())[:24]
                else:
                    r["last_revisions"] = revisions or r.get("last_revisions")
                    self.put("responsibilities", r["id"], r)
                    continue
                row = {"id": occurrence, "responsibility": r["id"], "noticed_at": self.now(),
                       "eligible_count": missed or 1, "missed_detection_count": max(0, missed - 1),
                       "source_changed": changed, "state": "pending", "decision": blocked,
                       "deadline": r["deadline"], "job": None}
                # Never silently discard a due occurrence when another owner is busy.
                if not self.db.execute("SELECT 1 FROM opportunities WHERE id=?", (occurrence,)).fetchone():
                    self.put("opportunities", occurrence, row)
                due.append(occurrence)
                r["last_revisions"] = revisions or r.get("last_revisions")
                self.put("responsibilities", r["id"], r)
            check = []
            for j in self.all("jobs"):
                if j["state"] in TERMINAL:
                    continue
                if blocked:
                    if not j["stop_requested"]:
                        j["control_generation"] += 1
                    j["result_validation"] = None
                    j["stop_requested"] = True
                if self.now() >= j["next_check"] and not j["terminal_at"]:
                    j["worker_state"] = "unknown"
                    j["check_backoff"] = min(j["check_backoff"] * 2, 3600)
                    j["next_check"] = self.now() + j["check_backoff"]
                    check.append(j["id"])
                self.put("jobs", j["id"], j)
            result = {"wake": x["id"], "new_opportunities": due, "unknown_sources": unknown,
                      "due_worker_checks": check, "admission_block": blocked,
                      "stop_requests": [j["id"] for j in self.all("jobs") if j["stop_requested"]
                                        and not j["terminal_at"]],
                      "computation_stopped": "requires native terminal evidence"}
            self.put("wakes", x["id"], result)
            return result

    def usage(self, x):
        """Retain only normalized quota fields; never store the raw app response."""
        pool = ident(x["pool"])
        p = self.policy["pools"][pool]
        observed = number(x["observed_at"])
        require(observed <= self.now() + 5, "future quota timestamp")
        normalized, error = [], None
        try:
            require(x["format"] == p["format"], "unsupported quota format")
            if x["format"] == "native_codex":
                data = x["snapshot"]
                # Presence of multi-bucket data controls; do not fall back from an empty map.
                buckets = data.get("rateLimitsByLimitId")
                bucket = (buckets.get(p["native_limit_id"]) if buckets is not None
                          else data.get("rateLimits"))
                require(isinstance(bucket, dict) and bucket.get("limitId") == p["native_limit_id"],
                        "missing applicable native pool")
                require(not bucket.get("spendControlReached") and not bucket.get("rateLimitReachedType"),
                        "native capacity blocked")
                for name in ("primary", "secondary"):
                    w = bucket.get(name)
                    if w is None:
                        continue
                    normalized.append({"window": str(number(w.get("windowDurationMins"), 1)),
                                       "used_percent": number(w.get("usedPercent"), 0, 100),
                                       "resets_at": number(w.get("resetsAt"), self.now() + 1)})
            elif x["format"] == "account_windows":
                require(x.get("scope") == "account_wide" and x.get("supported") is True,
                        "quota must cover the entire account")
                for w in x["windows"]:
                    normalized.append({"window": str(number(w["window_minutes"], 1)),
                                       "used_percent": number(w.get("used_percent"), 0, 100),
                                       "resets_at": number(w.get("resets_at"), self.now() + 1)})
            else:
                raise Denied("unsupported quota format")
            names = [w["window"] for w in normalized]
            require(len(names) == len(set(names)), "ambiguous quota windows")
            require(p["coverage_verified"] is True and set(p["required_windows"]) <= set(names),
                    "all applicable windows are not verified/present")
        except (Denied, KeyError, TypeError):
            error = "unknown, incomplete, blocked or unsupported quota snapshot"
            normalized = []
        with self.tx():
            old = next((s for s in self.all("usage") if s["id"] == pool), None)
            require(not old or observed > old["observed_at"], "out-of-order quota snapshot")
            continuity = (old.get("continuity", old["windows"]) if old else [])
            if old and not error:
                old_windows = {w["window"]: w for w in continuity}
                for w in normalized:
                    before = old_windows.get(w["window"])
                    if before and before["resets_at"] > self.now():
                        if (before["resets_at"] != w["resets_at"] or
                                w["used_percent"] < before["used_percent"]):
                            error = "unexpected quota decrease/reset; explicit reconciliation required"
            row = {"id": pool, "observed_at": observed, "windows": normalized, "error": error,
                   "continuity": continuity if error else normalized}
            self.put("usage", pool, row)
            self.event("usage", pool, {"observed_at": observed, "error": error})
        return row

    def quota(self, route_name, estimates, exclude=None, not_before=0):
        route = self.policy["routes"].get(route_name)
        require(route and route["qualified"] is True, "route is not qualified")
        require(set(estimates) == set(route["pools"]), "estimate must cover every shared pool")
        reservations = [j for j in self.all("jobs") if not j["reservation_released"] and j["id"] != exclude]
        report = []
        for pool in route["pools"]:
            p = self.policy["pools"][pool]
            s = self.get("usage", pool)
            require(not s["error"] and 0 <= self.now() - s["observed_at"] <= p["max_age_seconds"]
                    and s["observed_at"] > not_before, "unknown/stale quota at phase boundary")
            require(set(estimates[pool]) == {w["window"] for w in s["windows"]},
                    "estimate must cover every observed window")
            for w in s["windows"]:
                require(w["resets_at"] > self.now(), "quota reset requires fresh observation")
                v = estimates[pool][w["window"]]
                require(set(v) == {"whole_job_percent", "controller_percent", "uncertainty_percent"},
                        "invalid estimate components")
                cost = sum(number(v[k], 0, 100) for k in
                           ("whole_job_percent", "controller_percent", "uncertainty_percent"))
                require(v["uncertainty_percent"] > 0, "uncertainty buffer is required")
                held = 0
                for j in reservations:
                    if pool in j["estimates"]:
                        old = j["estimates"][pool].get(w["window"])
                        require(old is not None, "new quota window needs reservation reconciliation")
                        held += sum(old.values())
                projected = w["used_percent"] + held + cost + p["inflight_buffer_percent"]
                require(projected <= 60, "40 percent unused reserve would be breached")
                report.append({"pool": pool, "window": w["window"], "projected_percent": projected,
                               "observed_at": s["observed_at"], "attribution": "account-wide; task cost uncertain"})
        return report

    def admit(self, x):
        safe_json(x)
        for k in ("job", "owner", "occurrence", "route"):
            ident(x[k])
        with self.tx():
            existing = self.db.execute("SELECT data FROM jobs WHERE id=?", (x["job"],)).fetchone()
            if existing:
                j = json.loads(existing[0])
                require(j["admission_hash"] == digest(canonical(x).encode()), "job ID already claimed")
                return {"job": j["id"], "state": j["state"], "duplicate": True}
            op = self.get("opportunities", x["occurrence"])
            require(op["job"] is None, "occurrence already owned")
            require(op["state"] == "pending", "opportunity is blocked/closed; reconcile its decision first")
            r = self.get("responsibilities", op["responsibility"])
            self.authority(r)
            active = [j for j in self.all("jobs") if j["state"] not in TERMINAL]
            require(not any(j["project"] == r["project"] for j in active), "project already owned")
            require(sum(not j["terminal_at"] for j in active) < 3, "three worker limit")
            require(not any(j["owner"] == x["owner"] and not j["terminal_at"] for j in active),
                    "worker already assigned")
            route = self.policy["routes"].get(x["route"])
            require(route and x["model"] == route["model"], "selected model mismatch")
            require(route["worker_effects"] == "isolated_only", "mutating workers are not qualified")
            require(x.get("whole_job_estimate") is True, "estimate must include complete delivery/correction")
            report = self.quota(x["route"], x["estimates"])
            revisions = self.revisions(r)
            method_snapshot = f'inbox/method-{x["job"]}-{uuid.uuid4().hex}.bin'
            durable_write(self.home / method_snapshot, read_bytes(r["method_path"]))
            j = {"id": x["job"], "owner": x["owner"], "occurrence": x["occurrence"],
                 "responsibility": r["id"], "project": r["project"], "route": x["route"],
                 "model": x["model"], "estimates": x["estimates"], "source_revisions": revisions,
                 "method_revision": revisions[r["method_path"]], "method_snapshot": method_snapshot, "state": "admitted",
                 "admission_hash": digest(canonical(x).encode()), "admitted_at": self.now(),
                 "phase_at": self.now(), "worker_state": "unknown", "terminal_at": None,
                 "reservation_released": False, "stop_requested": False,
                 "control_generation": 0, "result_validation": None,
                 "next_check": self.now() + 300, "check_backoff": 300, "result": None,
                 "effect": None}
            self.put("jobs", j["id"], j)
            op.update(job=j["id"], state="owned")
            self.put("opportunities", op["id"], op)
            self.event("admit", j["id"], {"quota": report})
        return j

    def owned(self, x):
        j = self.get("jobs", x["job"])
        require(j["owner"] == x["owner"], "owner mismatch")
        return j

    def phase(self, x):
        with self.tx():
            j = self.owned(x)
            require(j["state"] not in TERMINAL, "job terminal")
            r = self.get("responsibilities", j["responsibility"])
            self.authority(r)
            require(x["model"] == j["model"], "model substitution denied")
            self.job_revisions_valid(j, r)
            require(j["worker_state"] != "unknown" and not j["stop_requested"],
                    "reconcile worker status/stop before continuation")
            report = self.quota(j["route"], j["estimates"], exclude=j["id"], not_before=j["phase_at"])
            if "result" in x:
                require(j["worker_state"] == "completed" and x["result"] == j["result"] and j["result"],
                        "validation needs an exact result and confirmed completed worker")
                brief(x["review_evidence_ref"])
                j["result_validation"] = {"result": j["result"], "at": self.now(),
                                          "worker_observed_at": j["worker_observed_at"],
                                          "control_generation": j["control_generation"],
                                          "evidence_ref": x["review_evidence_ref"]}
            j["phase_at"] = self.now()
            self.put("jobs", j["id"], j)
            self.event("phase", j["id"], {"name": brief(x["phase"]), "quota": report})
        return {"job": j["id"], "phase_admitted": True, "quota": report}

    def worker_status(self, x):
        safe_json(x)
        require(x["status"] in ("running", "unknown", "completed", "stopped", "not_started"), "invalid worker status")
        brief(x["evidence_ref"])
        at = number(x["observed_at"])
        require(at <= self.now() + 5 and self.now() - at <= 300, "stale worker evidence")
        with self.tx():
            j = self.owned(x)
            require(at >= j.get("worker_observed_at", j["admitted_at"]), "out-of-order worker evidence")
            require(not j["terminal_at"] or x["status"] == j["worker_state"], "terminal status cannot be undone")
            j.update(worker_state=x["status"], worker_observed_at=at)
            if x["status"] in ("completed", "stopped", "not_started"):
                j["terminal_at"] = j["terminal_at"] or at
            if x.get("clear_stop"):
                controls(self.policy)
                require(j["terminal_at"] is not None, "cannot clear stop on running computation")
                j["stop_requested"] = False
            self.put("jobs", j["id"], j)
            self.event("worker_status", j["id"], {"status": x["status"], "evidence_ref": x["evidence_ref"]})
        return {"job": j["id"], "terminal_confirmed": bool(j["terminal_at"]), "reservation_held": True}

    def result(self, x):
        safe_json(x)
        with self.tx():
            j = self.owned(x)
            require(not j["stop_requested"] and j["worker_state"] not in ("stopped", "not_started"),
                    "late result after stop rejected; reconcile/revalidate through Fami")
            h = digest(canonical(x).encode())
            if j["result"]:
                require(j["result"] == h, "conflicting duplicate result")
                return {"job": j["id"], "duplicate": True}
            require(j["state"] not in TERMINAL, "late result for closed job rejected")
            for k in ("outcome", "uncertainty"):
                brief(x[k])
            require("remaining_dependency" in x and isinstance(x["evidence"], list) and x["evidence"],
                    "incomplete result capsule")
            for e in x["evidence"]:
                brief(e)
            t = x["transport"]
            require(t["complete"] is True and t["truncated"] is False and type(t["expected_parts"]) is int
                    and t["expected_parts"] > 0 and t["received_parts"] == list(range(1, t["expected_parts"] + 1)),
                    "incomplete/truncated/multipart return")
            brief(t["evidence_ref"])
            brief(t["model_evidence_ref"])
            require(t["verification"] in ("native_complete", "independent_full_retrieval"),
                    "completeness requires verified transport/retrieval evidence")
            require(x["model"] == j["model"] and x["method_revision"] == j["method_revision"]
                    and x["source_revisions"] == j["source_revisions"], "result model/revision mismatch")
            require(isinstance(x["changes"], list) and len(x["changes"]) <= 16, "bounded changes required")
            self.put("results", h, x)
            j.update(result=h, state="result_received")
            j["result_validation"] = None
            self.put("jobs", j["id"], j)
            self.event("result", j["id"], {"capsule": h})
        return {"job": j["id"], "result": h, "effect": "not applied; live validation required"}

    def settle(self, j):
        require(j["terminal_at"] is not None, "timeout/result does not prove computation stopped")
        # Fresh post-terminal global observations, not estimates or a timeout, settle capacity.
        for pool in j["estimates"]:
            s = self.get("usage", pool)
            require(not s["error"] and s["observed_at"] >= j["terminal_at"] and
                    0 <= self.now() - s["observed_at"] <= self.policy["pools"][pool]["max_age_seconds"]
                    and all(w["resets_at"] > self.now() for w in s["windows"]),
                    "need valid fresh global quota after confirmed termination")
        j["reservation_released"] = True

    def complete(self, x):
        safe_json(x)
        with self.tx():
            j = self.owned(x)
            if j["state"] in TERMINAL:
                require(j.get("closure") == x, "conflicting duplicate closure")
                return {"job": j["id"], "state": j["state"], "duplicate": True}
            require(j["state"] not in TERMINAL, "already closed")
            self.settle(j)
            disposition = x["disposition"]
            require(disposition in ("complete", "cancelled"), "invalid disposition")
            if disposition == "complete":
                require(j["result"] and x["definition_of_done_met"] is True, "complete outcome required")
                result = self.get("results", j["result"])
                require(result["remaining_dependency"] is None, "result still has dependency")
                if result["changes"]:
                    require(j["effect"] and self.get("effects", j["effect"])["state"] == "applied", "effects incomplete")
                for dimension in ("correctness", "usability", "taste"):
                    require(x["evaluation"][dimension] in ("pass", "fail", "unknown", "not_applicable"), "invalid evaluation")
                require(x["evaluation"]["correctness"] == "pass" and x["evaluation"]["usability"] == "pass",
                        "correctness and usability must pass independently")
                require(x["evaluation"]["taste"] in ("pass", "not_applicable"), "taste acceptance remains unresolved")
            else:
                require(not j["effect"] or self.get("effects", j["effect"])["state"] == "rolled_back",
                        "recover effects before cancelling")
            brief(x["evidence_ref"])
            j.update(state=disposition, completed_at=self.now(), closure=x)
            self.put("jobs", j["id"], j)
            op = self.get("opportunities", j["occurrence"])
            op.update(state=disposition, decision=x.get("reason"))
            self.put("opportunities", op["id"], op)
            self.event("complete", j["id"], {"disposition": disposition})
        return {"job": j["id"], "state": disposition, "reservation_released": True}

    def opportunity(self, x):
        """Record misses and legitimate blocked decisions without erasing eligibility."""
        safe_json(x)
        require(x["state"] in ("pending", "missed", "permission_blocked", "decision_blocked", "superseded"), "invalid disposition")
        with self.tx():
            op = self.get("opportunities", x["occurrence"])
            require(op["job"] is None, "owned opportunity uses job closure")
            op.update(state=x["state"], decision=brief(x["reason"]))
            self.put("opportunities", op["id"], op)
            self.event("opportunity", op["id"], x)
        return op

    def effort(self, x):
        safe_json(x)
        allowed = {"baseline", "focused_collaboration", "distributed_feedback", "early_teaching",
                   "voluntary_collaboration", "checking", "correction", "chasing", "maintenance", "controller"}
        ident(x["id"])
        require(x["kind"] in allowed and type(x["after_ready"]) is bool, "invalid effort classification")
        require(not (x["after_ready"] and x.get("repair") and x["kind"] in
                     {"voluntary_collaboration", "focused_collaboration", "early_teaching"}),
                "post-ready repair must be checking/correction/maintenance")
        number(x["minutes"], 0, 100000)
        brief(x["evidence_ref"])
        with self.tx():
            if self.db.execute("SELECT 1 FROM efforts WHERE id=?", (x["id"],)).fetchone():
                require(self.get("efforts", x["id"]) == x, "effort evidence is immutable")
            self.put("efforts", x["id"], x)
        return {"effort": x["id"]}

    def learning(self, x):
        """Immutable comparison evidence; cannot alter expectations, policy or tests."""
        safe_json(x)
        ident(x["id"])
        stage = x["stage"]
        with self.tx():
            if stage == "baseline":
                require(not self.db.execute("SELECT 1 FROM learning WHERE id=?", (x["id"],)).fetchone(), "baseline already exists")
                brief(x["expected_benefit"])
                brief(x["baseline_method_revision"])
                cases = x["cases"]
                require({c["role"] for c in cases} >= {"original", "independent", "retained"}, "need original, independent and retained cases")
                require(len({c["id"] for c in cases}) == len(cases), "duplicate case")
                for c in cases:
                    require(set(c["expectations"]) == {"correctness", "usability", "taste"}, "separate evaluation dimensions")
                    require(c["expectations"]["correctness"] == "pass" and c["expectations"]["usability"] == "pass"
                            and c["expectations"]["taste"] in ("pass", "not_applicable"),
                            "expectations are accepted outcomes, not unknown/failed baseline observations")
                    brief(c["evidence_ref"])
                x["baseline_digest"] = digest(canonical(x).encode())
                x["comparisons"] = []
                x["followups"] = []
                self.put("learning", x["id"], x)
            else:
                record = self.get("learning", x["id"])
                require(x["baseline_digest"] == record["baseline_digest"], "baseline expectations changed")
                if stage == "comparison":
                    brief(x["changed_method_revision"])
                    require(x["changed_method_revision"] != record["baseline_method_revision"], "method did not change")
                    expected = {c["id"]: c for c in record["cases"]}
                    require({c["id"] for c in x["cases"]} == set(expected) and len(x["cases"]) == len(expected), "all retained cases required")
                    passed = True
                    for c in x["cases"]:
                        require(set(c["results"]) == {"correctness", "usability", "taste"}, "separate results required")
                        require(all(v in ("pass", "fail", "unknown", "not_applicable") for v in c["results"].values()),
                                "invalid evaluation vocabulary")
                        brief(c["evidence_ref"])
                        passed &= all(c["results"][d] == v for d, v in expected[c["id"]]["expectations"].items())
                    x["eligible_for_adoption"] = passed
                    x["real_use_confirmed"] = False
                    record["comparisons"].append(x)
                elif stage == "followup":
                    require(any(c["changed_method_revision"] == x["changed_method_revision"] and c["eligible_for_adoption"]
                                for c in record["comparisons"]), "no passing comparison for method")
                    brief(x["real_job"])
                    job = self.get("jobs", x["real_job"])
                    require(job["state"] == "complete" and job["method_revision"] == x["changed_method_revision"],
                            "follow-up must reference completed use of changed method")
                    brief(x["evidence_ref"])
                    require(type(x["benefit_confirmed"]) is bool, "explicit real-use outcome required")
                    record["followups"].append(x)
                else:
                    raise Denied("invalid learning stage")
                self.put("learning", x["id"], record)
            self.event("learning", x["id"], {"stage": stage})
        return self.get("learning", x["id"])

    def status(self, x=None):
        self.check_policy()
        try:
            controls(self.policy)
            gate = "ACTIVE/ON, unpaused"
        except (OSError, Denied):
            gate = "blocked/unknown"
        jobs = self.all("jobs")
        ops = self.all("opportunities")
        return {"controls": gate, "jobs": jobs, "opportunities": ops,
                "workers_unresolved": sum(j["terminal_at"] is None for j in jobs),
                "reservations_held": [j["id"] for j in jobs if not j["reservation_released"]],
                "effects": self.all("effects"), "usage": self.all("usage"),
                "eligible_opportunities": sum(o["eligible_count"] for o in ops),
                "missed_detections": sum(o["missed_detection_count"] for o in ops),
                "effort": self.all("efforts"), "learning": self.all("learning")}

    def migrate(self, x):
        """Explicit operator migration into a NEW private home; source is untouched.

        Existing home remains the recovery point. No in-place policy hash rewrite,
        no reset of denominator/history, and no migration of unfinished workers.
        """
        safe_json(x)
        require(x["expected_policy_sha256"] == self.policy_hash, "policy migration baseline mismatch")
        brief(x["authority_ref"])
        brief(x["qualification_evidence_ref"])
        new_home = plain_path(x["destination"], False)
        require(not inside(new_home, self.home) and not inside(self.home, new_home), "migration homes must be disjoint")
        new_policy = read_json(x["policy_input"])
        # Hold the source writer lock until the entire destination is durable.
        with self.tx():
            require(all(j["state"] in TERMINAL and j["terminal_at"] and j["reservation_released"]
                        for j in self.all("jobs")), "finish/reconcile all owners and reservations before migration")
            require(all(e["state"] in ("applied", "rolled_back") for e in self.all("effects")),
                    "unresolved effects prevent migration")
            initialize(new_home, new_policy, migration_pending=True)
            new_db = sqlite3.connect(new_home / "ledger.sqlite3", isolation_level=None)
            try:
                new_db.execute("BEGIN IMMEDIATE")
                for table in ("responsibilities", "jobs", "opportunities", "results", "effects", "wakes", "efforts", "learning"):
                    for row in self.db.execute(f"SELECT id,data FROM {table}"):
                        new_db.execute(f"INSERT INTO {table} VALUES(?,?)", tuple(row))
                for row in self.db.execute("SELECT seq,at,kind,reference,data FROM events"):
                    new_db.execute("INSERT INTO events VALUES(?,?,?,?,?)", tuple(row))
                for s in self.all("usage"):
                    s["error"] = "policy migrated; fresh account observation required"
                    new_db.execute("INSERT INTO usage VALUES(?,?)", (s["id"], canonical(s)))
                # Copy only referenced method/recovery bytes, not raw input archives.
                refs = {j["method_snapshot"] for j in self.all("jobs")}
                for e in self.all("effects"):
                    refs.update(entry[k] for entry in e["entries"] for k in ("before", "after"))
                for name in refs:
                    destination = relative(new_home, name, False)
                    require(destination.parent.exists(), "unexpected nested recovery path")
                    durable_write(destination, read_bytes(relative(self.home, name)))
                receipt = {"from_policy": self.policy_hash, "to_policy": digest(read_bytes(new_home / "policy.json")),
                           "source_home": str(self.home), "authority_ref": x["authority_ref"],
                           "qualification_evidence_ref": x["qualification_evidence_ref"],
                           "eligible_count_preserved": sum(o["eligible_count"] for o in self.all("opportunities")),
                           "source_unchanged": True}
                new_db.execute("INSERT INTO events(at,kind,reference,data) VALUES(?,?,?,?)",
                               (self.now(), "operator_policy_migration", "migration", canonical(receipt)))
                durable_write(new_home / "receipts/migration.json", (canonical(receipt) + "\n").encode())
                new_db.execute("UPDATE meta SET value='false' WHERE key='migration_pending'")
                new_db.execute("COMMIT")
                require(new_db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "migrated database integrity failed")
            finally:
                new_db.close()
        return {"destination": str(new_home), **receipt,
                "next": "Fami verifies destination, explicitly switches caller home, and retains old home for recovery"}


def initialize(home, policy, migration_pending=False):
    home = plain_path(home, False)
    require(inside(home, REPO / ".private"), "private home must be inside repository .private")
    safe_json(policy)
    require(policy["version"] == VERSION, "unsupported policy version")
    require(policy["reserve_percent"] == 40 and policy["max_workers"] == 3, "household resource controls are fixed")
    for pool, p in policy["pools"].items():
        ident(pool)
        require(type(p["coverage_verified"]) is bool and p["required_windows"], "explicit window coverage required")
        require(0 < p["max_age_seconds"] <= 300 and p["inflight_buffer_percent"] > 0, "freshness/buffer required")
    # Aliases cannot mint duplicate headroom for one native pool.
    keys = [(p["format"], p.get("native_limit_id", p.get("shared_identity"))) for p in policy["pools"].values()]
    require(len(keys) == len(set(keys)) and all(k[1] for k in keys), "duplicate/missing shared pool identity")
    for r in policy["routes"].values():
        require(r["pools"] and len(r["pools"]) == len(set(r["pools"])), "invalid route pools")
        require(set(r["pools"]) <= set(policy["pools"]), "unknown route pool")
        require(r["worker_effects"] == "isolated_only" and type(r["qualified"]) is bool, "route isolation required")
        brief(r["model"])
    for key in ("controls_path", "pause_path"):
        plain_path(policy[key])
    protected = [REPO, home, plain_path(policy["controls_path"]), plain_path(policy["pause_path"])]
    protected += [plain_path(g["path"]) for g in policy["grants"].values()]
    protected += [plain_path(p, False) for p in policy["protected_paths"]]
    for p in policy["projects"].values():
        root = plain_path(p["root"], False)
        require(root.exists() or inside(root, home / "fixture-targets"), "project root missing")
        require(p["effect_mode"] in ("disabled", "windows_locked_files"), "unsupported applying route")
        require(len(set(s.casefold() for s in p["effect_paths"])) == len(p["effect_paths"]), "duplicate effect path")
        for name in p["effect_paths"]:
            path = relative(root, name, False)
            # Synthetic roots within .private are supported; code, policy, records are not effects.
            require(not any(inside(path, q) for q in protected if q != REPO and q != home), "protected effect target")
            if inside(path, REPO):
                require(inside(path, home / "fixture-targets"), "runtime/enforcement cannot be a method target")
        require(set(p.get("method_paths", [])) <= set(p["effect_paths"]), "method paths must be explicit effect targets")
    require(not home.exists(), "home exists; initialization never overwrites")
    # Check real Git ignore coverage, not just a matching-looking .gitignore line.
    probes = [home / p for p in ("policy.json", "ledger.sqlite3", "ledger.sqlite3-wal", "inbox/input.json", "recovery/before.bin", "receipt.json")]
    r = subprocess.run(["git", "-C", str(REPO), "check-ignore", "--stdin"],
                       input="\n".join(str(p) for p in probes), text=True, capture_output=True)
    require(r.returncode == 0 and len(r.stdout.splitlines()) == len(probes), "private paths are not all ignored")
    home.mkdir(parents=True)
    for d in ("inbox", "recovery", "receipts"):
        (home / d).mkdir()
    durable_write(home / "policy.json", (json.dumps(policy, indent=2) + "\n").encode())
    db = sqlite3.connect(home / "ledger.sqlite3")
    try:
        db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
        for table in ("responsibilities", "jobs", "opportunities", "usage", "results", "effects", "wakes", "efforts", "learning"):
            db.execute(f"CREATE TABLE {table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)")
        db.execute("CREATE TABLE events(seq INTEGER PRIMARY KEY,at REAL,kind TEXT,reference TEXT,data TEXT)")
        db.executemany("INSERT INTO meta VALUES(?,?)", [("version", str(VERSION)),
                       ("policy_hash", digest(read_bytes(home / "policy.json"))),
                       ("migration_pending", "true" if migration_pending else "false")])
        db.commit()
    finally:
        db.close()
    return {"initialized": True, "home": str(home), "background_service": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("command", choices=["init", "responsibility", "heartbeat", "usage", "admit", "phase", "result",
                        "worker-status", "apply", "recover", "complete", "learning", "effort", "opportunity", "status", "migrate"])
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", help="receipt path relative to private home; never overwrite")
    args = parser.parse_args()
    try:
        x = read_json(args.input) if args.input else {}
        if args.command == "init":
            result = initialize(args.home, x)
        else:
            with contextlib.closing(Ledger(args.home)) as ledger:
                if args.command in ("apply", "recover"):
                    from household_effects import apply, recover
                    result = (apply if args.command == "apply" else recover)(ledger, x)
                else:
                    result = getattr(ledger, args.command.replace("-", "_"))(x)
        if args.output:
            p = relative(plain_path(args.home), args.output, False)
            durable_write(p, (json.dumps(result, indent=2) + "\n").encode())
        print(json.dumps(result, indent=2))
    except (Denied, KeyError, TypeError, ValueError, OSError, sqlite3.Error) as e:
        # Avoid dumping arbitrary input/private paths in exception traces.
        print(json.dumps({"ok": False, "error": str(e) if isinstance(e, Denied) else type(e).__name__}))
        return 2
    return 0


if __name__ == "__main__":
    sys.modules.setdefault("household_loop", sys.modules[__name__])
    sys.exit(main())
