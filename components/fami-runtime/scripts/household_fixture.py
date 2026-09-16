"""Build synthetic private inputs and run a real CLI journey; no live controls."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from household_loop import REPO, digest, initialize


def dump(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def fixture(root=None, now=None, init=True):
    parent = REPO / ".private" / "household-fixtures"
    parent.mkdir(parents=True, exist_ok=True)
    root = Path(root) if root else Path(tempfile.mkdtemp(prefix="case-", dir=parent))
    root.mkdir(parents=True, exist_ok=True)
    now = time.time() if now is None else now
    home = root / "ledger"
    (root / "controls.md").write_text("## CONTROL BLOCK\n- **Authority: ACTIVE**\n- **Clock: ON**\n", encoding="utf-8")
    dump(root / "pause.json", {"paused": False})
    (root / "grant.md").write_text("Synthetic permission: update fixture artifacts only.\n", encoding="utf-8")
    (root / "method.md").write_text("Synthetic method revision one.\n", encoding="utf-8")
    (root / "source.md").write_text("Synthetic source: the meeting starts at noon.\n", encoding="utf-8")
    project = home / "fixture-targets" / "demo"
    policy = {"version": 1, "reserve_percent": 40, "max_workers": 3,
              "controls_path": str(root / "controls.md"), "pause_path": str(root / "pause.json"),
              "protected_paths": [],
              "grants": {"fixture-grant": {"project": "demo", "path": str(root / "grant.md"),
                         "sha256": digest((root / "grant.md").read_bytes())}},
              "projects": {"demo": {"root": str(project), "effect_mode": "windows_locked_files",
                                    "effect_paths": ["artifact.txt", "second.txt"]}},
              "pools": {"shared-codex": {"format": "native_codex", "native_limit_id": "codex",
                        "required_windows": ["300", "10080"], "coverage_verified": True,
                        "max_age_seconds": 120, "inflight_buffer_percent": 2}},
              "routes": {"fixture-isolated": {"model": "gpt-6-astra", "qualified": True,
                         "worker_effects": "isolated_only", "pools": ["shared-codex"]}}}
    responsibility = {"id": "demo-responsibility", "project": "demo", "authority": "fixture-grant",
                      "trigger": "due or changed source", "next_due": now - 1, "deadline": now + 3600,
                      "interval_seconds": 3600, "active": True, "sources": [str(root / "source.md")],
                      "method_path": str(root / "method.md"), "definition_of_done": "A usable synthetic note",
                      "burden_to_remove": "Remembering the synthetic meeting"}
    dump(root / "policy-input.json", policy)
    dump(root / "responsibility-input.json", responsibility)
    if init:
        initialize(home, policy)
        targets(project)
    return root, home, policy, responsibility


def targets(project):
    project.mkdir(parents=True)
    (project / "artifact.txt").write_bytes(b"Old synthetic artifact.\n")
    (project / "second.txt").write_bytes(b"Second old artifact.\n")


def usage(now, used=8, weekly=8):
    return {"format": "native_codex", "pool": "shared-codex", "observed_at": now,
            "snapshot": {"rateLimitsByLimitId": {"codex": {"limitId": "codex",
                         "primary": {"usedPercent": used, "windowDurationMins": 300, "resetsAt": int(now // 100000 * 100000 + 200000)},
                         "secondary": {"usedPercent": weekly, "windowDurationMins": 10080, "resetsAt": int(now // 100000 * 100000 + 900000)}}}}}


def admission(op, job="demo-job", owner="fixture-owner", cost=2):
    return {"job": job, "owner": owner, "occurrence": op, "route": "fixture-isolated", "model": "gpt-6-astra",
            "whole_job_estimate": True,
            "estimates": {"shared-codex": {w: {"whole_job_percent": cost, "controller_percent": 1,
                          "uncertainty_percent": 1} for w in ("300", "10080")}}}


def capsule(j, home, changes=True):
    (home / "inbox" / "candidate.txt").write_bytes(b"New synthetic artifact: meeting at noon.\n")
    target = home / "fixture-targets" / "demo" / "artifact.txt"
    return {"job": j["id"], "owner": j["owner"], "model": j["model"],
            "method_revision": j["method_revision"], "source_revisions": j["source_revisions"],
            "outcome": "The synthetic note is complete.", "evidence": ["private:fixture-check"],
            "uncertainty": "Synthetic demonstration only; no live route qualification.",
            "remaining_dependency": None,
            "transport": {"complete": True, "truncated": False, "expected_parts": 1,
                          "received_parts": [1], "evidence_ref": "private:complete-native-return-fixture",
                          "model_evidence_ref": "private:synthetic-returned-model", "verification": "native_complete"},
            "changes": [{"path": "artifact.txt", "candidate": "candidate.txt",
                         "before_sha256": digest(target.read_bytes()),
                         "after_sha256": digest((home / "inbox" / "candidate.txt").read_bytes())}] if changes else []}


def e2e():
    root, home, policy, r = fixture(init=False)
    outputs = []
    def run(command, payload, label=None):
        label = label or command
        inp = root / (label + ".json")
        dump(inp, payload)
        cmd = [sys.executable, str(REPO / "scripts" / "household_loop.py"), "--home", str(home),
               command, "--input", str(inp), "--output", f"receipts/{label}.json"]
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode:
            raise RuntimeError(f"CLI {command} failed: {p.stdout}")
        result = json.loads(p.stdout)
        outputs.append({"command": command, "exit": p.returncode, "receipt": f"receipts/{label}.json"})
        return result
    run("init", policy)
    targets(Path(policy["projects"]["demo"]["root"]))
    run("responsibility", r)
    wake = run("heartbeat", {"id": "synthetic-wake-1"})
    run("usage", usage(time.time()))
    j = run("admit", admission(wake["new_opportunities"][0]))
    run("worker-status", {"job": j["id"], "owner": j["owner"], "status": "running",
                          "observed_at": time.time(), "evidence_ref": "private:synthetic-running"}, "running")
    run("usage", usage(time.time()), "phase-usage")
    run("phase", {"job": j["id"], "owner": j["owner"], "model": j["model"], "phase": "verification"})
    returned = run("result", capsule(j, home))
    run("worker-status", {"job": j["id"], "owner": j["owner"], "status": "completed",
                          "observed_at": time.time(), "evidence_ref": "private:synthetic-native-terminal"}, "terminal")
    run("usage", usage(time.time()), "terminal-usage")
    run("phase", {"job": j["id"], "owner": j["owner"], "model": j["model"], "phase": "result validation",
                  "result": returned["result"], "review_evidence_ref": "private:synthetic-reviewed-capsule"}, "result-validation")
    run("usage", usage(time.time()), "apply-usage")
    run("apply", {"job": j["id"], "owner": j["owner"]})
    run("recover", {"job": j["id"], "owner": j["owner"], "rollback": False})
    run("complete", {"job": j["id"], "owner": j["owner"], "disposition": "complete", "definition_of_done_met": True,
                     "evaluation": {"correctness": "pass", "usability": "pass", "taste": "not_applicable"},
                     "evidence_ref": "private:synthetic-actual-file-inspection"})
    status = run("status", {})
    expected = b"New synthetic artifact: meeting at noon.\n"
    assert (home / "fixture-targets/demo/artifact.txt").read_bytes() == expected
    assert status["workers_unresolved"] == 0 and status["reservations_held"] == []
    receipt = {"synthetic_only": True, "live_scheduler_qualified": False, "live_pro_qualified": False,
               "steps": outputs, "final_artifact_sha256": digest(expected), "status": "PASS"}
    dump(root / "E2E-RESULT.json", receipt)
    print(json.dumps({"status": "PASS", "private_fixture": str(root), "steps": len(outputs)}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    e2e()
