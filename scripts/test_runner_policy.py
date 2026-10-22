#!/usr/bin/env python3
"""Reject paid cloud pins while allowing free standard labels and named infrastructure exceptions."""
from pathlib import Path
import json
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
# Standard GitHub-hosted runners are free for public repositories, so jobs may pin
# them directly; the route never sends them to a self-hosted slot or WarpBuild.
FREE = {'ubuntu-22.04', 'ubuntu-24.04', 'ubuntu-latest', 'ubuntu-24.04-arm', 'windows-2022', 'windows-2025'}
# The probe must work when the fleet is offline.
EXCEPTIONS = {('runner-route.yml', 'probe')}
# These jobs refuse to run unless RUNNER_ENVIRONMENT is `github-hosted`, which
# neither a self-hosted slot nor WarpBuild (it reports `self-hosted`) satisfies,
# so they stay on paid GitHub labels.
GITHUB_HOSTED_ONLY = {
    ('b76t-packaged-admission.yml', 'admission'): 'B76 diagnostic: records runner.environment for its GitHub-hosted readiness pair',
    ('b76t-packaged-readiness.yml', 'readiness'): 'B76 readiness requires a GitHub-hosted runner',
    ('build-smoke.yml', 'build-smoke'): 'scripts/run-packaged-linux-smoke.py requires a GitHub-hosted runner',
    ('manual-signed-build.yml', 'smoke-macos'): 'scripts/run-packaged-macos-smoke.py requires a GitHub-hosted runner',
    ('manual-signed-build.yml', 'verify-isolated-macos'): 'scripts/verify-isolated-macos-package.mjs requires a GitHub-hosted runner',
}
EXCEPTIONS |= set(GITHUB_HOSTED_ONLY)
MAINTENANCE = set()


def jobs(text):
    body = text.split('\njobs:\n', 1)[-1]
    return dict(m.groups() for m in re.finditer(r'^  ([\w-]+):\s*\n(.*?)(?=^  [\w-]+:\s*$|\Z)', body, re.M | re.S))


def privileged_steps(body):
    """Steps that call Docker, or sudo outside an `if !` / `command -v ... ||` probe.

    A probe only helps when the intent-cache image already has what it checks
    for; jobs whose probe would still reach sudo there belong in HOSTED_ONLY.
    """
    found = []
    code = '\n'.join(line for line in body.splitlines() if not line.lstrip().startswith('#'))
    for step in re.split(r'^      - ', code, flags=re.M)[1:]:
        guarded = re.search(r'^\s+if ! |command -v [\w-]+ >/dev/null \|\|', step, re.M)
        if re.search(r'\bdocker\b', step) or (re.search(r'\bsudo\b', step) and not guarded):
            found.append(step.splitlines()[0])
    return found


def violations(text, filename):
    errors = []
    for match in re.finditer(r'^  ([\w-]+):\s*\n(.*?)(?=^  [\w-]+:\s*$|\Z)', text.split('\njobs:\n', 1)[-1], re.M | re.S):
        job, body = match.groups()
        runner = re.search(r'^    runs-on: (.+)$', body, re.M)
        if not runner:
            continue
        runner = runner[1].strip('"\'')
        if runner in FREE or (filename, job) in EXCEPTIONS or (job == 'route' and 'id: decide' in body and 'listSelfHostedRunnersForOrg' in body):
            continue
        if runner.startswith('[self-hosted,') and (filename, job) in MAINTENANCE:
            continue
        routed = re.fullmatch(r"\$\{\{ fromJSON\(needs\.(route|runner-route)\.outputs\.(runners|slots|cloud|linux_labels|check_labels).*\}\}", runner)
        # Matrix legs that may take a pool read their own slot first.
        # Reusable workflows receive the caller's route `cloud` map as an input.
        routed = routed or re.fullmatch(r"\$\{\{ fromJSON\(inputs\.cloud \|\| '\{\}'\)\['[\w.-]+'\] \|\| fromJSON\('\[\"[\w.-]+\"\]'\) \}\}", runner)
        routed = routed or re.fullmatch(r"\$\{\{ [^|]+ && fromJSON\(needs\.(route|runner-route)\.outputs\.slots \|\| '\{\}'\)\[format\('[\w-]+-\{0\}', matrix\.\w+\)\] \|\| fromJSON\(needs\.(route|runner-route)\.outputs\.(?:runners|cloud) \|\| '\{\}'\)\[matrix\.(\w+)\] \|\| matrix\.\3 \}\}", runner)
        if not routed and not (runner == '${{ matrix.os }}' and 'needs.route.outputs.' in body):
            errors.append(job)
    return errors


