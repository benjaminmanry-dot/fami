"""Installation-proof adapter, not the production stewardship launcher.

Uses native Hermes ACP with a restricted toolset and assignment directories.
No memory promotion, web tools, delegation, hooks, or scheduled execution.
"""
import os
import hashlib
import inspect
import json
from pathlib import Path
import re
import sys
import subprocess
import threading

ROOT = Path('/home/fami/assignments').resolve()
CONTROL = Path('/mnt/c/Ambitions/hq/estate-map.md')
TOOLS = ['terminal', 'read_file', 'write_file', 'patch', 'search_files', 'skill_view', 'skill_manage']
LEARNING_SKILL = 'fami-session-index-proof'
GOVERNING_FILES = (
    Path('/mnt/c/Ambitions/ambition-agent-instructions/global/AGENTS.md'),
    Path('/mnt/c/Ambitions/hq/AGENTS.md'),
    Path('/mnt/c/Ambitions/fami-runtime/AGENTS.md'),
)


def file_identities(paths):
    return tuple((str(path), hashlib.sha256(path.read_bytes()).hexdigest()) for path in paths)


def validate_workspace(cwd):
    resolved = Path(cwd).resolve(strict=True)
    if resolved == ROOT or not resolved.is_relative_to(ROOT):
        raise PermissionError('ACP proof requires a dedicated assignment directory')
    return resolved


def check_controls():
    require_active(CONTROL.read_text(encoding='utf-8-sig'))


def require_active(text):
    pieces = text.split('## CONTROL BLOCK')
    if len(pieces) != 2:
        raise PermissionError('Missing or ambiguous control block')
    block = pieces[1].split('\n## ', 1)[0]
    authority = re.findall(r'^- \*\*Authority: ([A-Z ]+)\*\*', block, re.M)
    clock = re.findall(r'^- \*\*Clock: ([A-Z]+)\*\*', block, re.M)
    if authority != ['ACTIVE'] or clock != ['ON']:
        raise PermissionError('HQ controls prohibit execution')


def watch_controls(stop, check, interrupt):
    # Scoped to one running turn, never a standing service or model poller.
    while not stop.wait(0.25):
        try:
            check()
        except Exception:
            interrupt()
            return


def retain_empty_identity(db, state):
    # Hermes deliberately skips empty editor probes. ACPX persists their IDs
    # and reconnects before the first prompt, so retain metadata, not fake chat.
    if db is None:
        raise RuntimeError('Durable session store required')
    if not state.history and db.get_session(state.session_id) is None:
        db.create_session(session_id=state.session_id, source='acp',
                          model=str(state.model), model_config={'cwd': state.cwd})


def validate_config(cfg):
    terminal = cfg.get('terminal', {})
    if (terminal.get('backend') != 'docker'
            or terminal.get('docker_network') is not False
            or terminal.get('container_persistent') is not False
            or terminal.get('docker_forward_env')
            or terminal.get('docker_volumes')
            or terminal.get('docker_extra_args')
            or cfg.get('mcp_servers') or cfg.get('hooks')):
        raise PermissionError('Restricted proof configuration changed')
    if cfg.get('model', {}).get('provider') != 'openai-codex':
        raise PermissionError('Subscription provider required')
    if cfg.get('skills', {}).get('write_approval') is not True:
        raise PermissionError('Native skill staging must be enabled')


