#!/usr/bin/env python3
"""Repository-local bounded sweeps and a read-only workflow-credential probe.

retire-obsolete-merge-runs.py is an exact copy from intent-hq/intentd commit
df970a6df21589bcd8a73bb09b5d153ebccc3d95 (intentd#2562). Its regression scenarios are
retained with pre-import isolation and in-process CLI parsing for portable offline tests.
No runtime dependency on that repository exists. This caller pins cloudlands-fe.
A cursor only orders work; every cancellation still requires the full policy.
Missing state starts a new sweep; malformed state stops without requests.
"""
import argparse
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path
import sys

SPEC = importlib.util.spec_from_file_location('retirement', Path(__file__).with_name('retire-obsolete-merge-runs.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)
REPOSITORY = 'intent-hq/cloudlands-fe'


class TokenApi:
    """The reviewed gh transport with an explicit per-process evidence credential."""
    def __init__(self, variable):
        self.variable = variable

    def request(self, method, path, body=None):
        token = os.environ.get(self.variable, '')
        P.require(bool(token), 'missing explicit evidence credential')
        environment = dict(os.environ, GH_TOKEN=token)
        environment.pop('RETIREMENT_READ_TOKEN', None)
        environment.pop('GITHUB_TOKEN', None)
        command = ['gh', 'api', '--hostname', 'github.com', '--include', '--method', method,
                   '-H', 'Accept: application/vnd.github+json',
                   '-H', 'X-GitHub-Api-Version: 2022-11-28', path]
        if body is not None:
            command += ['--input', '-']
        try:
            completed = subprocess.run(command, input=None if body is None else json.dumps(body),
                                       text=True, capture_output=True, timeout=30, env=environment)
            response = P.parse_response(completed.stdout)
        except (OSError, subprocess.TimeoutExpired, ValueError) as error:
            raise P.SafetyError('GitHub evidence request failed: ' + str(error)) from error
        P.require(completed.returncode == 0 or response.status >= 400, 'gh failed without an HTTP error')
        return response


class SplitApi:
    """Read credential for evidence; repo GITHUB_TOKEN only for exact cancel POSTs."""
    def __init__(self, reader, writer):
        self.reader, self.writer = ReadOnlyApi(reader), writer

    def request(self, method, path, body=None):
        root = '/repos/' + REPOSITORY
        P.require(path == root or path.startswith(root + '/') or path == '/graphql',
                  'transport outside local repository')
        if method == 'POST' and re.fullmatch(re.escape(root) + r'/actions/runs/[1-9][0-9]*/cancel', path):
            P.require(body is None, 'cancel request cannot carry extra parameters')
            return self.writer.request(method, path, body)
        return self.reader.request(method, path, body)


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


class TraceApi:
    def __init__(self, api):
        self.api, self.routes = api, []

    def request(self, method, path, body=None):
        route = {'method': method, 'path': path}
        if path == '/graphql':
            route['cursor'] = body['variables']['cursor']
        self.routes.append(route)
        response = self.api.request(method, path, body)
        route['status'] = response.status
        return response


def activity_access(client, ctx):
    """Diagnostic only: drain pages even with null heads; never authorize retirement."""
    pages = client.pages(client.root + '/git/matching-refs/heads/gh-readonly-queue/')
    names, refs = set(), []
    for page in pages:
        P.require(isinstance(page, list), 'invalid reference page')
        refs.extend(page)
    P.require(len(refs) <= 1000, 'queue ref bound exceeded')
    for ref in refs:
        name, obj = ref['ref'], ref['object']
        P.require(isinstance(name, str) and name.startswith('refs/heads/gh-readonly-queue/main/')
                  and name not in names and obj['type'] == 'commit' and P.sha(obj['sha']),
                  'invalid/duplicate queue reference')
        names.add(name)
    owner, name = REPOSITORY.split('/')
    cursor, cursors, nodes, unknown, unbuilt = None, set(), set(), 0, 0
    for index in range(client.max_pages):
        response = client.request('POST', '/graphql', {'query': P.QUEUE_QUERY,
            'variables': {'owner': owner, 'name': name, 'cursor': cursor}})
        P.require(response.status == 200 and not response.data.get('errors'), 'GraphQL access unavailable/partial')
        repo = response.data['data']['repository']
        P.require(P.integer(repo['databaseId'], 1) and repo['databaseId'] == ctx['id']
                  and repo['nameWithOwner'] == REPOSITORY, 'foreign queue response')
        entries = repo['mergeQueue']['entries']
        P.require(isinstance(entries['nodes'], list) and len(entries['nodes']) <= 100, 'invalid queue nodes')
        for node in entries['nodes']:
            P.require(isinstance(node['id'], str) and node['id'] not in nodes
                      and node['state'] in P.QUEUE_STATES and node['pullRequest']['baseRefName'] == 'main',
                      'unknown/duplicate queue entry')
            nodes.add(node['id'])
            if node['headCommit'] is None and node['state'] == 'QUEUED':
                unbuilt += 1  # mirrors the policy: no merge-group commit yet, nothing to protect
            elif node['headCommit'] is None:
                unknown += 1
            else:
                P.require(P.sha(node['headCommit']['oid']), 'invalid queue head')
        page = entries['pageInfo']
        P.require(type(page['hasNextPage']) is bool, 'invalid queue pagination')
        if not page['hasNextPage']:
            return {'ref_pages': len(pages), 'refs': len(refs), 'queue_pages': index + 1,
                    'queue_entries': len(nodes), 'unbuilt_entries': unbuilt, 'unknown_heads': unknown,
                    'pagination_complete': True, 'activity_known': unknown == 0}
        cursor = page['endCursor']
        P.require(isinstance(cursor, str) and cursor and cursor not in cursors, 'lost/repeated queue cursor')
        cursors.add(cursor)
    raise P.SafetyError('incomplete queue pagination')


def probe(api, run_id=None):
    """Always inspect both protections and queue activity, even on an empty scan."""
    traced = TraceApi(ReadOnlyApi(api))
    client = P.Client(traced, REPOSITORY, 10, 200)
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
        check('activity', lambda: activity_access(client, ctx))
        check('run_inventory', lambda: {'live_runs': len(P.discover(client, ctx))})
        base = check('main', lambda: P.main_tip(client))
        if base is not None:
            check('comparison', lambda: P.compare(client, base, base))
        if run_id is not None:
            def run_access():
                P.require(P.integer(run_id, 1), 'invalid probe run ID')
                run = client.get(client.root + '/actions/runs/' + str(run_id))
                P.require(P.integer(run['id'], 1) and run['id'] == run_id
                          and P.integer(run['run_attempt'], 1) and P.integer(run['repository']['id'], 1)
                          and run['repository']['id'] == ctx['id']
                          and run['repository']['full_name'] == REPOSITORY, 'foreign/invalid probe run')
                return {'id': run_id, 'run_attempt': run['run_attempt']}
            check('run_detail', run_access)
        else:
            result['checks']['run_detail'] = {'ok': False, 'status': 'unexercised'}
    result['routes'] = traced.routes
    activity = result['checks'].get('activity', {})
    result['eligibility'] = 'not-assessed' if activity.get('evidence', {}).get('activity_known') else 'unknown'
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
        if args.probe:
            result = probe(P.GhApi(), args.probe_run_id)
        else:
            api = SplitApi(TokenApi('RETIREMENT_READ_TOKEN'), TokenApi('GH_TOKEN'))
            access = probe(api, args.probe_run_id)
            if access['complete']:
                result = sweep(api, args.state, apply=args.apply)
            else:
                result = {'complete': False, 'error': 'read-access preflight failed; no sweep started'}
            result['access'] = access
    except (ValueError, KeyError, TypeError, OSError) as error:
        result = {'complete': False, 'error': str(error)}
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0 if result['complete'] else 2


if __name__ == '__main__':
    sys.exit(main())
