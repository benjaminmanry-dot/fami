"""Windows-only guarded updates to existing, small, explicitly allowlisted files.

No shell commands, directory creation, deletion, symlinks or rename deployment.
Held native handles deny concurrent writes/deletes. Recovery leaves unknown bytes
alone. SQLite journals are durable before any write; multi-file updates are NOT
atomic for readers. Fami is the trusted applying caller, never an arbitrary worker.
"""
import contextlib
import ctypes
from ctypes import wintypes
import os
from pathlib import Path
import uuid

from household_loop import (Denied, MAX_BYTES, brief, controls, digest, durable_write,
                            plain_path, read_bytes, relative, require)


class LockedFile:
    """Deny-write/delete Windows handle; handles are closed on process exit."""
    def __init__(self, path, directory=False):
        require(os.name == "nt", "file effects qualify only on Windows")
        self.path = plain_path(path)
        self.directory = directory
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        self.k.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                      wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        self.k.CreateFileW.restype = wintypes.HANDLE
        for name in ("CloseHandle", "FlushFileBuffers"):
            getattr(self.k, name).argtypes = [wintypes.HANDLE]
            getattr(self.k, name).restype = wintypes.BOOL
        self.k.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, wintypes.LPVOID]
        self.k.GetFileInformationByHandle.restype = wintypes.BOOL
        self.k.ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                                   ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
        self.k.WriteFile.argtypes = self.k.ReadFile.argtypes
        self.k.SetFilePointerEx.argtypes = [wintypes.HANDLE, ctypes.c_longlong, wintypes.LPVOID, wintypes.DWORD]
        self.k.SetEndOfFile.argtypes = [wintypes.HANDLE]
        # FILE_SHARE_READ only: another writer/deleter (including renaming editors)
        # cannot open a conflicting handle. Directory children can still be read.
        access = 0x80000000 if directory else 0xC0000000
        flags = 0x00200000 | (0x02000000 if directory else 0)  # OPEN_REPARSE_POINT, BACKUP_SEMANTICS
        self.handle = self.k.CreateFileW(str(self.path), access, 1, None, 3, flags, None)
        require(self.handle != ctypes.c_void_p(-1).value, "file busy/inaccessible; no effect applied")
        try:
            class Info(ctypes.Structure):
                _fields_ = [("attributes", wintypes.DWORD), ("creation", wintypes.FILETIME),
                            ("access", wintypes.FILETIME), ("write", wintypes.FILETIME),
                            ("volume", wintypes.DWORD), ("size_high", wintypes.DWORD),
                            ("size_low", wintypes.DWORD), ("links", wintypes.DWORD),
                            ("index_high", wintypes.DWORD), ("index_low", wintypes.DWORD)]
            info = Info()
            self.check(self.k.GetFileInformationByHandle(self.handle, ctypes.byref(info)))
            require(not info.attributes & 0x400, "reparse point handle rejected")
            require(directory or info.links == 1, "hard-link handle rejected")
            require(bool(info.attributes & 0x10) == directory, "file/directory kind changed")
            require(directory or info.size_high == 0 and info.size_low <= MAX_BYTES, "artifact too large")
            self.identity = [info.volume, info.index_high, info.index_low]
        except BaseException:
            self.close()
            raise

    @staticmethod
    def check(ok):
        require(bool(ok), "native file operation failed; inspect recovery")

    def close(self):
        if self.handle is not None:
            self.k.CloseHandle(self.handle)
            self.handle = None

    def read(self):
        self.check(self.k.SetFilePointerEx(self.handle, 0, None, 0))
        buf = ctypes.create_string_buffer(MAX_BYTES + 1)
        read = wintypes.DWORD()
        self.check(self.k.ReadFile(self.handle, buf, len(buf), ctypes.byref(read), None))
        require(read.value <= MAX_BYTES, "artifact too large")
        return buf.raw[:read.value]

    def write(self, data, gate, fault=None):
        require(len(data) <= MAX_BYTES, "artifact too large")
        gate()
        self.check(self.k.SetFilePointerEx(self.handle, 0, None, 0))
        # Check live controls before every bounded chunk and before truncation.
        for offset in range(0, len(data), 65536):
            gate()
            chunk = data[offset:offset + 65536]
            written = wintypes.DWORD()
            self.check(self.k.WriteFile(self.handle, chunk, len(chunk), ctypes.byref(written), None))
            require(written.value == len(chunk), "partial native write; inspect recovery")
            self.check(self.k.FlushFileBuffers(self.handle))
            if fault:
                fault("chunk")
        gate()
        self.check(self.k.SetEndOfFile(self.handle))
        self.check(self.k.FlushFileBuffers(self.handle))


