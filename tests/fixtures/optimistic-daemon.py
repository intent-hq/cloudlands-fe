"""Provision an isolated store for optimistic-daemon.ct.spec.ts.

Run with --binary <built-intentd> --source <intentd-checkout> --output <ignored-dir>.
Set OPTIMISTIC_DAEMON_FIXTURE=<ignored-dir>/connection.json for the browser tests.
Credentials exist only in the temporary database; WSS authenticates both users.
This fixture bypasses invitation onboarding, never message-author resolution.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    connection = output / 'connection.json'
    if connection.exists():
        raise RuntimeError('Connection file already exists; stop its fixture first')

    def interrupted(*_):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    with tempfile.TemporaryDirectory(prefix='intent-optimistic-') as directory:
        base = Path(directory)
        (base / 'workspaces').mkdir()
        (base / 'gh').mkdir()
        (base / 'config.toml').write_text(
            '[server]\nbindAddress = "127.0.0.1"\n'
            '[server.wsApi]\nenabled = true\n'
            '[agentFeatures]\nstateSnapshot = false\n'
        )
        mock = args.source.resolve() / 'crates/intentd/tests/fixtures/mock-acp-agent.mjs'
        owner_token = 'test-owner-' + os.urandom(16).hex()
        guest_token = 'test-guest-' + os.urandom(16).hex()
        env = dict(os.environ)
        for name in ('GH_TOKEN', 'GITHUB_TOKEN', 'INTENTD_SOCKET'):
            env.pop(name, None)
        env.update({
            'INTENTD_DATA_DIR': str(base),
            'INTENTD_WORKSPACES_DIR': str(base / 'workspaces'),
            'INTENTD_SECRETS_FILE': str(base / 'secrets.json'),
            'GH_CONFIG_DIR': str(base / 'gh'),
            'INTENTD_ASSERT_HERMETIC_ROOT': '1',
            'INTENTD_ASSERT_BOUND_CALLER': '1',
            'INTENTD_TCP_PORT': '0',
            'INTENTD_AUTH_TOKEN': owner_token,
            'INTENTD_LEGACY_IMPORT_ROOTS': '',
            'MOCK_AGENT_SCRIPT_PATH': str(mock),
            'MOCK_AGENT_BEHAVIOR': json.dumps({
                'response': 'Controlled provider finished',
                'blockUntilCancel': True,
            }),
            'MOCK_AGENT_PROMPT_LOG': str(base / 'prompts.jsonl'),
        })
        with (output / 'daemon.log').open('w') as log:
            child = subprocess.Popen([str(args.binary.resolve()), 'serve'], env=env,
                                     stdout=log, stderr=log, start_new_session=True)
            try:
                sock = socket.socket(socket.AF_UNIX)
                sock.settimeout(30)
                deadline = time.monotonic() + 60
                while True:
                    try:
                        sock.connect(str(base / 'intentd.sock'))
                        break
                    except (FileNotFoundError, ConnectionRefusedError):
                        if child.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError('Isolated daemon failed to start; inspect daemon.log')
                        time.sleep(0.05)
                with sock, sock.makefile('rb') as reader:
                    serial = 0

                    def rpc(method, params):
                        nonlocal serial
                        serial += 1
                        sock.sendall((json.dumps(dict(jsonrpc='2.0', id=serial,
                            method=method, params=params)) + '\n').encode())
                        while True:
                            reply = json.loads(reader.readline())
                            if reply.get('id') == serial:
                                assert 'error' not in reply, (method, reply)
                                return reply['result']

                    workspace = rpc('workspace.create', {
                        'title': 'Optimistic combined isolated evidence'})['workspace']['id']
                    rpc('workspace.update', {'workspaceId': workspace,
                                             'repositoryPath': str(base / 'workspaces'),
                                             'skipIsolation': True})
                    guest = 'principal-functional-guest'
                    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
                    # Provision only this newly-created test store, exactly as
                    # daemon WSS tests seed principal credentials/membership.
                    with sqlite3.connect(base / 'intentd.db') as db:
                        db.execute('INSERT INTO principal(id,login,display_name,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?)',
                                   (guest, 'functional-guest', 'Functional Guest', 0, now, now))
                        db.execute('INSERT INTO principal_credential(token_hash,principal_id,created_at) VALUES (?,?,?)',
                                   (hashlib.sha256(guest_token.encode()).hexdigest(), guest, now))
                        db.execute('INSERT INTO workspace_member(workspace_id,principal_id,role,added_at) VALUES (?,?,?,?)',
                                   (workspace, guest, 'collaborator', now))
                    status = rpc('system.status', {})
                    info = dict(base=str(base), workspaceId=workspace, ownerToken=owner_token,
                                guestToken=guest_token, guestId=guest, port=status['port'],
                                binary=str(args.binary.resolve()))
                    with open(connection, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as target:
                        json.dump(info, target)
                    print('READY isolated daemon ' + str(base) + ' port ' + str(status['port']), flush=True)
                child.wait()
                raise RuntimeError('Isolated daemon exited unexpectedly')
            finally:
                connection.unlink(missing_ok=True)
                if child.poll() is None:
                    child.send_signal(signal.SIGTERM)
                    try:
                        child.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=5)


if __name__ == '__main__':
    main()
