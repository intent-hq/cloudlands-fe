"""UNPUBLISHED hosted route guard; preparation parses this file without executing it."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

SUBJECT = 'd7bdc3034e43b7db7e167ae4d46cd163f843dd59'
PREDECESSOR = SUBJECT
TREE = '6d790487dd4832c337183eddfaaae246dc054617'
FILES = ['.github/workflows/sidebar-corrected-matrix.yml',
         '.github/workflows/sidebar-corrected-pair.yml',
         'scripts/sidebar-corrected-pair.py', 'scripts/sidebar-matrix-route.py',
         'test/workspace-tab-strip-status-geometry.spec.ts', 'test/strip-observation.mjs']
control, route, subject = [Path(x).resolve() for x in sys.argv[1:4]]
receipt = Path(sys.argv[4])
end = time.monotonic() + 45
result = {'stage': 'initialize', 'predecessor': PREDECESSOR, 'accepted': False, 'subject': SUBJECT, 'limits': 'No test execution or cache initialization in this guard.'}

def scalar(value):
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, str):
        return value[:256]
    return '<non-scalar>'

def git(where, *args):
    result['operation'] = 'git-deadline'
    remaining = end - time.monotonic()
    assert remaining > 0
    result['operation'] = 'git-read'
    return subprocess.check_output(['git', '-C', str(where), *args], timeout=min(5, remaining)).decode().strip()

try:
    result['stage'] = 'event-read'
    event_path = Path(os.environ['GITHUB_EVENT_PATH'])
    result['stage'] = 'event-size'
    result.pop('operation', None)
    assert event_path.stat().st_size <= 1024 * 1024
    result['stage'] = 'event-decode'
    raw = event_path.read_bytes()
    event = json.loads(raw)
    result['stage'] = 'event-fields'
    pr = event['pull_request']
    head = pr['head']['sha']
    merge = os.environ['GITHUB_SHA']
    base = pr['base']['sha']
    result.update(eventSha256=hashlib.sha256(raw).hexdigest(),
                  head=scalar(head), merge=scalar(merge), base=scalar(base),
                  eventName=scalar(os.environ.get('GITHUB_EVENT_NAME')),
                  action=scalar(event.get('action')), number=scalar(event.get('number')),
                  prNumber=scalar(pr.get('number')), state=scalar(pr.get('state')), draft=scalar(pr.get('draft')),
                  owner=scalar(pr['user'].get('login')), repository=scalar(os.environ.get('GITHUB_REPOSITORY')),
                  eventRepository=scalar(event['repository'].get('full_name')),
                  headRepository=scalar(pr['head']['repo'].get('full_name')), baseRepository=scalar(pr['base']['repo'].get('full_name')),
                  headRef=scalar(pr['head'].get('ref')), baseRef=scalar(pr['base'].get('ref')),
                  before=scalar(event.get('before')), after=scalar(event.get('after')),
                  controllerInput=scalar(os.environ.get('MATRIX_CONTROLLER_SHA')), ref=scalar(os.environ.get('GITHUB_REF')),
                  runId=scalar(os.environ.get('GITHUB_RUN_ID')), runNumber=scalar(os.environ.get('GITHUB_RUN_NUMBER')),
                  attempt=scalar(os.environ.get('GITHUB_RUN_ATTEMPT')),
                  workflowRef=scalar(os.environ.get('GITHUB_WORKFLOW_REF')), workflowSha=scalar(os.environ.get('GITHUB_WORKFLOW_SHA')))
    result['stage'] = 'sha-shape'
    result.pop('operation', None)
    assert all(re.fullmatch('[0-9a-f]{40}', x) for x in (head, merge, base))
    result['stage'] = 'event-action'
    result.pop('operation', None)
    assert os.environ['GITHUB_EVENT_NAME'] == 'pull_request' and event['action'] == 'synchronize'
    result['stage'] = 'owned-pr-state'
    result.pop('operation', None)
    assert event['number'] == 2976 and pr['number'] == 2976 and pr['state'] == 'open' and pr['draft'] is True
    result['stage'] = 'pr-owner'
    result.pop('operation', None)
    assert pr['user']['login'] == 'panghy'
    result['stage'] = 'repository-ownership'
    result.pop('operation', None)
    assert os.environ['GITHUB_REPOSITORY'] == event['repository']['full_name'] == pr['head']['repo']['full_name'] == pr['base']['repo']['full_name'] == 'intent-hq/cloudlands-fe'
    result['stage'] = 'branch-ownership'
    result.pop('operation', None)
    assert pr['head']['ref'] == 'fix/5740-browser-harness-readiness' and pr['base']['ref'] == 'main'
    result['stage'] = 'successor-event'
    result.pop('operation', None)
    assert event['before'] == PREDECESSOR and event['after'] == head and head != PREDECESSOR
    result['stage'] = 'controller-input'
    result.pop('operation', None)
    assert os.environ['MATRIX_CONTROLLER_SHA'] == head
    result['stage'] = 'run-generation'
    result.pop('operation', None)
    assert os.environ['GITHUB_RUN_ATTEMPT'] == '1' and os.environ['GITHUB_RUN_NUMBER'] == '3'
    result['stage'] = 'pull-request-ref'
    result.pop('operation', None)
    assert os.environ['GITHUB_REF'] == 'refs/pull/2976/merge'
    result['stage'] = 'workflow-ref'
    result.pop('operation', None)
    assert os.environ['GITHUB_WORKFLOW_REF'] == 'intent-hq/cloudlands-fe/.github/workflows/sidebar-corrected-matrix.yml@refs/pull/2976/merge'
    result['stage'] = 'workflow-sha'
    result.pop('operation', None)
    assert os.environ['GITHUB_WORKFLOW_SHA'] == merge
    result['stage'] = 'controller-head'
    result.pop('operation', None)
    assert git(control, 'rev-parse', 'HEAD') == head
    result['stage'] = 'controller-parent'
    result.pop('operation', None)
    assert git(control, 'show', '-s', '--format=%P', 'HEAD').split() == [PREDECESSOR]
    result['stage'] = 'workflow-merge-head'
    result.pop('operation', None)
    assert git(route, 'rev-parse', 'HEAD') == merge
    result['stage'] = 'merge-parent-read'
    merge_parents = git(route, 'show', '-s', '--format=%P', 'HEAD').split()
    result.update(eventBase=base, mergeParents=merge_parents)
    result['stage'] = 'merge-parent-shape'
    result.pop('operation', None)
    assert len(merge_parents) == 2 and all(re.fullmatch('[0-9a-f]{40}', p) for p in merge_parents), 'merge-parent-shape'
    result['stage'] = 'merge-parent-controller'
    result.pop('operation', None)
    assert merge_parents[1] == head and merge_parents[0] != head, 'merge-parent-controller'
    result['mergeBase'] = merge_parents[0]
    result['stage'] = 'subject-identity'
    result.pop('operation', None)
    assert git(subject, 'rev-parse', 'HEAD') == SUBJECT and git(subject, 'rev-parse', 'HEAD^{tree}') == TREE
    result['stage'] = 'changed-paths'
    result.pop('operation', None)
    assert sorted(git(control, 'diff', '--name-only', '--no-renames', PREDECESSOR, head).splitlines()) == sorted(FILES)
    result['stage'] = 'modified-paths'
    result.pop('operation', None)
    assert sorted(git(control, 'diff', '--name-status', '--no-renames', PREDECESSOR, head).splitlines()) == sorted(('A\t' if name == 'test/strip-observation.mjs' else 'M\t') + name for name in FILES)
    for checkout in (control, route, subject):
        result['checkout'] = 'control' if checkout == control else ('route' if checkout == route else 'subject')
        result['stage'] = 'checkout-clean'
        result.pop('operation', None)
        assert git(checkout, 'status', '--porcelain', '--untracked-files=no') == ''
    rows = []
    for name in FILES:
        result['file'] = name
        cp, rp = control / name, route / name
        result['stage'] = 'file-kind'
        result.pop('operation', None)
        assert not cp.is_symlink() and not rp.is_symlink()
        result['stage'] = 'file-size'
        result.pop('operation', None)
        assert cp.stat().st_size <= 128 * 1024 and rp.stat().st_size <= 128 * 1024
        result['stage'] = 'file-read'
        data = cp.read_bytes()
        result['stage'] = 'file-equality'
        result.pop('operation', None)
        assert rp.read_bytes() == data
        rows.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    result['controllerAndExecutedRouteFiles'] = rows
    result['stage'] = 'route-deadline'
    result.pop('operation', None)
    assert time.monotonic() <= end
    result['stage'] = 'accepted'
    result['accepted'] = True
except BaseException as error:
    message = str(error)
    result['error'] = {'type': type(error).__name__, 'message': message[:512], 'messageTruncated': len(message) > 512}
finally:
    fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
sys.exit(0 if result['accepted'] else 1)
