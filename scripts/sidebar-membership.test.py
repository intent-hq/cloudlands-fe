"""Pure report controls plus native, browser-free collection/execution compatibility.

Run: python3 -B scripts/sidebar-membership.test.py
Native fixtures use the installed runner and their own temporary source/config/cache.
They do not touch or clear the ordinary Sidebar harness caches.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('sidebar_pair', REPO / 'scripts/sidebar-corrected-pair.py')
pair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pair)
membership = pair.membership


def report_fixture():
    def case(title, native_id):
        return {'title': title, 'id': native_id, 'file': 'generated.ts', 'tests': [{
            'projectId': 'chromium', 'projectName': 'chromium', 'expectedStatus': 'passed',
            'status': 'skipped', 'results': []}]}
    return {
        'nativeMembership': {'schema': 1, 'rootDir': '/checkout/test', 'workers': 1,
            'configuredMetadata': {'root': {}, 'projects': [{'name': 'chromium', 'metadata': {}}]}, 'cases': [
            {'id': native_id, 'file': '/checkout/test/nested.spec.ts', 'titlePath': [group, 'same leaf'],
             'projectName': 'chromium'} for native_id, group in [('one', 'first group'), ('two', 'second group')]]},
        'errors': [], 'config': {
            'rootDir': '/checkout/test', 'workers': 1, 'metadata': {},
            'projects': [{'id': 'chromium', 'name': 'chromium', 'repeatEach': 1, 'retries': 0}]},
        'suites': [{'title': 'nested.spec.ts', 'file': 'nested.spec.ts', 'specs': [], 'suites': [
            {'title': 'first group', 'specs': [case('same leaf', 'one')]},
            {'title': 'second group', 'specs': [case('same leaf', 'two')]}]}]}


def all_specs(report):
    def visit(suites):
        for suite in suites:
            yield from suite['specs']
            yield from visit(suite.get('suites', []))
    return list(visit(report['suites']))


def passing(report):
    result = copy.deepcopy(report)
    for spec in all_specs(result):
        spec['tests'][0].update(status='expected', results=[{'retry': 0, 'workerIndex': 0, 'status': 'passed'}])
    return result


class ReportControls(unittest.TestCase):
    def setUp(self):
        self.subject = Path('/checkout')
        self.specs = ['test/nested.spec.ts']
        self.collected = report_fixture()
        self.manifest = self.collect(self.collected)
        self.executed = passing(self.collected)

    def collect(self, report, code=0):
        return membership.collect_membership(report, 1, self.subject, self.specs, code)

    def validate(self, report, code=0):
        return membership.validate_report(report, self.manifest, 1, self.subject, self.specs, code)

    def test_full_title_path_and_containing_file_not_generator_location(self):
        rows = self.validate(self.executed)
        self.assertEqual([r['titlePath'] for r in rows],
                         [['first group', 'same leaf'], ['second group', 'same leaf']])
        self.assertEqual({r['file'] for r in rows}, {'test/nested.spec.ts'})

    def test_same_count_substitution_has_missing_and_unexpected_diagnostics(self):
        report = copy.deepcopy(self.executed)
        all_specs(report)[0]['id'] = 'replacement'
        report['nativeMembership']['cases'][0]['id'] = 'replacement'
        with self.assertRaisesRegex(ValueError, 'membership mismatch: missing=.*unexpected='):
            self.validate(report)

    def test_title_or_parent_changed_without_id_change_is_rejected(self):
        for field in ['leaf', 'parent']:
            with self.subTest(field=field):
                report = copy.deepcopy(self.executed)
                if field == 'leaf':
                    all_specs(report)[0]['title'] = 'substitute'
                    report['nativeMembership']['cases'][0]['titlePath'][-1] = 'substitute'
                else:
                    report['suites'][0]['suites'][0]['title'] = 'substitute'
                    report['nativeMembership']['cases'][0]['titlePath'][0] = 'substitute'
                with self.assertRaisesRegex(ValueError, 'membership mismatch'):
                    self.validate(report)

    def test_duplicates_and_ambiguous_logical_names_in_collection_and_execution(self):
        for collecting in [True, False]:
            for mode in ['duplicate', 'id collision', 'logical collision']:
                with self.subTest(collecting=collecting, mode=mode):
                    report = copy.deepcopy(self.collected if collecting else self.executed)
                    groups = report['suites'][0]['suites']
                    if mode == 'duplicate':
                        groups[1] = copy.deepcopy(groups[0])
                    elif mode == 'id collision':
                        groups[1]['specs'][0]['id'] = 'one'
                    else:
                        groups[1]['title'] = groups[0]['title']
                        report['nativeMembership']['cases'][1]['titlePath'][0] = groups[0]['title']
                    with self.assertRaisesRegex(ValueError, 'duplicate'):
                        (self.collect if collecting else self.validate)(report)

    def test_missing_and_same_basename_in_unselected_directory_fail(self):
        missing = copy.deepcopy(self.executed)
        missing['suites'][0]['suites'].pop()
        with self.assertRaisesRegex(ValueError, 'missing='):
            self.validate(missing)
        wrong_file = copy.deepcopy(self.executed)
        wrong_file['nativeMembership']['cases'][0]['file'] = '/checkout/test/other/nested.spec.ts'
        with self.assertRaisesRegex(ValueError, 'unexpected selected file'):
            self.validate(wrong_file)

    def test_failed_empty_global_error_and_malformed_collection(self):
        with self.assertRaisesRegex(ValueError, 'native collection failed'):
            self.collect(self.collected, 1)
        for field, value, message in [('suites', [], 'empty collected'), ('suites', {}, 'malformed suites'),
                                      ('errors', [{}], 'global errors'), ('errors', {}, 'global errors')]:
            with self.subTest(field=field, value=value):
                report = copy.deepcopy(self.collected)
                report[field] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.collect(report)
        with self.assertRaisesRegex(ValueError, 'unexpectedly executed'):
            self.collect(self.executed)

    def test_malformed_identities_are_not_coerced(self):
        for field in ['id', 'title']:
            for value in [None, '', ' ', 12, [], '\x00']:
                with self.subTest(field=field, value=value):
                    report = copy.deepcopy(self.collected)
                    all_specs(report)[0][field] = value
                    with self.assertRaisesRegex(ValueError, 'malformed'):
                        self.collect(report)
        for file in ['', '../nested.spec.ts', '/other/nested.spec.ts']:
            with self.subTest(file=file):
                report = copy.deepcopy(self.collected)
                report['nativeMembership']['cases'][0]['file'] = file
                with self.assertRaises(ValueError):
                    self.collect(report)

    def test_missing_malformed_or_disagreeing_native_sidecar_is_rejected(self):
        changes = [
            lambda r: r.pop('nativeMembership'),
            lambda r: r.update(nativeMembership={}),
            lambda r: r['nativeMembership'].update(workers=2),
            lambda r: r['nativeMembership'].update(rootDir='/other'),
            lambda r: r['nativeMembership']['cases'].append(copy.deepcopy(r['nativeMembership']['cases'][0])),
            lambda r: r['nativeMembership']['cases'][0].update(id='unreported'),
            lambda r: r['nativeMembership']['cases'][0].update(titlePath=['false title']),
        ]
        for change in changes:
            with self.subTest(change=change):
                report = copy.deepcopy(self.collected)
                change(report)
                with self.assertRaises(ValueError):
                    self.collect(report)

    def test_existing_execution_negatives_remain_rejected(self):
        changes = [
            ('global errors', lambda r: r.update(errors=[{'message': 'late global error'}])),
            ('wrong worker', lambda r: r['config'].update(workers=2)),
            ('wrong project', lambda r: all_specs(r)[0]['tests'][0].update(projectName='webkit')),
            ('expected failure', lambda r: all_specs(r)[0]['tests'][0].update(expectedStatus='failed')),
            ('skipped', lambda r: all_specs(r)[0]['tests'][0].update(status='skipped', results=[])),
            ('failed', lambda r: all_specs(r)[0]['tests'][0]['results'][0].update(status='failed')),
            ('retry', lambda r: all_specs(r)[0]['tests'][0]['results'][0].update(retry=1)),
            ('duplicate result', lambda r: all_specs(r)[0]['tests'][0]['results'].append(
                {'retry': 0, 'status': 'passed', 'workerIndex': 0})),
            ('summary skip', lambda r: all_specs(r)[0]['tests'][0].update(status='skipped')),
            ('wrong retry config', lambda r: r['config']['projects'][0].update(retries=1)),
            ('wrong repeat config', lambda r: r['config']['projects'][0].update(repeatEach=2)),
            ('config drift', lambda r: r['config'].update(forbidOnly=True)),
        ]
        for name, change in changes:
            with self.subTest(name=name):
                report = copy.deepcopy(self.executed)
                change(report)
                with self.assertRaises(ValueError):
                    self.validate(report)
        with self.assertRaisesRegex(ValueError, 'native execution failed'):
            self.validate(self.executed, 1)

    def test_execution_ci_annotations_do_not_change_configured_metadata(self):
        report = copy.deepcopy(self.executed)
        annotations = {'ci': {'buildHref': 'https://example.test/run'},
                       'gitCommit': {'hash': 'native commit'}, 'gitDiff': 'native diff', 'actualWorkers': 1}
        report['config']['metadata'].update(annotations)
        report['config']['projects'][0]['metadata'] = copy.deepcopy(annotations)
        self.assertEqual(len(self.validate(report)), 2)

    def test_configured_metadata_and_unrecognized_report_changes_remain_bound(self):
        for scope in ['root', 'project']:
            for key in ['ci', 'gitCommit', 'gitDiff', 'actualWorkers', 'custom']:
                with self.subTest(scope=scope, key=key):
                    report = copy.deepcopy(self.executed)
                    inputs = report['nativeMembership']['configuredMetadata']
                    metadata = inputs['root'] if scope == 'root' else inputs['projects'][0]['metadata']
                    metadata[key] = 'changed input'
                    with self.assertRaises(ValueError):
                        self.validate(report)
            report = copy.deepcopy(self.executed)
            target = report['config'] if scope == 'root' else report['config']['projects'][0]
            target.setdefault('metadata', {})['custom'] = 'unexpected mutation'
            with self.assertRaises(ValueError):
                self.validate(report)

    def test_anonymous_parent_titles_still_require_valid_strings_and_exact_join(self):
        for value in [None, 12, [], '\x00']:
            for native in [True, False]:
                with self.subTest(value=value, native=native):
                    report = copy.deepcopy(self.collected)
                    if native:
                        report['nativeMembership']['cases'][0]['titlePath'][0] = value
                    else:
                        report['suites'][0]['suites'][0]['title'] = value
                    with self.assertRaisesRegex(ValueError, 'malformed'):
                        self.collect(report)
        report = copy.deepcopy(self.executed)
        report['nativeMembership']['cases'][0]['titlePath'][0] = ''
        with self.assertRaisesRegex(ValueError, 'disagrees with JSON title'):
            self.validate(report)


class NativeControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sidebar-membership-')
        self.addCleanup(self.temp.cleanup)
        self.subject = Path(self.temp.name)
        # Playwright adds GitHub run metadata during execution but not --list.
        # Exercise that ordinary CI path even when controls are run locally.
        ci = patch.dict(os.environ, {'CI': 'true', 'GITHUB_ACTIONS': 'true',
            'GITHUB_SERVER_URL': 'https://github.com', 'GITHUB_REPOSITORY': 'intent-hq/cloudlands-fe',
            'GITHUB_SHA': 'fixture-sha', 'GITHUB_RUN_ID': 'fixture-run',
            'GITHUB_EVENT_PATH': str(self.subject / 'no-event.json')})
        ci.start()
        self.addCleanup(ci.stop)
        (self.subject / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
        (self.subject / 'test').mkdir()
        (self.subject / 'package.json').write_text(json.dumps({'name': 'sidebar-membership-control', 'private': True}))
        # Caches live outside the dependency symlink, wholly within this fixture.
        self.caches = ['.harness-cache/sidebar']
        (self.subject / 'playwright.config.cjs').write_text(
            "module.exports = { testDir: './test', fullyParallel: true, "
            "projects: [{name: 'chromium'}] };\n")
        self.selected = ['test/cases.spec.ts']
        self.write_cases(['kept', 'removed'])
        self.counter = 0

    def write_cases(self, titles, prefix=''):
        # Native locations point into a registration helper. Membership must use
        # the containing selected file, not the helper's spec.file location.
        (self.subject / 'test/register.cjs').write_text(
            "const { test, expect } = require('@playwright/test');\n"
            "const { appendFileSync } = require('node:fs');\n"
            "exports.register = title => test('same leaf', () => {"
            "expect(2 + 2).toBe(4); appendFileSync('executed.txt', title + '\\n'); });\n")
        (self.subject / 'test/cases.spec.ts').write_text(prefix +
            "const { test } = require('@playwright/test');\n"
            "const { register } = require('./register.cjs');\n" +
            '\n'.join("test.describe(" + json.dumps(title) + ", () => register(" + json.dumps(title) + "));"
                      for title in titles))

    def native(self, listing, workers=1):
        self.counter += 1
        directory = self.subject / ('report-' + str(self.counter))
        directory.mkdir()
        out = directory / 'results.json'
        args = ['pnpm', 'exec', 'playwright', 'test', *self.selected, '--project=chromium',
                '--workers=' + str(workers), '--retries=0', '--repeat-each=1', '--trace=on',
                '--reporter=list,json,' + str(REPO / 'scripts/sidebar-membership-reporter.mjs'), '--output=' + str(self.subject / ('results-' + str(self.counter)))]
        if listing:
            args.append('--list')
        result = subprocess.run(args, cwd=self.subject,
                                env={**os.environ, 'PLAYWRIGHT_JSON_OUTPUT_FILE': str(out),
                                     'SIDEBAR_MEMBERSHIP_OUTPUT_FILE': str(directory / 'native-membership.json')},
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return membership.load_report(directory)

    def test_native_add_remove_rename_and_cold_warm_identity_compatibility(self):
        previous = None
        for titles in [['kept', 'removed'], ['kept', 'removed', 'added'], ['kept', 'added'], ['kept', 'renamed']]:
            with self.subTest(titles=titles):
                self.write_cases(titles)
                marker = self.subject / 'executed.txt'
                before = marker.read_bytes() if marker.exists() else None
                collected = self.native(True)
                self.assertEqual(marker.read_bytes() if marker.exists() else None, before,
                                 'native collection must not execute test bodies')
                self.assertEqual({s['file'] for s in all_specs(collected)}, {'register.cjs'})
                manifest = membership.collect_membership(collected, 1, self.subject, self.selected, 0)
                self.assertEqual({tuple(c['titlePath']) for c in manifest['cases']},
                                 {(title, 'same leaf') for title in titles})
                for _ in ['cold', 'warm']:
                    executed = self.native(False)
                    rows = membership.validate_report(executed, manifest, 1, self.subject, self.selected, 0)
                    self.assertEqual({row['id'] for row in rows}, {case['id'] for case in manifest['cases']})
                if previous:
                    with self.assertRaisesRegex(ValueError, 'membership mismatch'):
                        membership.validate_report(executed, previous, 1, self.subject, self.selected, 0)
                previous = manifest

    def setup_pair(self, name):
        root = self.subject / name
        root.mkdir()
        receipts, payload = root / 'receipts', root / 'payload'
        receipts.mkdir()
        payload.mkdir()
        for key, value in {'subject': self.subject, 'root': root, 'receipts': receipts,
                           'payload': payload, 'workers': 2, 'SPECS': self.selected,
                           'CACHES': self.caches}.items():
            patcher = patch.object(pair, key, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        return root

    def test_native_same_basename_and_same_titles_keep_distinct_file_identities(self):
        nested = self.subject / 'test/nested'
        nested.mkdir()
        source = "const { test, expect } = require('@playwright/test'); test('same leaf', () => expect(2 + 2).toBe(4));"
        (self.subject / 'test/cases.spec.ts').write_text(source)
        (nested / 'cases.spec.ts').write_text(source)
        self.selected.append('test/nested/cases.spec.ts')
        manifest = membership.collect_membership(self.native(True), 1, self.subject, self.selected, 0)
        rows = membership.validate_report(self.native(False), manifest, 1, self.subject, self.selected, 0)
        self.assertEqual({row['file'] for row in rows}, set(self.selected))
        self.assertEqual(len({row['id'] for row in rows}), len(rows))

    def test_native_anonymous_describe_preserves_empty_parent_titles(self):
        (self.subject / 'playwright.config.cjs').write_text(
            "module.exports = { testDir: './test', fullyParallel: true, "
            "metadata: { custom: 'root input', actualWorkers: 7 }, "
            "projects: [{name: 'chromium', metadata: {custom: 'project input'}}] };\n")
        (self.subject / 'test/cases.spec.ts').write_text(
            "const { test, expect } = require('@playwright/test');\n"
            "test.describe(() => { test.describe('named', () => { test.describe(() => {\n"
            "test('ordinary case', () => expect(2 + 2).toBe(4));\n"
            "}); }); });\n")
        collected = self.native(True)
        executed = self.native(False)
        self.assertNotIn('ci', collected['config']['metadata'])
        self.assertIn('ci', executed['config']['metadata'])
        self.assertEqual(executed['nativeMembership']['configuredMetadata'],
                         collected['nativeMembership']['configuredMetadata'])
        self.assertEqual(collected['nativeMembership']['cases'], executed['nativeMembership']['cases'])
        manifest = membership.collect_membership(collected, 1, self.subject, self.selected, 0)
        rows = membership.validate_report(executed, manifest, 1, self.subject, self.selected, 0)
        self.assertEqual([row['titlePath'] for row in rows], [['', 'named', '', 'ordinary case']])
        self.assertEqual(manifest['config']['metadata'], {'custom': 'root input', 'actualWorkers': 7})
        self.assertEqual(manifest['config']['projects'][0]['metadata'], {'custom': 'project input'})

    def test_native_shared_generator_retains_distinct_selected_files(self):
        self.write_cases(['selected source'])
        (self.subject / 'test/second.spec.ts').write_text(
            (self.subject / 'test/cases.spec.ts').read_text().replace('selected source', 'second source'))
        self.selected.append('test/second.spec.ts')
        manifest = membership.collect_membership(self.native(True), 1, self.subject, self.selected, 0)
        rows = membership.validate_report(self.native(False), manifest, 1, self.subject, self.selected, 0)
        self.assertEqual({(row['titlePath'][0], row['file']) for row in rows},
                         {('selected source', 'test/cases.spec.ts'), ('second source', 'test/second.spec.ts')})

    def test_native_unselected_overlapping_file_through_shared_generator_is_rejected(self):
        self.write_cases(['selected source'])
        (self.subject / 'test/cases.spec.ts.extra.spec.ts').write_text(
            (self.subject / 'test/cases.spec.ts').read_text().replace('selected source', 'unselected source'))
        with self.assertRaisesRegex(ValueError, 'unexpected selected file'):
            membership.collect_membership(self.native(True), 1, self.subject, self.selected, 0)

    def test_owned_collection_receipts_and_worker_two_identity(self):
        root = self.setup_pair('owned')
        before = pair.inventory([self.subject / p for p in self.caches], 1024, 10)
        manifest = pair.run('collection')
        after = pair.inventory([self.subject / p for p in self.caches], 1024, 10)
        membership.require_cold_caches(before, after)
        terminal = json.loads((root / 'receipts/collection-terminal.json').read_text())
        self.assertTrue(terminal['ownershipSettled'])
        self.assertTrue(terminal['completedWithinDeadline'])
        self.assertEqual(terminal['signals'], [])
        self.assertEqual(terminal['primaryDeadline'], terminal['startMonotonic'] + 60)
        self.assertEqual(json.loads((root / 'receipts/membership.json').read_text()), manifest)
        membership.validate_report(self.native(False, workers=2), manifest, 2, self.subject, self.selected, 0)

    def test_native_failed_and_empty_collection_retain_terminal_and_stop(self):
        for name, source in [('failure', "throw new Error('collection failed');"), ('empty', '// no cases')]:
            with self.subTest(name=name):
                (self.subject / 'test/cases.spec.ts').write_text(source)
                root = self.setup_pair(name)
                with self.assertRaisesRegex(ValueError, 'native collection failed'):
                    pair.run('collection')
                terminal = json.loads((root / 'receipts/collection-terminal.json').read_text())
                self.assertTrue(terminal['ownershipSettled'])
                self.assertEqual(terminal['primaryExit'], 1)
                self.assertFalse((root / 'receipts/membership.json').exists())

    def test_native_collection_cache_mutation_stops_main_before_cold_without_deleting_evidence(self):
        self.write_cases(['kept'], prefix="require('node:fs').mkdirSync('.harness-cache/sidebar', {recursive:true});\n")
        root = self.subject / 'cache-mutation'
        calls = []
        original_run = pair.run

        def run(cell, manifest=None):
            calls.append(cell)
            self.assertEqual(cell, 'collection', 'cold execution must not start after warmed collection')
            return original_run(cell, manifest)

        with patch.object(pair, 'SPECS', self.selected), patch.object(pair, 'CACHES', self.caches), \
             patch.object(pair, 'git', return_value=''), patch.object(pair, 'run', side_effect=run), \
             patch.object(sys, 'argv', ['sidebar-corrected-pair.py', '1', str(root)]), \
             patch('os.getcwd', return_value=str(self.subject)):
            with self.assertRaisesRegex(ValueError, 'collection changed cold caches'):
                pair.main()
        self.assertEqual(calls, ['collection'])
        self.assertTrue((self.subject / self.caches[0]).is_dir())
        self.assertTrue((root / 'receipts/cold-cache-after-collection.json').is_file())


class PairSequenceControls(unittest.TestCase):
    def test_one_manifest_reused_and_exact_warm_inventory_required(self):
        for corrupt in [False, True]:
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory() as directory:
                subject = Path(directory)
                cache = subject / '.cache/sidebar'
                calls = []
                manifest = {'native': 'same object for both cells'}

                def run(cell, supplied=None):
                    calls.append(cell)
                    if cell == 'collection':
                        return manifest
                    self.assertIs(supplied, manifest)
                    if cell == 'cold':
                        cache.mkdir(parents=True)
                        (cache / 'optimized.js').write_text('original')
                        pair.record('cold-cache-at-terminal', pair.inventory([cache], 1024, 10))
                        if corrupt:
                            (cache / 'optimized.js').write_text('substitution')

                with patch.object(pair, 'CACHES', ['.cache/sidebar']), \
                     patch.object(pair, 'git', return_value=''), patch.object(pair, 'run', side_effect=run), \
                     patch.object(sys, 'argv', ['sidebar-corrected-pair.py', '1', str(subject / 'out')]), \
                     patch('os.getcwd', return_value=str(subject)):
                    if corrupt:
                        with self.assertRaises(AssertionError):
                            pair.main()
                    else:
                        pair.main()
                self.assertEqual(calls, ['collection', 'cold'] if corrupt else ['collection', 'cold', 'warm'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
