#!/usr/bin/env python3
"""Repository-local bounded sweeps and a read-only workflow-credential probe.

retire-obsolete-merge-runs.py and its policy regressions are exact copies from
intent-hq/intentd commit 62a2a110b7e217151280736acb7fd19a1daf3c71.
No runtime dependency on that repository exists. This caller pins cloudlands-fe.
A cursor only orders work; every cancellation still requires the full policy.
Missing state starts a new sweep; malformed state stops without requests.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

SPEC = importlib.util.spec_from_file_location('retirement', Path(__file__).with_name('retire-obsolete-merge-runs.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
REPOSITORY = 'intent-hq/cloudlands-fe'


class ReadOnlyApi:
    def __init__(self, api):
        self.api = api

    def request(self, method, path, body=None):
        P.require(method == 'GET' or (method == 'POST' and path == '/graphql'
                  and isinstance(body, dict) and body.get('query') == P.QUEUE_QUERY),
                  'read-only probe rejects mutation')
        return self.api.request(method, path, body)


class BudgetApi:
    def __init__(self, api, maximum):
        self.api, self.remaining = api, maximum

    def request(self, method, path, body=None):
        P.require(self.remaining > 0, 'caller request budget exhausted')
        self.remaining -= 1
        return self.api.request(method, path, body)


def read_cursor(path):
    if not path.exists():
        return 0
    P.require(path.stat().st_size <= 1024, 'cursor file too large')
    state = json.loads(path.read_text())
    P.require(state['repository'] == REPOSITORY and state['version'] == 1
              and P.integer(state['after_run_id']), 'invalid/foreign sweep cursor')
    return state['after_run_id']


def save_cursor(path, cursor):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps({'version': 1, 'repository': REPOSITORY, 'after_run_id': cursor}) + '\n')
    temporary.replace(path)


def probe(api, run_id=None):
    """Always inspect both protections and queue activity, even on an empty scan."""
    client = P.Client(ReadOnlyApi(api), REPOSITORY, 10, 200)
    result = {'repository': REPOSITORY, 'mode': 'read-only-probe', 'checks': {}}

    def check(name, operation):
        try:
            value = operation()
            result['checks'][name] = {'ok': True, 'evidence': value}
            return value
        except (P.SafetyError, P.Skip, KeyError, TypeError, AttributeError) as error:
            result['checks'][name] = {'ok': False, 'error': str(error)}
            return None

    ctx = check('identity', lambda: P.context(client))
    if ctx is not None:
        def protection():
            proof = P.protection(client, ctx)
            return {'rule_ids': proof['rule_ids'], 'bypass_verified': True}
        check('protection', protection)
        check('activity', lambda: P.activity(client, ctx, None))
        check('run_inventory', lambda: {'live_runs': len(P.discover(client, ctx))})
        base = check('main', lambda: P.main_tip(client))
        if base is not None:
            check('comparison', lambda: P.compare(client, base, base))
        if run_id is not None:
            def run_access():
                P.require(P.integer(run_id, 1), 'invalid probe run ID')
                run = client.get(client.root + '/actions/runs/' + str(run_id))
                P.require(run['id'] == run_id and run['repository']['id'] == ctx['id']
                          and run['repository']['full_name'] == REPOSITORY, 'foreign probe run')
                return {'id': run_id, 'run_attempt': run['run_attempt']}
            check('run_detail', run_access)
    result['complete'] = bool(ctx) and all(item['ok'] for item in result['checks'].values())
    return result


def sweep(api, state, *, apply=False, max_batches=3, max_candidates=20, max_requests=600):
    P.require(all(P.integer(v, 1) for v in (max_batches, max_candidates, max_requests)), 'invalid caller bounds')
    cursor = read_cursor(state)
    result = {'repository': REPOSITORY, 'mode': 'apply' if apply else 'dry-run',
              'start_after_run_id': cursor, 'next_after_run_id': cursor,
              'complete': True, 'sweep_complete': False, 'batches': []}
    bounded = BudgetApi(api, max_requests)
    for _ in range(max_batches):
        batch = P.reconcile(bounded, REPOSITORY, apply=apply, after_run_id=cursor,
                            max_candidates=max_candidates, max_requests=max_requests)
        result['batches'].append(batch)
        if not batch['complete']:
            result.update(complete=False, error=batch.get('error', 'incomplete reconciliation'))
            break
        next_cursor = batch['next_after_run_id']
        if next_cursor is None:
            cursor = 0
            result['sweep_complete'] = True
            break
        if not P.integer(next_cursor, cursor + 1):
            result.update(complete=False, error='nonadvancing reconciliation cursor')
            break
        cursor = next_cursor
        save_cursor(state, cursor)
    result['next_after_run_id'] = cursor
    save_cursor(state, cursor)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--probe', action='store_true')
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--dry-run', action='store_true')
    parser.add_argument('--state', type=Path)
    parser.add_argument('--probe-run-id', type=int)
    args = parser.parse_args()
    if not args.probe and args.state is None:
        parser.error('--state is required for a sweep')
    try:
        api = P.GhApi()
        result = probe(api, args.probe_run_id) if args.probe else sweep(api, args.state, apply=args.apply)
    except (ValueError, KeyError, TypeError, OSError) as error:
        result = {'complete': False, 'error': str(error)}
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0 if result['complete'] else 2


if __name__ == '__main__':
    sys.exit(main())
