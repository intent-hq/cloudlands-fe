"""UNPUBLISHED hosted route guard; preparation parses this file without executing it."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

SUBJECT = '2dfb7b8c6a4579a66f1a83753bd8c18bc3ed4c0f'
TREE = 'f6c0192ff5125a4b8550886946b0fc105b80725b'
FILES = ['.github/workflows/sidebar-corrected-matrix.yml',
         '.github/workflows/sidebar-corrected-pair.yml',
         'scripts/sidebar-corrected-pair.py', 'scripts/sidebar-matrix-route.py']
control, route, subject = [Path(x).resolve() for x in sys.argv[1:4]]
receipt = Path(sys.argv[4])
end = time.monotonic() + 45
result = {'accepted': False, 'subject': SUBJECT, 'limits': 'No test execution or cache initialization in this guard.'}

def git(where, *args):
    remaining = end - time.monotonic()
    assert remaining > 0
    return subprocess.check_output(['git', '-C', str(where), *args], timeout=min(5, remaining)).decode().strip()

try:
    event_path = Path(os.environ['GITHUB_EVENT_PATH'])
    assert event_path.stat().st_size <= 1024 * 1024
    raw = event_path.read_bytes()
    event = json.loads(raw)
    pr = event['pull_request']
    head = pr['head']['sha']
    merge = os.environ['GITHUB_SHA']
    base = pr['base']['sha']
    result.update(event=event, eventSha256=hashlib.sha256(raw).hexdigest(),
                  head=head, merge=merge, base=base,
                  runId=os.environ['GITHUB_RUN_ID'], runNumber=os.environ['GITHUB_RUN_NUMBER'],
                  attempt=os.environ['GITHUB_RUN_ATTEMPT'],
                  workflowRef=os.environ['GITHUB_WORKFLOW_REF'], workflowSha=os.environ['GITHUB_WORKFLOW_SHA'])
    assert all(re.fullmatch('[0-9a-f]{40}', x) for x in (head, merge, base))
    assert os.environ['GITHUB_EVENT_NAME'] == 'pull_request' and event['action'] == 'synchronize'
    assert event['number'] == 2976 and pr['number'] == 2976 and pr['state'] == 'open' and pr['draft'] is True
    assert pr['user']['login'] == 'panghy'
    assert os.environ['GITHUB_REPOSITORY'] == event['repository']['full_name'] == pr['head']['repo']['full_name'] == pr['base']['repo']['full_name'] == 'intent-hq/cloudlands-fe'
    assert pr['head']['ref'] == 'fix/5740-browser-harness-readiness' and pr['base']['ref'] == 'main'
    assert event['before'] == SUBJECT and event['after'] == head and head != SUBJECT
    assert os.environ['MATRIX_CONTROLLER_SHA'] == head
    assert os.environ['GITHUB_RUN_ATTEMPT'] == os.environ['GITHUB_RUN_NUMBER'] == '1'
    assert os.environ['GITHUB_REF'] == 'refs/pull/2976/merge'
    assert os.environ['GITHUB_WORKFLOW_REF'] == 'intent-hq/cloudlands-fe/.github/workflows/sidebar-corrected-matrix.yml@refs/pull/2976/merge'
    assert os.environ['GITHUB_WORKFLOW_SHA'] == merge
    assert git(control, 'rev-parse', 'HEAD') == head
    assert git(control, 'show', '-s', '--format=%P', 'HEAD').split() == [SUBJECT]
    assert git(route, 'rev-parse', 'HEAD') == merge
    assert git(route, 'show', '-s', '--format=%P', 'HEAD').split() == [base, head]
    assert git(subject, 'rev-parse', 'HEAD') == SUBJECT and git(subject, 'rev-parse', 'HEAD^{tree}') == TREE
    assert sorted(git(control, 'diff', '--name-only', '--no-renames', SUBJECT, head).splitlines()) == sorted(FILES)
    assert all(row.startswith('A\t') for row in git(control, 'diff', '--name-status', '--no-renames', SUBJECT, head).splitlines())
    for checkout in (control, route, subject):
        assert git(checkout, 'status', '--porcelain', '--untracked-files=no') == ''
    rows = []
    for name in FILES:
        cp, rp = control / name, route / name
        assert not cp.is_symlink() and not rp.is_symlink()
        assert cp.stat().st_size <= 128 * 1024 and rp.stat().st_size <= 128 * 1024
        data = cp.read_bytes()
        assert rp.read_bytes() == data
        rows.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    result['controllerAndExecutedRouteFiles'] = rows
    assert time.monotonic() <= end
    result['accepted'] = True
except BaseException as error:
    result['error'] = {'type': type(error).__name__, 'message': str(error)}
finally:
    fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
sys.exit(0 if result['accepted'] else 1)
