#!/usr/bin/env python3
"""Exercise workflow scheduling and the real gate without installing the app."""
import ast
import copy
import os
from pathlib import Path
import re
import subprocess
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]
LIGHT = {'route', 'release-fast-path', 'pr-static', 'pr-title', 'conflict-markers', 'monorepo-consumer-checks'}
HEAVY = {'checks', 'build-web', 'test', 'test-integration', 'test-portable-fixtures', 'test-ct', 'test-playwright', 'test-electron'}
PR_SUITES = {'checks', 'test'}
QUEUE_ONLY = HEAVY - PR_SUITES


def evaluate(expression, values, success=True):
    if isinstance(expression, bool):
        return expression and success
    source = str(expression).removeprefix('${{').removesuffix('}}').strip()
    explicit = re.search(r'\b(always|cancelled)\(\)', source)
    source = source.replace('always()', 'True').replace('cancelled()', 'False')
    source = re.sub(r'\b(?:github|needs)\.[\w.-]+', lambda m: repr(values.get(m[0], '')), source)
    source = source.replace('&&', ' and ').replace('||', ' or ')
    source = re.sub(r'!(?!=)', ' not ', source).strip()
    tree = ast.parse(source, mode='eval')
    if any(not isinstance(n, (ast.Expression, ast.BoolOp, ast.UnaryOp, ast.Compare, ast.Constant, ast.And, ast.Or, ast.Not, ast.Eq, ast.NotEq)) for n in ast.walk(tree)):
        raise ValueError(expression)
    return bool((explicit or success) and eval(compile(tree, '<condition>', 'eval'), {'__builtins__': {}}))


def schedule(workflow, event, fork=False, fast='false', relevant='true', route='success'):
    values = {'github.event_name': event, 'github.repository': 'intent-hq/cloudlands-fe',
              'github.event.pull_request.head.repo.full_name': 'outside/fork' if fork else 'intent-hq/cloudlands-fe',
              'needs.release-fast-path.outputs.fast_path': fast}
    for key in ('ct_required', 'root_playwright_required', 'electron_required', 'portable_fixtures_required'):
        values['needs.release-fast-path.outputs.' + key] = relevant
    results = {}
    for name, job in workflow['jobs'].items():
        needs = job.get('needs', [])
        if isinstance(needs, str):
            needs = [needs]
        runs = evaluate(job.get('if', True), values, all(results[n] == 'success' for n in needs))
        results[name] = (route if name == 'route' else 'success') if runs else 'skipped'
        values['needs.' + name + '.result'] = results[name]
    return results


def gate(workflow, event, results, fast='false', relevant='true'):
    step = next(s for s in workflow['jobs']['gate']['steps'] if s.get('name') == 'Check results')
    values = {'github.event_name': event, **{'needs.'+k+'.result': v for k, v in results.items()}}
    body = re.sub(r'\$\{\{\s*(.*?)\s*\}\}', lambda m: values.get(m[1], ''), step['run'])
    env = {**os.environ, 'FAST_PATH': fast}
    for key in ('CT_REQUIRED', 'ROOT_PLAYWRIGHT_REQUIRED', 'ELECTRON_REQUIRED', 'PORTABLE_FIXTURES_REQUIRED'):
        env[key] = relevant
    return subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', body], env=env, capture_output=True).returncode == 0


class EventPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.safe_load((ROOT / '.github/workflows/intent-pr.yml').read_text())

    def test_pr_runs_type_check_and_unit_tests_and_queue_retains_all_suites(self):
        for event, expected in [('pull_request', LIGHT | PR_SUITES), ('merge_group', (LIGHT - {'pr-static', 'pr-title', 'conflict-markers'}) | HEAVY)]:
            results = schedule(self.workflow, event)
            self.assertEqual({n for n, r in results.items() if r == 'success'}, expected | {'gate'})
            self.assertTrue(gate(self.workflow, event, results))
        for job in QUEUE_ONLY:
            mutated = copy.deepcopy(self.workflow)
            mutated['jobs'][job]['if'] = True
            self.assertEqual(schedule(mutated, 'pull_request')[job], 'success')
            self.assertNotEqual({n for n, r in schedule(mutated, 'pull_request').items() if r == 'success'}, LIGHT | PR_SUITES | {'gate'})

    def test_pr_gate_requires_type_check_and_unit_tests(self):
        results = schedule(self.workflow, 'pull_request')
        for job in PR_SUITES:
            for outcome in ('skipped', 'failure', 'cancelled', ''):
                with self.subTest(job=job, outcome=outcome):
                    self.assertFalse(gate(self.workflow, 'pull_request', {**results, job: outcome}))

    def test_release_shaped_pr_skips_type_check_and_unit_tests(self):
        results = schedule(self.workflow, 'pull_request', fast='true')
        for job in PR_SUITES:
            self.assertEqual(results[job], 'skipped', job)
        self.assertTrue(gate(self.workflow, 'pull_request', results, fast='true'))

    def test_consumer_caller_grants_only_declared_permissions_and_secrets(self):
        caller = self.workflow['jobs']['monorepo-consumer-checks']
        self.assertEqual(caller['permissions'], {'actions': 'read', 'contents': 'read'})
        self.assertEqual(caller['secrets'], {
            'CI_QUEUE_READ_TOKEN': '${{ secrets.CI_QUEUE_READ_TOKEN }}',
            'DEPOT_TOKEN': '${{ secrets.DEPOT_TOKEN }}',
            'INTENT_SCCACHE_TOKEN': '${{ secrets.INTENT_SCCACHE_TOKEN }}',
        })
        self.assertEqual(caller['with']['component'], 'cloudlands-fe')
        self.assertEqual(caller['with']['head-sha'], '${{ github.event.pull_request.head.sha || github.sha }}')

    def test_consumer_caller_tracks_monorepo_main(self):
        # A SHA pin also pins the protocol docs the checks read, so docs merged
        # first (the documented fix order) stay invisible until a hand bump
        # (intentd#2476). @main resolves the monorepo tip per run.
        caller = self.workflow['jobs']['monorepo-consumer-checks']
        self.assertEqual(caller['uses'], 'intent-hq/intent/.github/workflows/consumer-checks.yml@main')

    def test_gate_rejects_failed_cancelled_missing_and_required_skips(self):
        for event in ('pull_request', 'merge_group'):
            results = schedule(self.workflow, event)
            for job in self.workflow['jobs']['gate']['needs']:
                for outcome in ('failure', 'cancelled', ''):
                    with self.subTest(event=event, job=job, outcome=outcome):
                        self.assertFalse(gate(self.workflow, event, {**results, job: outcome}))
                if results[job] == 'success':
                    self.assertFalse(gate(self.workflow, event, {**results, job: 'skipped'}), job)

    def test_release_and_irrelevant_queue_skips_are_explicit(self):
        for fast, relevant in [('true', 'true'), ('false', 'false')]:
            results = schedule(self.workflow, 'merge_group', fast=fast, relevant=relevant)
            self.assertTrue(gate(self.workflow, 'merge_group', results, fast, relevant))
        results = schedule(self.workflow, 'merge_group', relevant='')
        self.assertFalse(gate(self.workflow, 'merge_group', results, relevant=''))

    def test_fork_and_failed_routing_cannot_certify_skips(self):
        results = schedule(self.workflow, 'pull_request', fork=True)
        self.assertEqual({n for n, r in results.items() if r == 'success'}, {'gate'})
        self.assertFalse(gate(self.workflow, 'pull_request', results))
        for event in ('pull_request', 'merge_group'):
            for outcome in ('failure', 'skipped', 'cancelled'):
                self.assertFalse(gate(self.workflow, event, schedule(self.workflow, event, route=outcome)))


if __name__ == '__main__':
    unittest.main()
