"""No-model test: does native terminal interrupt stop writes inside its container?"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import subprocess

sys.path.insert(0, '/home/fami/hermes-agent')
os.environ['HERMES_HOME'] = '/home/fami/.hermes-fami'
spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('hermes-acp-proof.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.check_controls()
guard.install_guards()
from hermes_cli.config import load_config
from tools.environments.docker import DockerEnvironment
from tools.interrupt import set_interrupt
from agent.interrupt_control import InterruptControlMixin
from agent.interrupt_compat import request_hard_interrupt

cfg = load_config()
root = Path(tempfile.mkdtemp(prefix='interrupt-proof-', dir=guard.ROOT))
env = DockerEnvironment(image=cfg['terminal']['docker_image'], cwd='/workspace',
    host_cwd=str(root), network=False, cpu=1, memory=256, task_id=root.name,
    auto_mount_cwd=True, run_as_host_user=True)
result = {}
control_file = root / 'fixture-controls.md'
control_file.write_text('## CONTROL BLOCK\n- **Authority: ACTIVE**\n- **Clock: ON**\n## Other\n')
watch_stop = threading.Event()
class NativeInterruptFixture(InterruptControlMixin):
    pass
agent = NativeInterruptFixture()
agent._active_children_lock = threading.Lock()
agent._active_children = []
agent._execution_thread_id = None
agent._hard_interrupt_requested = threading.Event()
agent.quiet_mode = True
watcher = None
interrupt_errors = []

def interrupt():
    try:
        request_hard_interrupt(agent, 'Fixture controls changed')
    except Exception as exc:
        interrupt_errors.append(type(exc).__name__)

def command():
    try:
        result.update(env.execute("python -c \"from pathlib import Path; import time; Path('/workspace/started').write_text('ready'); time.sleep(6); Path('/workspace/after-stop').write_text('UNEXPECTED_LATE_WRITE')\""))
    except Exception as exc:
        result['exception_type'] = type(exc).__name__

worker = threading.Thread(target=command)
try:
    worker.start()
    deadline = time.monotonic() + 10
    while not (root / 'started').exists():
        if time.monotonic() > deadline:
            raise AssertionError('Fixture failed to start')
        time.sleep(0.05)
    agent._execution_thread_id = worker.ident
    watcher = threading.Thread(target=guard.watch_controls, args=(watch_stop,
        lambda: guard.require_active(control_file.read_text()),
        interrupt))
    watcher.start()
    # Same exact control-file writer as the PC command, but only disposable data.
    module = Path(__file__).resolve().parents[1] / 'config/controller-guard/controls.js'
    code = 'import {writeStandDown} from ' + json.dumps(module.as_uri()) + '; writeStandDown(' + json.dumps(str(control_file)) + ',' + json.dumps(str(root / 'recovery')) + ');'
    subprocess.run(['/home/fami/.local/node-v24.20.0-linux-x64/bin/node', '--input-type=module', '-e', code], check=True)
    worker.join(4)
    time.sleep(6.5)
    late_write = (root / 'after-stop').exists()
    receipt = {'native_returncode': result.get('returncode'),
               'command_thread_stopped': not worker.is_alive(),
               'late_write_after_interrupt': late_write,
               'control_file_stood_down': 'STOOD DOWN' in control_file.read_text(),
               'native_hard_interrupt_received': agent._hard_interrupt_requested.is_set(),
               'interrupt_errors': interrupt_errors,
               'workspace': str(root), 'model_calls': 0,
               'verdict': 'FAIL' if late_write or worker.is_alive() or interrupt_errors or not agent._hard_interrupt_requested.is_set() else 'PASS'}
    (root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
finally:
    watch_stop.set()
    if watcher:
        watcher.join(2)
    env.cleanup(force_remove=True)
    worker.join(3)
    set_interrupt(False, worker.ident)
if receipt['verdict'] != 'PASS':
    raise SystemExit(1)