# Free labels may still be listed; the route always gives them their GitHub label.
POOLED = {'gh-linux-8x', 'gh-linux-16x', 'ubuntu-22.04', 'ubuntu-24.04'}
SLOT_READ = re.compile(r"outputs\.slots \|\| '\{\}'\)\[(?:'([\w-]+)'|format\('([\w-]+)-\{0\}', matrix\.\w+\))\] \|\| (?:fromJSON\('\[\"([\w.-]+)\"\]'\)|fromJSON\(needs\.[\w-]+\.outputs\.(?:runners|cloud) \|\| '\{\}'\)\[matrix\.(\w+)\])")


def slot_list(text):
    """The workflow's slot_jobs / SLOT_JOBS list, or None when it lists no jobs."""
    match = re.search(r'^( +)(?:slot_jobs|SLOT_JOBS): >-\n((?:\1 +[^\n]*\n)+)', text, re.M)
    return json.loads(match[2]) if match else None


def slot_violations(text):
    """Listed jobs and the jobs reading outputs.slots must match one to one."""
    listed = slot_list(text) or []
    errors, used = [], set()
    by_key = {entry['key']: entry for entry in listed}
    if len(by_key) != len(listed):
        errors.append('duplicate slot key')
    for entry in listed:
        if entry.get('label') not in POOLED:
            errors.append(f"{entry['key']}: {entry.get('label')} is not an intent-cache pool label")
    for job, body in jobs(text).items():
        runner = re.search(r'^    runs-on: (.+)$', body, re.M)
        if not runner or 'outputs.slots' not in runner[1]:
            continue
        read = SLOT_READ.search(runner[1])
        key = read and (read[1] or read[2])
        entry = by_key.get(key)
        if not entry:
            errors.append(f'{job}: reads an unlisted slot')
            continue
        used.add(key)
        if read[3] and entry['label'] != read[3]:
            errors.append(f"{job}: fallback {read[3]} differs from listed {entry['label']}")
        if read[4] and entry['label'] not in body:
            errors.append(f"{job}: no matrix leg asks for the listed {entry['label']}")
        if bool(read[2]) != bool(entry.get('shards') or entry.get('legs')):
            errors.append(f'{job}: matrix legs and the slot list disagree')
        only = re.search(r"^    if: github\.event_name == '(\w+)'$", body, re.M)
        if only and entry.get('events') != [only[1]]:
            errors.append(f'{job}: runs only on {only[1]} but lists events {entry.get("events")}')
    errors += [f'{key}: listed but no job reads it' for key in by_key.keys() - used]
    return errors


POOL_OF = {'gh-linux-8x': 'heavy', 'gh-linux-16x': 'heavy'}
QUEUE_HOSTED = set()

def pool_reads(body):
    """(pool, several legs?) for a job reading a pool-level mapping, else None."""
    runner = re.search(r'^    runs-on: (.+)$', body, re.M)
    runner = runner[1] if runner else ''
    legs = '    strategy:' in body
    fixed = re.search(r"outputs\.runners \|\| '\{\}'\)\['([\w.-]+)'\]", runner)
    if fixed:
        return (POOL_OF[fixed[1]], legs) if fixed[1] in POOL_OF else None
    if re.search(r'outputs\.(linux_labels|check_labels)', runner):
        return ('heavy', legs)
    by_leg = re.search(r"outputs\.runners \|\| '\{\}'\)\[matrix\.(\w+)\]", runner)
    if by_leg and 'outputs.slots' not in runner and not re.search(r"contains\(matrix\.\w+, 'linux'\)\) && matrix\.", runner):
        labels = [label for label in POOL_OF if label in body]
        return (POOL_OF[labels[0]], True) if labels else None
    return None


