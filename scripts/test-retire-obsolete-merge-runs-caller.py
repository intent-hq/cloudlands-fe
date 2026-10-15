#!/usr/bin/env python3
"""Offline caller regressions; no real GitHub requests or cancellation."""
import importlib.util
import io
from pathlib import Path
import tempfile
import socket
import urllib.request
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
        guard = mock.patch.object(C.P, 'GhApi', side_effect=AssertionError('unit test attempted live transport'))
        guard.start()
        self.addCleanup(guard.stop)
        processes = mock.patch.object(C.subprocess, 'run', side_effect=AssertionError('unit test attempted real subprocess'))
        processes.start()
        self.addCleanup(processes.stop)
        for target, name in ((socket.socket, 'connect'), (socket.socket, 'connect_ex'), (socket, 'create_connection'), (urllib.request, 'urlopen')):
            network = mock.patch.object(target, name, side_effect=AssertionError('unit test attempted real network'))
            network.start()
            self.addCleanup(network.stop)
        self.api = T.FakeGitHub(REPO)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / 'cursor.json'

    def sweep(self, **kwargs):
        return C.sweep(self.api, self.state, **kwargs)

    def batches(self):
        self.api.runs = {i: self.api.make_run(i, T.H if i < 16 else T.S) for i in range(10, 20)}
        self.api.compares[(T.B, T.H)] = T.comparison(T.B, T.H, 'ahead')

    def test_default_deny_guard_prevents_cli_from_invoking_recording_gh_stub(self):
        marker = Path(self.directory.name) / 'gh-invoked'
        executable = Path(self.directory.name) / 'gh'
        executable.write_text('#!/bin/sh\necho invoked > "$GUARD_MARKER"\nexit 99\n')
        executable.chmod(0o755)
        environment = {'PATH': self.directory.name, 'GUARD_MARKER': str(marker),
                       'RETIREMENT_READ_TOKEN': 'fake-read', 'GH_TOKEN': 'fake-write'}
        with mock.patch.dict(C.os.environ, environment, clear=True):
            with mock.patch.object(C.sys, 'argv', ['caller', '--apply', '--probe-run-id', '10', '--state', str(self.state)]):
                with self.assertRaisesRegex(AssertionError, 'real subprocess'):
                    C.main()
            with self.assertRaisesRegex(AssertionError, 'live transport'):
                C.P.GhApi()
            with self.assertRaisesRegex(AssertionError, 'real network'):
                socket.create_connection(('example.invalid', 443))
        self.assertFalse(marker.exists(), 'the guard let the recording executable run')
        self.assertFalse(self.state.exists())
        self.assertEqual(self.api.calls, [])

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
        known_run = self.api.runs[10]
        self.api.runs.clear()
        self.api.override = lambda m, p, b, n: self.api.response(known_run) if p == self.api.root + '/actions/runs/10' else None
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        result = C.probe(self.api, 10)
        self.assertTrue(result['complete'], result)
        paths = [call[1] for call in self.api.calls]
        self.assertIn(self.api.root + '/rulesets/1', paths)
        self.assertIn('/graphql', paths)
        self.assertIn(self.api.root + '/compare/' + T.B + '...' + T.B, paths)
        self.assertEqual(self.api.mutations, [])

    def test_probe_attempts_activity_when_bypass_metadata_is_missing(self):
        del self.api.rules[1]['bypass_actors']
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        result = C.probe(self.api, 10)
        self.assertFalse(result['complete'])
        self.assertFalse(result['checks']['protection']['ok'])
        self.assertTrue(result['checks']['activity']['ok'])
        self.assertIn('/graphql', [call[1] for call in self.api.calls])
        self.assertEqual(self.api.mutations, [])

    def test_diagnostic_drains_later_queue_pages_after_unknown_head(self):
        self.api.queue_pages = [self.api.queue_body([None], True, '1'), self.api.queue_body([T.H])]
        self.api.queue_pages[1]['data']['repository']['mergeQueue']['entries']['nodes'][0]['id'] = 'MQE_later'
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        result = C.probe(self.api, 10)
        self.assertTrue(result['complete'], result)
        evidence = result['checks']['activity']['evidence']
        self.assertEqual(evidence['queue_pages'], 2)
        self.assertFalse(evidence['activity_known'])
        self.assertEqual(result['eligibility'], 'unknown')
        self.assertEqual([r['cursor'] for r in result['routes'] if r['path'] == '/graphql'], [None, '1'])
        runtime = self.sweep(apply=True)
        self.assertFalse(runtime['complete'])
        self.assertEqual(self.api.mutations, [])

    def test_unknown_first_head_does_not_hide_later_errors_or_bad_pagination(self):
        for variant in ('partial', 'api-error', 'missing-cursor', 'repeated-cursor', 'foreign-repo', 'invalid-head'):
            with self.subTest(variant=variant):
                self.api = T.FakeGitHub(REPO)
                first = self.api.queue_body([None], True, '1')
                second = self.api.queue_body([T.H])
                entries = second['data']['repository']['mergeQueue']['entries']
                entries['nodes'][0]['id'] = 'MQE_later'
                if variant == 'partial': second['errors'] = [{'message': 'unavailable'}]
                if variant == 'missing-cursor': entries['pageInfo'] = {'hasNextPage': True, 'endCursor': None}
                if variant == 'repeated-cursor': entries['pageInfo'] = {'hasNextPage': True, 'endCursor': '1'}
                if variant == 'foreign-repo': second['data']['repository']['databaseId'] = 999
                if variant == 'invalid-head': entries['nodes'][0]['headCommit']['oid'] = 'bad'
                self.api.queue_pages = [first, second]
                if variant == 'api-error':
                    self.api.override = lambda m, p, b, n: self.api.response({}, 403) if p == '/graphql' and n == 2 else None
                self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
                result = C.probe(self.api, 10)
                self.assertFalse(result['complete'], result)
                self.assertFalse(result['checks']['activity']['ok'])
                self.assertEqual(sum(p == '/graphql' for _, p, _ in self.api.calls), 2)
                self.assertEqual(self.api.mutations, [])

    def test_diagnostic_reports_unexercised_run_get_without_claiming_access(self):
        self.api.runs.clear()
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        result = C.probe(self.api)
        self.assertFalse(result['complete'])
        self.assertEqual(result['checks']['run_detail']['status'], 'unexercised')

    def test_diagnostic_rejects_foreign_or_malformed_exact_run_get(self):
        for field, value in [('id', True), ('run_attempt', False), ('repository', {'id': 77, 'full_name': 'other/repo'})]:
            self.api = T.FakeGitHub(REPO)
            self.api.runs[10][field] = value
            self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
            result = C.probe(self.api, 10)
            self.assertFalse(result['complete'], result)
            self.assertFalse(result['checks']['run_detail']['ok'])

    def test_read_only_transport_rejects_mutations(self):
        api = C.ReadOnlyApi(self.api)
        for method, path, body in [('POST', self.api.root + '/actions/runs/10/cancel', None),
                                   ('POST', '/graphql', {'query': 'mutation { cancel }'}),
                                   ('DELETE', self.api.root, None)]:
            with self.assertRaises(T.P.SafetyError):
                api.request(method, path, body)
        self.assertEqual(self.api.calls, [])

    def test_split_transport_uses_writer_only_for_exact_local_cancel(self):
        reader, writer = mock.Mock(), mock.Mock()
        api = C.SplitApi(reader, writer)
        api.request('GET', '/repos/' + REPO + '/rulesets/1')
        api.request('POST', '/graphql', {'query': T.P.QUEUE_QUERY})
        api.request('POST', '/repos/' + REPO + '/actions/runs/10/cancel')
        self.assertEqual(reader.request.call_count, 2)
        writer.request.assert_called_once_with('POST', '/repos/' + REPO + '/actions/runs/10/cancel', None)
        for method, path, body in [
            ('POST', '/repos/intent-hq/intentd/actions/runs/10/cancel', None),
            ('POST', '/repos/' + REPO + '/actions/runs/10/force-cancel', None),
            ('POST', '/repos/' + REPO + '/actions/runs/10/cancel', {'extra': True}),
            ('POST', '/repos/' + REPO + '/actions/runs/0/cancel', None),
            ('POST', '/graphql', {'query': 'mutation { nope }'}),
            ('DELETE', '/repos/' + REPO + '/git/refs/heads/main', None),
        ]:
            with self.assertRaises(T.P.SafetyError):
                api.request(method, path, body)
        self.assertEqual(writer.request.call_count, 1)
        self.assertEqual(reader.request.call_count, 2)

    def test_actual_policy_with_split_transport_only_writes_exact_obsolete_fe_id(self):
        reader, writer = mock.Mock(wraps=self.api), mock.Mock(wraps=self.api)
        self.api.runs[20] = self.api.make_run(20, T.H)
        self.api.compares[(T.B, T.H)] = T.comparison(T.B, T.H, 'ahead')
        result = C.sweep(C.SplitApi(reader, writer), self.state, apply=True)
        self.assertTrue(result['complete'])
        writer.request.assert_called_once_with('POST', '/repos/' + REPO + '/actions/runs/10/cancel', None)
        self.assertEqual(self.api.runs[20]['status'], 'queued')

    def test_evidence_transport_uses_explicit_token_without_falling_back(self):
        with mock.patch.dict(C.os.environ, {'RETIREMENT_READ_TOKEN': 'read-fixture', 'GH_TOKEN': 'write-fixture'}):
            with mock.patch.object(C.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout='HTTP/2.0 200 OK\n\n{}')) as run:
                C.TokenApi('RETIREMENT_READ_TOKEN').request('GET', '/repos/' + REPO)
                self.assertEqual(run.call_args.kwargs['env']['GH_TOKEN'], 'read-fixture')
                self.assertNotIn('RETIREMENT_READ_TOKEN', run.call_args.kwargs['env'])
                self.assertEqual(C.os.environ['GH_TOKEN'], 'write-fixture')
        with mock.patch.dict(C.os.environ, {'GH_TOKEN': 'write-fixture'}, clear=True):
            with self.assertRaises(T.P.SafetyError):
                C.TokenApi('RETIREMENT_READ_TOKEN').request('GET', '/repos/' + REPO)

    def test_request_budget_is_shared_across_batches_and_stops_without_retry(self):
        self.batches()
        result = self.sweep(max_candidates=1, max_batches=10, max_requests=30)
        self.assertFalse(result['complete'])
        self.assertEqual(len(self.api.calls), 30)
        self.assertEqual(self.api.mutations, [])

    def test_cli_sweep_routes_read_and_write_tokens_explicitly(self):
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        reader, writer = mock.Mock(wraps=self.api), mock.Mock(wraps=self.api)
        def transport(variable):
            return reader if variable == 'RETIREMENT_READ_TOKEN' else writer
        with mock.patch.object(C, 'TokenApi', side_effect=transport) as token_api:
            with mock.patch.object(C.sys, 'argv', ['caller', '--apply', '--probe-run-id', '10', '--state', str(self.state)]):
                with mock.patch('sys.stdout', new_callable=io.StringIO):
                    self.assertEqual(C.main(), 0)
        self.assertEqual(token_api.call_args_list, [mock.call('RETIREMENT_READ_TOKEN'), mock.call('GH_TOKEN')])
        writer.request.assert_called_once_with('POST', self.api.root + '/actions/runs/10/cancel', None)

    def test_cli_preflight_failure_never_reaches_cancel_even_with_no_live_runs(self):
        self.api.runs[10].update(status='completed', conclusion='success')
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        del self.api.rules[1]['bypass_actors']
        writer = mock.Mock(wraps=self.api)
        with mock.patch.object(C, 'TokenApi', side_effect=[self.api, writer]):
            with mock.patch.object(C.sys, 'argv', ['caller', '--apply', '--probe-run-id', '10', '--state', str(self.state)]):
                with mock.patch('sys.stdout', new_callable=io.StringIO) as output:
                    self.assertEqual(C.main(), 2)
        data = C.json.loads(output.getvalue())
        self.assertFalse(data['access']['checks']['protection']['ok'])
        self.assertTrue(data['access']['checks']['activity']['ok'])
        writer.request.assert_not_called()
        self.assertFalse(self.state.exists())

    def test_cli_defaults_and_explicit_dry_run_never_call_writer(self):
        self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
        for mode in ([], ['--dry-run']):
            writer = mock.Mock(wraps=self.api)
            with mock.patch.object(C, 'TokenApi', side_effect=[self.api, writer]):
                with mock.patch.object(C.sys, 'argv', ['caller', *mode, '--probe-run-id', '10', '--state', str(self.state)]):
                    with mock.patch('sys.stdout', new_callable=io.StringIO) as output:
                        self.assertEqual(C.main(), 0)
            data = C.json.loads(output.getvalue())
            self.assertTrue(data['access']['complete'])
            self.assertEqual(data['batches'][0]['decisions'][0]['action'], 'would-cancel')
            writer.request.assert_not_called()

    def test_diagnostic_drains_ref_pages_and_rejects_bad_next_links(self):
        endpoint = self.api.root + '/git/matching-refs/heads/gh-readonly-queue/'
        ref = {'ref': 'refs/heads/' + self.api.runs[10]['head_branch'], 'object': {'type': 'commit', 'sha': T.H}}
        for broken in (False, True):
            self.api = T.FakeGitHub(REPO)
            self.api.compares[(T.B, T.B)] = T.comparison(T.B, T.B, 'identical')
            def pages(method, path, body, count):
                if path == endpoint:
                    url = 'https://api.github.com' + (endpoint if not broken else '/repos/other/repo/refs') + '?page=2'
                    return self.api.response([], next_url=url)
                if path == endpoint + '?page=2': return self.api.response([ref])
            self.api.override = pages
            result = C.probe(self.api, 10)
            self.assertEqual(result['complete'], not broken, result)
            if not broken:
                self.assertEqual(result['checks']['activity']['evidence']['ref_pages'], 2)
                self.assertIn(endpoint + '?page=2', [route['path'] for route in result['routes']])
            self.assertEqual(self.api.mutations, [])

    def test_named_release_browser_and_manual_workflows_are_never_cancelled(self):
        for name in ('release-alpha', 'release-stable', 'promote-beta', 'manual-signed-build', 'nightly-browser-tests', 'nightly-browser-report'):
            self.api.runs[10]['path'] = '.github/workflows/' + name + '.yml'
            result = self.sweep(apply=True)
            self.assertTrue(result['complete'])
            self.assertEqual(self.api.mutations, [], name)


class IsolationTests(unittest.TestCase):
    def test_preimport_guard_denies_network_and_all_real_subprocesses(self):
        with self.assertRaisesRegex(RuntimeError, 'deny real process/network'):
            socket.socket()
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'invoked'
            stub = Path(directory) / 'harmless-stub'
            stub.write_text('#!/bin/sh\necho invoked > "' + str(marker) + '"\n')
            stub.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, 'deny real process/network'):
                C.subprocess.run([str(stub)], check=True)
            self.assertFalse(marker.exists())

    def test_unmocked_real_github_transport_cannot_launch_a_child(self):
        with self.assertRaisesRegex(RuntimeError, 'deny real process/network'):
            C.P.GhApi().request('GET', '/repos/' + REPO)


if __name__ == '__main__':
    unittest.main()
