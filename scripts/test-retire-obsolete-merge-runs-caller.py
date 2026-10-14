#!/usr/bin/env python3
"""Offline caller regressions; no real GitHub requests or cancellation."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


T = load('fixtures', 'test-retire-obsolete-merge-runs.py')
C = load('caller', 'retire-obsolete-merge-runs-caller.py')
C.P = T.P
REPO = 'intent-hq/cloudlands-fe'


class CallerTests(unittest.TestCase):
    def setUp(self):
        self.api = T.FakeGitHub(REPO)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / 'cursor.json'

    def sweep(self, **kwargs):
        return C.sweep(self.api, self.state, **kwargs)

    def batches(self):
        self.api.runs = {i: self.api.make_run(i, T.H if i < 16 else T.S) for i in range(10, 20)}
        self.api.compares[(T.B, T.H)] = T.comparison(T.B, T.H, 'ahead')

    def test_older_ineligible_batches_do_not_starve_later_eligible_ids(self):
        self.batches()
        result = self.sweep(apply=True, max_batches=5, max_candidates=2)
        self.assertTrue(result['sweep_complete'])
        self.assertEqual(result['next_after_run_id'], 0)
        self.assertEqual([int(m[1].split('/')[-2]) for m in self.api.mutations], [16, 17, 18, 19])
        self.assertEqual(len(result['batches']), 5)

    def test_bounded_continuation_is_saved_and_resets_after_complete_sweep(self):
        self.batches()
        first = self.sweep(apply=True, max_batches=2, max_candidates=2)
        self.assertFalse(first['sweep_complete'])
        self.assertEqual(first['next_after_run_id'], 13)
        second = self.sweep(apply=True, max_batches=3, max_candidates=2)
        self.assertTrue(second['sweep_complete'])
        self.assertEqual(second['start_after_run_id'], 13)
        self.assertEqual(second['next_after_run_id'], 0)
        self.assertEqual([int(m[1].split('/')[-2]) for m in self.api.mutations], [16, 17, 18, 19])

    def test_new_sweep_finds_older_late_visible_ids_and_newly_eligible_runs(self):
        self.batches()
        self.sweep(apply=True, max_batches=5, max_candidates=2)
        self.api.runs[9] = self.api.make_run(9)
        newbase = 'e' * 40
        self.api.base = newbase
        self.api.compares[(newbase, T.H)] = T.comparison(newbase, T.H)
        self.api.compares[(newbase, T.S)] = T.comparison(newbase, T.S)
        self.api.mutations.clear()
        result = self.sweep(apply=True, max_batches=4, max_candidates=2)
        self.assertTrue(result['sweep_complete'])
        self.assertEqual([int(m[1].split('/')[-2]) for m in self.api.mutations], list(range(9, 16)))

    def test_incomplete_batch_stops_without_busy_retry_and_preserves_progress(self):
        responses = [dict(complete=True, next_after_run_id=12, decisions=[]),
                     dict(complete=False, next_after_run_id=None, decisions=[], error='API unavailable')]
        with mock.patch.object(C.P, 'reconcile', side_effect=responses) as reconcile:
            result = self.sweep(max_batches=5)
        self.assertFalse(result['complete'])
        self.assertEqual(reconcile.call_count, 2)
        self.assertEqual(result['next_after_run_id'], 12)
        self.assertEqual(C.read_cursor(self.state), 12)
        self.assertEqual(self.api.mutations, [])

    def test_nonadvancing_cursor_is_an_error_not_a_retry(self):
        with mock.patch.object(C.P, 'reconcile', return_value=dict(complete=True, next_after_run_id=0, decisions=[])) as reconcile:
            result = self.sweep()
        self.assertFalse(result['complete'])
        self.assertEqual(reconcile.call_count, 1)
        self.assertEqual(C.read_cursor(self.state), 0)

    def test_default_is_dry_run_even_with_eligible_runs(self):
        result = self.sweep()
        self.assertTrue(result['complete'])
        self.assertEqual(result['batches'][0]['decisions'][0]['action'], 'would-cancel')
        self.assertEqual(self.api.mutations, [])

    def test_corrupt_or_foreign_cursor_fails_without_requests(self):
        for value in ('oops', '{"after_run_id":true}', '{"repository":"other/repo","after_run_id":42}'):
            self.state.write_text(value)
            with self.assertRaises((ValueError, KeyError)):
                self.sweep(apply=True)
        self.assertEqual(self.api.calls, [])

    def test_probe_checks_protection_activity_and_comparison_with_no_runs(self):
        self.api.runs.clear()
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        result = C.probe(self.api)
        self.assertTrue(result['complete'], result)
        paths = [call[1] for call in self.api.calls]
        self.assertIn(self.api.root + '/rulesets/1', paths)
        self.assertIn('/graphql', paths)
        self.assertIn(self.api.root + '/compare/' + T.B + '...' + T.B, paths)
        self.assertEqual(self.api.mutations, [])

    def test_probe_attempts_activity_when_bypass_metadata_is_missing(self):
        del self.api.rules[1]['bypass_actors']
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        result = C.probe(self.api)
        self.assertFalse(result['complete'])
        self.assertFalse(result['checks']['protection']['ok'])
        self.assertTrue(result['checks']['activity']['ok'])
        self.assertIn('/graphql', [call[1] for call in self.api.calls])
        self.assertEqual(self.api.mutations, [])

    def test_read_only_transport_rejects_mutations(self):
        api = C.ReadOnlyApi(self.api)
        for method, path, body in [('POST', self.api.root + '/actions/runs/10/cancel', None),
                                   ('POST', '/graphql', {'query': 'mutation { cancel }'}),
                                   ('DELETE', self.api.root, None)]:
            with self.assertRaises(T.P.SafetyError):
                api.request(method, path, body)
        self.assertEqual(self.api.calls, [])

    def test_named_release_browser_and_manual_workflows_are_never_cancelled(self):
        for name in ('release-alpha', 'release-stable', 'promote-beta', 'manual-signed-build', 'nightly-browser-tests', 'nightly-browser-report'):
            self.api.runs[10]['path'] = '.github/workflows/' + name + '.yml'
            result = self.sweep(apply=True)
            self.assertTrue(result['complete'])
            self.assertEqual(self.api.mutations, [], name)


if __name__ == '__main__':
    unittest.main()