@contextlib.contextmanager
def locked_targets(paths):
    """Pin every ancestor against rename/reparse before opening descendant paths."""
    require(len(set(str(p).casefold() for p in paths)) == len(paths), "duplicate target")
    dirs = set()
    for p in paths:
        dirs.update(p.parents)
    with contextlib.ExitStack() as stack:
        for p in sorted(dirs, key=lambda p: (len(p.parts), str(p).casefold())):
            lock = LockedFile(p, directory=True)
            stack.callback(lock.close)
        files = {}
        for p in sorted(paths, key=lambda p: str(p).casefold()):
            lock = LockedFile(p)
            stack.callback(lock.close)
            files[str(p)] = lock
        yield files


def gate(ledger, job, *, source_check=True):
    ledger.check_policy()
    j = ledger.get("jobs", job["id"])
    require(j["owner"] == job["owner"] and j["state"] not in {"complete", "cancelled"}, "ownership no longer valid")
    require(j["terminal_at"] is not None and not j["stop_requested"],
            "worker must be confirmed terminal and stop reconciled before effects")
    r = ledger.get("responsibilities", j["responsibility"])
    ledger.authority(r)
    if source_check:
        ledger.job_revisions_valid(j, r)
    return j, r


def method_gate(ledger, project, root, change, target):
    """Compare actual file identity, including case and Windows 8.3 aliases.

    Called while the target and its ancestors are locked, both when preparing
    recovery and immediately before applying. Missing unrelated methods cannot
    alias an existing target; redirected existing method references fail closed.
    """
    methods = [Path(row["method_path"]) for row in ledger.all("responsibilities")]
    methods += [relative(root, p) for p in project.get("method_paths", [])]
    is_method = False
    for method in methods:
        method = plain_path(method, False)
        if method.exists() and os.path.samefile(target, method):
            is_method = True
            break
    if not is_method:
        return
    require(change.get("learning_id"), "method effect requires retained-case comparison")
    learning = ledger.get("learning", change["learning_id"])
    comparisons = [v for v in learning["comparisons"] if v["changed_method_revision"] == change["after_sha256"]]
    require(learning["baseline_method_revision"] == change["before_sha256"] and comparisons
            and comparisons[-1]["eligible_for_adoption"] is True,
            "method change failed/has no valid comparison against this baseline")