def install_guards():
    from toolsets import create_custom_toolset, resolve_toolset
    create_custom_toolset('hermes-acp', 'Restricted installation proof', tools=TOOLS)
    assert set(resolve_toolset('hermes-acp')) == set(TOOLS)
    from acp_adapter.session import SessionManager
    from acp_adapter.server import HermesACPAgent
    from agent.interrupt_compat import request_hard_interrupt
    from run_agent import AIAgent
    from tools.environments import docker
    from tools import skill_manager_tool, skills_tool
    original = SessionManager._make_agent
    original_persist = SessionManager._persist
    original_update = SessionManager.update_cwd
    original_resume = HermesACPAgent.resume_session
    original_mcp = HermesACPAgent._register_session_mcp_servers
    original_turn = HermesACPAgent._run_agent_turn
    original_prompt = HermesACPAgent.prompt
    original_tools = AIAgent._execute_tool_calls
    original_docker = docker.DockerEnvironment.__init__
    original_kill_process = docker.DockerEnvironment._kill_process
    original_skill_write = skill_manager_tool._skill_manage_from
    original_skill_read = skills_tool.skill_view
    # Worker inputs must be deliberately placed in its assignment. Native
    # automatic caches/credential/skill mounts are not an admission policy.
    docker._readonly_skill_mount_args = lambda: []
    config_path = Path('/home/fami/.hermes-fami/config.yaml')
    admitted_config = hashlib.sha256(config_path.read_bytes()).digest()
    admitted_rules = file_identities(GOVERNING_FILES)

    def current():
        check_controls()
        if hashlib.sha256(config_path.read_bytes()).digest() != admitted_config:
            raise PermissionError('Configuration changed; start a reviewed fresh process')
        if file_identities(GOVERNING_FILES) != admitted_rules:
            raise PermissionError('Governing instructions changed; return for fresh orientation')

    def skill_write(payload, **kwargs):
        current()
        from hermes_cli.config import load_config
        validate_config(load_config())
        operations = payload.get('operations')
        if operations is None:
            operations = [payload]
        if not isinstance(operations, list) or len(operations) != 1:
            raise PermissionError('Only one named learning candidate may be staged')
        op = operations[0]
        if (op.get('name') != LEARNING_SKILL or op.get('action') != 'create'
                or op.get('category') or op.get('file_path')):
            raise PermissionError('Only the session-index learning candidate is authorized')
        # Keep Hermes native pending-write approval; no automatic adoption.
        return original_skill_write(payload, **kwargs)

    def stage_only(build_staging):
        # Native fallback is fail-open on import failure. This adapter is not.
        current()
        from tools import write_approval as wa
        if not wa.write_approval_enabled(wa.SKILLS):
            raise PermissionError('Skill staging is disabled')
        payload, gist = build_staging(wa)
        record = wa.stage_write(wa.SKILLS, payload, summary=gist, origin=wa.current_origin())
        if wa.get_pending(wa.SKILLS, record['id']) != record:
            raise RuntimeError('Skill candidate was not durably staged')
        return json.dumps({'success': True, 'staged': True, 'pending_id': record['id'],
                           'message': 'Candidate only; not active or adopted.'})

    async def prompt(self, prompt, session_id, **kwargs):
        current()
        return await original_prompt(self, prompt, session_id, **kwargs)

    def slash(self, *args, **kwargs):
        current()
        raise PermissionError('Slash commands are not admitted in this installation proof')

    def skill_read(name, *args, **kwargs):
        current()
        if name != LEARNING_SKILL:
            raise PermissionError('Only the admitted session-index skill is available')
        return original_skill_read(name, *args, **kwargs)

    def container(self, *args, **kwargs):
        current()
        bound = inspect.signature(original_docker).bind(self, *args, **kwargs)
        bound.apply_defaults()
        values = bound.arguments
        workspace = validate_workspace(values['host_cwd'])
        if values['network'] or values['volumes'] or values['forward_env'] or values['env'] or values['extra_args']:
            raise PermissionError('Unadmitted container network, mount or environment')
        inputs_root = Path('/home/fami/assignment-inputs').resolve()
        inputs = inputs_root / workspace.relative_to(ROOT)
        if inputs.exists():
            if inputs.is_symlink() or not inputs.resolve().is_relative_to(inputs_root):
                raise PermissionError('Input directory escaped admission root')
            values['volumes'] = [f'{inputs}:/inputs:ro']
        values['persistent_filesystem'] = False
        values['persist_across_processes'] = False
        values['shared_container_key'] = ''
        values['auto_mount_cwd'] = True
        values['run_as_host_user'] = True
        return original_docker(*bound.args, **bound.kwargs)

    def kill_container_process(self, proc):
        # Killing the host `docker exec` client does not kill its container child.
        # Each proof environment is disposable and assignment-scoped, so stop
        # that exact container on interrupt/timeout; bind-mounted outputs survive.
        try:
            stopped = subprocess.run([self._docker_exe, 'kill', self._container_id],
                                     capture_output=True, timeout=10)
            if stopped.returncode:
                state = subprocess.run([self._docker_exe, 'inspect', '--format',
                                        '{{.State.Running}}', self._container_id],
                                       capture_output=True, text=True, timeout=5)
                if state.returncode or state.stdout.strip() != 'false':
                    raise RuntimeError('Could not verify isolated container stop')
        finally:
            original_kill_process(self, proc)

    def persist(self, state):
        retain_empty_identity(self._get_db(), state)
        return original_persist(self, state)

    def guarded(self, **kwargs):
        current()
        validate_workspace(kwargs['cwd'])
        if kwargs.get('requested_provider') not in (None, 'openai-codex'):
            raise PermissionError('Provider change refused')
        if kwargs.get('base_url') not in (None, 'https://chatgpt.com/backend-api/codex'):
            raise PermissionError('Endpoint override refused during proof')
        return original(self, **kwargs)

    def update(self, session_id, cwd):
        current()
        target = validate_workspace(cwd)
        state = self.get_session(session_id)
        if state is None:
            raise PermissionError('Unknown session; explicit new assignment required')
        if target != validate_workspace(state.cwd):
            raise PermissionError('Resume cannot change assignment workspace')
        return original_update(self, session_id, str(target))

    async def resume(self, cwd, session_id, mcp_servers=None, **kwargs):
        current()
        if mcp_servers:
            raise PermissionError('Client MCP servers are not admitted')
        # Guarded update_cwd rejects missing IDs before native fallback creation.
        return await original_resume(self, cwd, session_id, mcp_servers, **kwargs)

    async def mcp(self, state, mcp_servers):
        if mcp_servers:
            raise PermissionError('Client MCP servers are not admitted')
        return await original_mcp(self, state, mcp_servers)

    def tools(self, *args, **kwargs):
        current()
        return original_tools(self, *args, **kwargs)

    def turn(self, **kwargs):
        current()
        state = kwargs['state']
        stop = threading.Event()
        def interrupt():
            state.cancel_event.set()
            request_hard_interrupt(state.agent, 'Controls or admitted configuration changed')
        watcher = threading.Thread(target=watch_controls, args=(stop, current, interrupt), daemon=True)
        watcher.start()
        try:
            # One terminal result, including the host receipt, instead of a
            # streamed result followed by a concatenated transformed duplicate.
            state.agent.stream_delta_callback = None
            result = original_turn(self, **kwargs)
            from result_snapshot import snapshot, completed_turn, terminal_delivery
            if completed_turn(result, bool(state.cancel_event and state.cancel_event.is_set())):
                # Fixed RESULT.md only; never expose the whole worker mount.
                receipt = snapshot(validate_workspace(state.cwd), kwargs['session_id'], current)
                if receipt:
                    result['final_response'] = terminal_delivery(receipt)
                    result['response_transformed'] = True
            return result
        finally:
            stop.set()
            watcher.join(timeout=2)

    SessionManager._make_agent = guarded
    SessionManager._persist = persist
    SessionManager.update_cwd = update
    HermesACPAgent.resume_session = resume
    HermesACPAgent._register_session_mcp_servers = mcp
    HermesACPAgent._run_agent_turn = turn
    HermesACPAgent.prompt = prompt
    HermesACPAgent._handle_slash_command = slash
    AIAgent._execute_tool_calls = tools
    docker.DockerEnvironment.__init__ = container
    docker.DockerEnvironment._kill_process = kill_container_process
    skill_manager_tool._skill_manage_from = skill_write
    skill_manager_tool._run_write_gate = stage_only
    skills_tool.skill_view = skill_read


