#!/usr/bin/env python3
"""Exercise branch-only benchmark safety and measurement failure handling."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]


class Measurement(unittest.TestCase):
    def test_command_output_and_failure_are_preserved(self):
        for code in (0, 7):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'phase.json'
                command = [sys.executable, '-c', f'print("observable child output"); raise SystemExit({code})']
                result = subprocess.run([sys.executable, str(ROOT / 'scripts/ct-cost-measure.py'), str(output), '--', *command], capture_output=True, text=True)
                self.assertEqual(result.returncode, code)
                self.assertIn('observable child output', result.stdout)
                data = json.loads(output.read_text())
                self.assertEqual(data['exit_code'], code)
                self.assertEqual(data['command'], command)
                self.assertGreater(data['memory_samples'], 0)
                self.assertGreater(data['peak_host_memory_used_mib'], 0)

    def test_missing_command_fails_and_leaves_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'phase.json'
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/ct-cost-measure.py'), str(output), '--', '/missing/ct-cost-command'], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(json.loads(output.read_text())['exit_code'], 127)


class Workflow(unittest.TestCase):
    def test_every_production_ct_step_is_retained(self):
        baseline = yaml.safe_load((ROOT / '.github/workflows/browser-tests.yml').read_text())['jobs']['test-ct']
        benchmark = yaml.safe_load((ROOT / '.github/workflows/nightly-browser-tests.yml').read_text())['jobs']['test-ct']
        steps = {s.get('name'): s for s in benchmark['steps']}
        for original in baseline['steps']:
            with self.subTest(step=original.get('name')):
                actual = json.loads(json.dumps(steps[original.get('name')]))
                if original.get('name') in ('Build CT bundle', 'Component tests'):
                    for phase in ('build', 'tests'):
                        actual['run'] = actual['run'].replace(f'python3 -I -B scripts/ct-cost-measure.py "$RUNNER_TEMP/ct-{phase}.json" -- ', '')
                    actual['run'] = actual['run'].replace('--workers=${{ matrix.config.workers }} ', '')
                if 'with' in actual and 'name' in actual['with']:
                    actual['with']['name'] = actual['with']['name'].replace('${{ matrix.config.name }}-', '').replace('-${{ matrix.config.name }}', '')
                self.assertEqual(actual, original)

    def test_manual_comparison_keeps_all_four_shards_and_failure_policy(self):
        workflow = yaml.safe_load((ROOT / '.github/workflows/nightly-browser-tests.yml').read_text())
        self.assertEqual(set(workflow.get('on', workflow.get(True))), {'workflow_dispatch'})
        self.assertEqual(workflow['permissions'], {'contents': 'read'})
        job = workflow['jobs']['test-ct']
        self.assertFalse(job['strategy']['fail-fast'])
        self.assertEqual(job['strategy']['matrix']['shard'], [1, 2, 3, 4])
        configs = job['strategy']['matrix']['config']
        self.assertEqual([(c['runner'], c['workers']) for c in configs], [
            ('depot-ubuntu-24.04-8', 1), ('depot-ubuntu-24.04-8', 2), ('depot-ubuntu-24.04-4', 1),
        ])
        steps = {s.get('name'): s for s in job['steps']}
        tests = steps['Component tests']
        self.assertNotIn('continue-on-error', tests)
        self.assertIn('--fail-on-flaky-tests', tests['run'])
        self.assertIn('--shard=${{ matrix.shard }}/4', tests['run'])
        self.assertIn("--grep-invert '@quarantine\\b'", tests['run'])
        self.assertIn('--workers=${{ matrix.config.workers }}', tests['run'])
        self.assertEqual(steps['Upload playwright report']['if'], 'always()')
        self.assertIn('${{ matrix.config.name }}', steps['Upload playwright report']['with']['name'])
        self.assertEqual(steps['Upload benchmark measurements']['if'], 'always()')
        self.assertIn('--only-changed=HEAD --pass-with-no-tests', steps['Build CT bundle']['run'])
        self.assertEqual(job['timeout-minutes'], 50)


if __name__ == '__main__':
    unittest.main()