def parallel_pool_violations(text, filename):
    """Pooled jobs that can run together must take per-job slots, not the shared mapping."""
    found = jobs(text)
    needs = {}
    for job, body in found.items():
        # `needs: a`, `needs: [a, b]` (possibly on the next line), or a `- a` list.
        match = re.search(r'^    needs:\s*(?:\[([^\]]*)\]|(\S+)$|((?:\n      - [\w-]+)+))', body, re.M)
        names = (match[1] or match[2] or match[3]) if match else ''
        needs[job] = {n.strip(' -\n') for n in re.split(r',|\n', names) if n.strip(' -\n')}
    def after(job, other, seen=()):
        return other in needs[job] or any(after(n, other, seen + (job,)) for n in needs[job] if n in needs and n not in seen)
    readers = {}
    for job, body in found.items():
        read = pool_reads(body)
        if read and (filename, job) not in QUEUE_HOSTED:
            readers.setdefault(read[0], []).append((job, read[1]))
    errors = []
    for pool, members in readers.items():
        for i, (job, legs) in enumerate(members):
            if legs:
                errors.append(f'{job}: several matrix legs share the {pool} pool mapping')
            for other, _ in members[i + 1:]:
                if not after(job, other) and not after(other, job):
                    errors.append(f'{job} and {other} can run together on the {pool} pool mapping')
    return errors


