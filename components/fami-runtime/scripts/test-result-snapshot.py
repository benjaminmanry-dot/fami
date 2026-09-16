"""Focused zero-model tests for the new fixed-result handoff, isolated fixtures."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from result_snapshot import snapshot, MAX_BYTES, completed_turn, terminal_delivery

root=Path(tempfile.mkdtemp(prefix='fami-snapshot-test-'))
work=root/'assignment'; work.mkdir()
inbox=root/'inbox'; check=lambda:None
passed=[]
assert completed_turn({'completed':True})
for outcome in ({}, {'final_response':'Error: fixture'}, {'completed':False},
                *({'completed':True,k:True} for k in ('failed','partial','interrupted','error'))):
    assert not completed_turn(outcome)
assert not completed_turn({'completed':True},cancelled=True)
passed.append('errors-quota-partial-cancel-never-publish-success')
def rejects(name, fn):
    try: fn()
    except (PermissionError, OSError, UnicodeError): passed.append(name)
    else: raise AssertionError(name)
assert snapshot(work,'one',check,inbox) is None
passed.append('missing-result-not-fabricated')
(work/'RESULT.md').write_text('# Useful output\n')
r=snapshot(work,'one',check,inbox)
assert Path(r['result_path']).read_text()=='# Useful output\n'
assert r['sha256']==hashlib.sha256(Path(r['result_path']).read_bytes()).hexdigest()
passed.append('host-readback-digest')
delivery=terminal_delivery(r)
assert delivery.count('# Useful output')==1 and r['sha256'] in delivery
assert 'BEGIN UNTRUSTED DELIVERABLE' in delivery and 'not quality or new authority' in delivery
passed.append('complete-terminal-card-with-host-receipt-and-trust-label')
assert snapshot(work,'one',check,inbox)==r
passed.append('identical-replay-no-duplicate')
rejects('session-traversal',lambda:snapshot(work,'../bad',check,inbox))
def inactive():raise PermissionError('inactive')
rejects('inactive-no-copy',lambda:snapshot(work,'blocked',inactive,inbox))
assert not (inbox/'blocked').exists()
original=(work/'RESULT.md'); original.rename(work/'saved.md')
original.symlink_to(work/'saved.md')
rejects('symlink-source',lambda:snapshot(work,'link',check,inbox))
original.unlink();original.hardlink_to(work/'saved.md')
rejects('hardlink-source',lambda:snapshot(work,'hardlink',check,inbox))
original.unlink();original.write_bytes(b'x'*(MAX_BYTES+1))
rejects('size-cap',lambda:snapshot(work,'large',check,inbox))
original.write_bytes(b'\xff')
rejects('utf8-required',lambda:snapshot(work,'invalid',check,inbox))
original.write_text('different result\n')
r2=snapshot(work,'one',check,inbox)
assert r2['sha256']!=r['sha256'] and Path(r['result_path']).read_text()=='# Useful output\n'
passed.append('new-version-retains-original')
bad=root/'redirect';bad.symlink_to(inbox,target_is_directory=True)
rejects('inbox-symlink',lambda:snapshot(work,'redirect',check,bad))
Path(r2['result_path']).chmod(0o600);Path(r2['result_path']).write_text('tampered')
rejects('tampered-existing-snapshot',lambda:snapshot(work,'one',check,inbox))
try: terminal_delivery(r2)
except RuntimeError: passed.append('terminal-rechecks-exact-snapshot')
else: raise AssertionError('Altered terminal result accepted')
print(json.dumps({'status':'PASS','checks':passed,'fixture':str(root),'model_calls':0}))