def apply(ledger, x, fault=None):
    """Fault injection is library-only for fixtures; there is no CLI fault switch."""
    with ledger.tx():
        j = ledger.owned(x)
        require(j["result"], "no complete result capsule")
        if j["effect"]:
            return {"job": j["id"], "effect": j["effect"], "state": ledger.get("effects", j["effect"])["state"],
                    "duplicate": True}
        j, r = gate(ledger, j)
        require(j["worker_state"] == "completed", "only confirmed completed workers can supply effects")
        validation = j["result_validation"]
        require(validation and validation["result"] == j["result"] and
                validation["worker_observed_at"] == j["worker_observed_at"] and
                validation["control_generation"] == j["control_generation"],
                "exact result needs fresh explicit phase validation after worker/control reconciliation")
        ledger.quota(j["route"], j["estimates"], exclude=j["id"], not_before=j["phase_at"])
        ledger.settle(j)
        project = ledger.project(r)
        require(project["effect_mode"] == "windows_locked_files", "project applying route disabled")
        root = plain_path(project["root"])
        result = ledger.get("results", j["result"])
        require(result["remaining_dependency"] is None and result["changes"], "no applicable complete changes")
        paths, candidates = [], []
        for c in result["changes"]:
            require(c["path"] in project["effect_paths"], "effect path not explicitly allowlisted")
            p = relative(root, c["path"])
            require(p.is_file(), "only existing regular files may be updated")
            candidate = relative(ledger.home / "inbox", c["candidate"])
            content = read_bytes(candidate)
            require(digest(content) == c["after_sha256"], "candidate revision changed")
            paths.append(p)
            candidates.append(content)
        effect_id = uuid.uuid4().hex
        # PREPARED is committed before mutations. No file writes happen in this transaction.
        with locked_targets(paths) as files:
            entries = []
            for c, p, data in zip(result["changes"], paths, candidates):
                f = files[str(p)]
                method_gate(ledger, project, root, c, p)
                before = f.read()
                require(digest(before) == c["before_sha256"], "target changed; preserving current file")
                require(before != data, "empty/no-op change")
                before_name = f"recovery/{effect_id}-{len(entries)}-before.bin"
                after_name = f"recovery/{effect_id}-{len(entries)}-after.bin"
                durable_write(ledger.home / before_name, before)
                durable_write(ledger.home / after_name, data)
                entries.append({"path": str(p), "before": before_name, "after": after_name,
                                "before_sha256": digest(before), "after_sha256": digest(data),
                                "identity": f.identity})
            effect = {"id": effect_id, "job": j["id"], "owner": j["owner"], "state": "prepared",
                      "entries": entries, "observations": [], "prepared_at": ledger.now()}
            ledger.put("effects", effect_id, effect)
            j.update(effect=effect_id, state="applying")
            ledger.put("jobs", j["id"], j)
            ledger.event("effect_prepared", j["id"], {"effect": effect_id})
    if fault:
        fault("prepared")
    # Reopen and compare after journal commit. SQLite write lock serializes helper
    # operations; native file handles protect against other Windows file writers.
    try:
        with ledger.tx():
            j, r = gate(ledger, j)
            with locked_targets(paths) as files:
                for e, change in zip(entries, result["changes"]):
                    f = files[e["path"]]
                    require(f.identity == e["identity"] and digest(f.read()) == e["before_sha256"],
                            "target changed after preparation")
                    method_gate(ledger, project, root, change, Path(e["path"]))
                # Source files may themselves be targets. Check all revisions above,
                # then use the locked target identities; recheck other sources each chunk.
                target_names = {str(p) for p in paths}
                def live_gate():
                    gate(ledger, j, source_check=False)
                    require(digest(read_bytes(ledger.home / j["method_snapshot"])) == j["method_revision"],
                            "pinned method changed")
                    for p in r["sources"]:
                        if str(Path(p)) not in target_names:
                            require(digest(read_bytes(p)) == j["source_revisions"][p], "source changed during application")
                for e in entries:
                    f = files[e["path"]]
                    f.write(read_bytes(ledger.home / e["after"]), live_gate, fault)
                    require(digest(f.read()) == e["after_sha256"], "effect verification failed")
                    if fault:
                        fault("file")
                effect["state"] = "applied"
                effect["applied_at"] = ledger.now()
                ledger.put("effects", effect_id, effect)
                j["state"] = "applied"
                ledger.put("jobs", j["id"], j)
                ledger.event("effect_applied", j["id"], {"effect": effect_id})
    except BaseException:
        # Prepared journal survives process death. No speculative automatic rollback.
        raise
    return {"job": j["id"], "effect": effect_id, "state": "applied"}


def recover(ledger, x, fault=None):
    """Inspect on every restart; optional rollback affects only exact known after bytes."""
    with ledger.tx():
        j = ledger.owned(x)
        require(j["effect"], "job has no effect journal")
        effect = ledger.get("effects", j["effect"])
        observations = []
        for e in effect["entries"]:
            try:
                p = plain_path(e["path"])
                actual = digest(read_bytes(p))
                state = "before" if actual == e["before_sha256"] else "after" if actual == e["after_sha256"] else "conflict"
            except (Denied, OSError):
                state = "conflict"
            observations.append({"path": e["path"], "state": state})
        effect["observations"] = observations
        if x.get("rollback"):
            gate(ledger, j, source_check=False)
            paths = [Path(e["path"]) for e, o in zip(effect["entries"], observations) if o["state"] == "after"]
            with locked_targets(paths) as files:
                for e, o in zip(effect["entries"], observations):
                    if o["state"] != "after":
                        continue
                    f = files[e["path"]]
                    # Do not touch a replaced file even when its bytes happen to match.
                    require(f.identity == e["identity"] and digest(f.read()) == e["after_sha256"],
                            "rollback target changed; preserved")
                    before = read_bytes(ledger.home / e["before"])
                    require(digest(before) == e["before_sha256"], "recovery baseline corrupt")
                    f.write(before, lambda: gate(ledger, j, source_check=False), fault)
                    o["state"] = "before"
        states = {o["state"] for o in observations}
        effect["state"] = ("rolled_back" if states == {"before"} else
                           "applied" if states == {"after"} else "recovery_required")
        ledger.put("effects", effect["id"], effect)
        # Read-only restart inspection cannot resurrect a completed owner.
        if j["state"] not in {"complete", "cancelled"}:
            j["state"] = effect["state"]
        ledger.put("jobs", j["id"], j)
        ledger.event("recovery", j["id"], {"effect": effect["id"], "state": effect["state"]})
        return {"job": j["id"], "state": effect["state"], "observations": observations,
                "unknown_bytes": "preserved; manual reconciliation using baseline and candidate required"}