class RunnerPolicy(unittest.TestCase):
    def test_parallel_pooled_jobs_take_per_job_slots(self):
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            with self.subTest(workflow=path.name):
                self.assertEqual(parallel_pool_violations(path.read_text(), path.name), [])

    def test_parallel_pool_detection(self):
        read = """    needs: [{}]\n    runs-on: ${{{{ fromJSON(needs.route.outputs.runners || '{{}}')['gh-linux-16x'] || fromJSON('["gh-linux-16x"]') }}}}\n"""
        two = 'jobs:\n  a:\n' + read.format('route') + '  b:\n' + read.format('route')
        self.assertEqual(len(parallel_pool_violations(two, 'x.yml')), 1)
        self.assertEqual(parallel_pool_violations('jobs:\n  a:\n' + read.format('route') + '  b:\n' + read.format('route, a'), 'x.yml'), [])
        legs = 'jobs:\n  a:\n    strategy:\n      matrix:\n        os: [gh-linux-8x]\n        node: [22, 24]\n    runs-on: ${{ fromJSON(needs.route.outputs.runners || \'{}\')[matrix.os] || matrix.os }}\n'
        self.assertEqual(parallel_pool_violations(legs, 'x.yml'), ['a: several matrix legs share the heavy pool mapping'])

    def test_slot_lists_match_their_jobs(self):
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            with self.subTest(workflow=path.name):
                self.assertEqual(slot_violations(path.read_text()), [])

    def test_slot_list_checks(self):
        job = "  a:\n    if: github.event_name == 'merge_group'\n    runs-on: ${{ fromJSON(needs.route.outputs.slots || '{}')['a'] || fromJSON('[\"ubuntu-24.04\"]') }}\n"
        listing = '    with:\n      slot_jobs: >-\n        [{{"key":"a","label":"{}"{}}}]\njobs:\n'
        self.assertEqual(slot_violations(listing.format('ubuntu-24.04', ',"events":["merge_group"]') + job), [])
        self.assertEqual(len(slot_violations(listing.format('ubuntu-24.04', '') + job)), 1)
        self.assertEqual(len(slot_violations(listing.format('gh-linux-8x', ',"events":["merge_group"]') + job)), 1)
        self.assertEqual(len(slot_violations(listing.format('windows-2025', ',"events":["merge_group"]') + job)), 2)
        self.assertEqual(slot_violations('jobs:\n' + job), ['a: reads an unlisted slot'])

    def test_all_workloads_are_routed(self):
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            with self.subTest(workflow=path.name):
                self.assertEqual(violations(path.read_text(), path.name), [])

    def test_routed_jobs_run_unprivileged(self):
        # A routed Linux job may land on an intent-cache slot, which has no sudo or Docker;
        # jobs reading `cloud` never take a self-hosted runner.
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            for job, body in jobs(path.read_text()).items():
                runner = re.search(r'^    runs-on: (.+)$', body, re.M)
                runner = runner[1] if runner else ''
                cloud_only = ('outputs.cloud' in runner or 'inputs.cloud' in runner) and 'outputs.slots' not in runner
                if (path.name, job) in EXCEPTIONS | MAINTENANCE or cloud_only:
                    continue
                if not re.search(r'needs\.(route|runner-route)\.outputs\.(runners|slots)', runner):
                    continue
                with self.subTest(workflow=path.name, job=job):
                    self.assertEqual(privileged_steps(body), [])

    def test_github_hosted_only_jobs_still_require_it(self):
        for (name, job), reason in GITHUB_HOSTED_ONLY.items():
            with self.subTest(workflow=name, job=job, reason=reason):
                body = jobs((ROOT / '.github/workflows' / name).read_text())[job]
                script = re.search(r'scripts/[\w.-]+', reason)
                text = (ROOT / script[0]).read_text() if script else body
                self.assertTrue('github-hosted' in text or 'runner.environment' in body,
                                'drop the exception once the job accepts WarpBuild')

    def test_privileged_step_detection(self):
        self.assertEqual(privileged_steps('      - run: |\n          if ! pkg-config --exists openssl; then\n            sudo apt-get install -y libssl-dev\n          fi\n'), [])
        self.assertEqual(len(privileged_steps('      - run: sudo apt-get install -y bison\n')), 1)
        self.assertEqual(len(privileged_steps('      - run: sudo -n docker run --rm ubuntu\n')), 1)

    def test_no_tinybox_routing(self):
        # tinybox left the rotation; Linux routing targets the intent-cache slots only.
        for path in [*(ROOT / '.github').rglob('*.yml'), *(ROOT / '.github').rglob('*.yaml')]:
            self.assertNotRegex(path.read_text(), r'(?i)tinybox', str(path))
        for name in ('runner-route.yml', 'intent-pr.yml'):
            self.assertIn("linux: ['self-hosted', 'linux', 'x64', 'intent-cache'],", (ROOT / '.github/workflows' / name).read_text())

    def test_pool_limits_and_xl_fleet(self):
        # Pool sizes are org/repo variables, so adding hosts needs no workflow change;
        # the defaults keep today's routing (no xl slots).
        route = (ROOT / '.github/workflows/runner-route.yml').read_text()
        for env, var, default in [('THRESHOLD', 'CI_LINUX_HEAVY_SLOTS', 2), ('XL_THRESHOLD', 'CI_LINUX_XL_SLOTS', 0)]:
            self.assertIn(f"          {env}: ${{{{ vars.{var} || '{default}' }}}}\n", route)
        self.assertIn("xl: ['self-hosted', 'linux', 'x64', 'intent-cache-xl'],", route)
        # The Linux kill switch covers xl, and only 16-core jobs may take an xl slot.
        self.assertIn("xl: process.env.LINUX_RUNNER_DISABLED === 'true',", route)
        self.assertIn("xl: ['gh-linux-16x'],", route)
        self.assertLess(route.index("xl: ['gh-linux-16x'],"), route.index("linux: ['gh-linux-8x', 'gh-linux-16x'],"))

    def test_policy_rejects_new_paid_pins(self):
        for label in ['gh-linux-8x', 'gh-linux-16x', 'gh-windows-16x', 'macos-26-xlarge', 'macos-15-xlarge',
                      '${{ matrix.runner }}', '${{ needs.unrelated.outputs.runner }}']:
            self.assertEqual(violations(f'jobs:\n  new-work:\n    runs-on: {label}\n', 'new.yml'), ['new-work'])
        # Free standard labels and the cloud mapping are allowed.
        for label in sorted(FREE) + ["${{ fromJSON(needs.runner-route.outputs.cloud || '{}')['gh-linux-8x'] || fromJSON('[\"gh-linux-8x\"]') }}"]:
            self.assertEqual(violations(f'jobs:\n  new-work:\n    runs-on: {label}\n', 'new.yml'), [])

    def test_route_knows_the_free_labels(self):
        route = (ROOT / '.github/workflows/runner-route.yml').read_text()
        listed = re.search(r"const free = \[([^\]]*)\];", route)[1]
        self.assertEqual({label.strip(" '") for label in listed.split(',')}, FREE)

    def test_paid_mac_and_windows_jobs_skip_self_hosted_runners(self):
        # Mac and Windows jobs that used paid GitHub runners go straight to WarpBuild.
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            for job, body in jobs(path.read_text()).items():
                runner = re.search(r'^    runs-on: (.+)$', body, re.M)
                if not runner or (path.name, job) in EXCEPTIONS:
                    continue
                if re.search(r"gh-windows-16x|macos-|matrix\.runner", runner[1]) and 'gh-linux' not in runner[1]:
                    with self.subTest(workflow=path.name, job=job):
                        self.assertIn('outputs.cloud', runner[1])

    def test_routing_behavior(self):
        subprocess.run(['node', '--test', str(ROOT / 'scripts/runner-policy.test.cjs')], check=True)


if __name__ == '__main__':
    unittest.main()