def main():
    check_controls()
    validate_workspace(Path.cwd())
    os.environ['HERMES_HOME'] = '/home/fami/.hermes-fami'
    os.environ['HERMES_ACP_SKIP_CONFIGURED_MCP'] = '1'
    sys.path.insert(0, '/home/fami/hermes-agent')
    from hermes_cli.config import load_config
    validate_config(load_config())
    install_guards()
    from acp_adapter.entry import main as native_main
    native_main()


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        assert validate_workspace(ROOT / 'bridge-proof') == ROOT / 'bridge-proof'
        for bad in [ROOT, Path('/home/fami/.hermes-fami'), ROOT / '../.hermes-fami']:
            try:
                validate_workspace(bad)
            except PermissionError:
                pass
            else:
                raise AssertionError(f'Accepted outside workspace: {bad}')
        print('Workspace boundary checks PASS')
        from types import SimpleNamespace
        class FakeDB:
            def __init__(self):
                self.rows = {}
            def get_session(self, key):
                return self.rows.get(key)
            def create_session(self, **row):
                assert row['session_id'] not in self.rows
                self.rows[row['session_id']] = row
        db = FakeDB()
        state = SimpleNamespace(session_id='same-id', history=[], model='gpt-6-astra', cwd=str(ROOT / 'bridge-proof'))
        retain_empty_identity(db, state)
        retain_empty_identity(db, state)
        assert len(db.rows) == 1 and db.rows['same-id']['source'] == 'acp'
        assert db.rows['same-id']['model_config']['cwd'] == state.cwd
        print('Empty-session identity and idempotence checks PASS')
    else:
        main()
