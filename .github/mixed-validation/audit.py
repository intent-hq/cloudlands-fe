"""External validation only: never modifies the immutable test checkout."""
import base64
import hashlib
import json
import os
import platform
import re
from pathlib import Path
import shutil
import subprocess
import sys
import traceback

HERE = Path(__file__).resolve().parent
EXPECTED = json.loads((HERE / 'expected.json').read_text())
WORKSPACE = Path(os.environ['GITHUB_WORKSPACE'])
REPO = WORKSPACE / 'subject'
OUT = WORKSPACE / 'evidence'
OUT.mkdir(exist_ok=True)


def save(name, data):
    (OUT / name).write_text(json.dumps(data, indent=2) + '\n')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args], text=True).strip()


def recipe_identity():
    identity = {
        'expectedRecipeSha': os.environ.get('EXPECTED_RECIPE_SHA', ''),
        'eventSha': os.environ.get('RECIPE_EVENT_SHA'),
        'githubSha': os.environ.get('GITHUB_SHA'),
        'recipeHead': subprocess.check_output(['git', '-C', str(WORKSPACE / 'recipe'), 'rev-parse', 'HEAD'], text=True).strip(),
        'recipeStatus': subprocess.check_output(['git', '-C', str(WORKSPACE / 'recipe'), 'status', '--porcelain'], text=True).strip(),
        'ref': os.environ.get('GITHUB_REF'),
        'runId': os.environ.get('GITHUB_RUN_ID'),
        'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'subjectHead': git('rev-parse', 'HEAD'),
    }
    save('recipe-identity-' + sys.argv[1] + '.json', identity)
    assert re.fullmatch(r'[0-9a-f]{40}', identity['expectedRecipeSha'])
    assert identity['expectedRecipeSha'] == identity['eventSha'] == identity['githubSha'] == identity['recipeHead']
    assert identity['recipeStatus'] == ''
    assert identity['ref'] == 'refs/heads/validation/mixed-c84e240a'
    assert identity['runAttempt'] == '1' and identity['runId']
    assert identity['subjectHead'] == EXPECTED['head']


def source():
    head, status = git('rev-parse', 'HEAD'), git('status', '--porcelain')
    actual = {name: sha((REPO / name).read_bytes()) for name in EXPECTED['sources']}
    tables = list((REPO / 'node_modules/.pnpm').glob('prosemirror-tables@1.8.5_patch_hash=*/node_modules/prosemirror-tables/dist'))
    assert len(tables) == 1, tables
    dependencies = {key: sha((tables[0] / file).read_bytes()) for key, file in [('esm', 'index.js'), ('cjs', 'index.cjs')]}
    plan = json.loads((OUT / 'browser-plan.json').read_text())
    executable_hash = sha(Path(plan['executablePath']).read_bytes())
    save('source-' + sys.argv[1] + '.json', {'head': head, 'status': status, 'files': actual, 'dependencies': dependencies, 'executableSha256': executable_hash})
    assert head == EXPECTED['head'] and status == '', (head, status)
    assert actual == EXPECTED['sources'], 'source bytes changed'
    assert all(dependencies[key] == EXPECTED[key] for key in dependencies), dependencies
    assert executable_hash == EXPECTED['executableSha256']
    return tables[0]


def cases(report):
    rows = []
    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                rows.append((spec, test))
        for child in suite.get('suites', []):
            walk(child)
    walk(report)
    return rows


def report_contract(report):
    config = report['config']
    assert config['workers'] == 1 and config['shard'] is None
    assert config.get('grepInvert') is None and config['maxFailures'] == 0
    assert config['version'] == '1.58.2'
    assert len(config['projects']) == 1
    project = config['projects'][0]
    assert project['name'] == 'chromium' and project['timeout'] == 30000
    assert project['retries'] == 0 and project['repeatEach'] == 1
    rows = cases(report)
    actual = sorted([[spec['file'], spec['title']] for spec, _ in rows])
    assert len(actual) == 329 and actual == EXPECTED['cases'], 'case inventory differs'
    return rows


def capacity():
    recipe_identity()
    # Recipe suitability minima, not a claim about the configured label's SKU.
    declared = {'cpu': 8, 'memoryGiB': 28, 'diskGiB': 40}
    hosted = os.environ.get('PROOF_RUNNER_ENVIRONMENT')
    operating_system = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    operating_system = {key: value.strip(chr(34)) for key, value in operating_system.items()}
    machine = platform.machine()
    effective_cpu = len(os.sched_getaffinity(0))
    memory = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:'))) * 1024
    group = Path('/sys/fs/cgroup') / next(line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')).lstrip('/')
    groups = []
    while True:
        row = {'path': str(group)}
        for file in ['cpu.max', 'cpu.stat', 'memory.max', 'memory.current', 'io.stat']:
            if (group / file).exists():
                row[file] = (group / file).read_text()
        if 'cpu.max' in row:
            quota, period = row['cpu.max'].split()
            if quota != 'max':
                effective_cpu = min(effective_cpu, int(quota) / int(period))
        if row.get('memory.max', 'max').strip() != 'max':
            memory = min(memory, int(row['memory.max']))
        groups.append(row)
        if group == Path('/sys/fs/cgroup'):
            break
        group = group.parent
    actual = {'effectiveCPU': effective_cpu, 'effectiveMemoryGiB': memory / 2**30, 'freeDiskGiB': shutil.disk_usage(REPO).free / 2**30}
    save('capacity.json', {'runnerEnvironment': hosted, 'operatingSystem': operating_system, 'machine': machine, 'requirements': declared, 'actual': actual, 'cgroups': groups, 'runner': {key: os.environ.get(key) for key in ['RUNNER_NAME', 'RUNNER_OS', 'RUNNER_ARCH', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'ImageOS', 'ImageVersion']}, 'lscpu': subprocess.check_output(['lscpu'], text=True), 'filesystems': subprocess.check_output(['df', '-T', str(REPO)], text=True), 'disks': subprocess.check_output(['lsblk', '-J', '-o', 'NAME,TYPE,SIZE,ROTA,MOUNTPOINTS'], text=True)})
    assert hosted == 'github-hosted', 'existing label must resolve to a GitHub-hosted runner'
    assert os.environ.get('RUNNER_OS') == 'Linux' and os.environ.get('RUNNER_ARCH') == 'X64'
    assert machine == 'x86_64' and operating_system['ID'] == 'ubuntu' and operating_system['VERSION_ID'] == '24.04'
    assert actual['effectiveCPU'] >= declared['cpu']
    assert actual['effectiveMemoryGiB'] >= declared['memoryGiB']
    assert actual['freeDiskGiB'] >= declared['diskGiB']
    # Hosted job VM isolation is not dedicated physical hardware or a speed guarantee.


def bundle():
    wanted = ['src/lib/components/workspace/__tests__/virtual-note/' + name for name in ['bounded-note-service.ts', 'document-session.ts', 'source-journal.ts', 'source-projection.ts', 'list-projection.ts', 'table-projection.ts', 'table-native-command.ts', 'table-alias.ts', 'table-source.ts', 'table-source-view.ts', 'table-transfer.ts', 'table-heights.ts', 'table-payload.ts']]
    wanted += ['src/lib/components/tiptap/CommentAnchor.ts', 'src/lib/utils/editor-config.ts', 'src/lib/utils/markdown-processor.ts']
    rows, dependency_rows = [], []
    for file in (REPO / 'playwright/.cache-18784/assets').glob('*.js.map'):
        mapping = json.loads(file.read_text())
        for name, content in zip(mapping['sources'], mapping.get('sourcesContent', [])):
            if content is None:
                continue
            for target in wanted:
                if name.endswith('/' + target):
                    rows.append({'file': target, 'map': str(file), 'sha256': sha(content.encode())})
            if 'prosemirror-tables@' in name and name.endswith('/dist/index.js'):
                dependency_rows.append({'map': str(file), 'source': name, 'sha256': sha(content.encode())})
    save('consumed-source.json', rows)
    save('consumed-dependencies.json', dependency_rows)
    assert set(row['file'] for row in rows) == set(wanted)
    assert all(row['sha256'] == EXPECTED['sources'][row['file']] for row in rows)
    assert dependency_rows and all(row['sha256'] == EXPECTED['esm'] for row in dependency_rows)


def final():
    recipe_identity()
    source()
    report = json.loads((OUT / 'results.json').read_text())
    rows = report_contract(report)
    runtimes, outcomes = [], []
    for spec, test in rows:
        assert len(test['results']) == 1, (spec['title'], 'missing or repeated attempt')
        result = test['results'][0]
        assert result['retry'] == 0
        outcomes.append({'file': spec['file'], 'title': spec['title'], 'status': result['status'], 'duration': result['duration']})
        attachments = [a for a in result.get('attachments', []) if a['name'] == 'ct-runtime.json']
        assert len(attachments) == 1, spec['title']
        attachment = attachments[0]
        runtime = json.loads(base64.b64decode(attachment['body']) if 'body' in attachment else Path(attachment['path']).read_bytes())
        runtimes.append(runtime)
        assert runtime['source']['head'] == EXPECTED['head'] and runtime['source']['status'] == ''
        assert runtime['expected'] == EXPECTED['runtime'] and runtime['runnerVersion'] == '1.58.2'
        assert runtime['runtime']['product'] == 'HeadlessChrome/153.0.8010.12'
        assert runtime['source']['executableSha256'] == EXPECTED['executableSha256']
        assert runtime['retry'] == 0 and runtime['diagnostic'] is False
        for name, digest in runtime['source']['files'].items():
            assert digest == EXPECTED['sources'][name]
    save('outcomes.json', outcomes)
    save('runtimes.json', runtimes)
    bundle()
    assert len(runtimes) == 329
    assert (OUT / 'gate-exit.txt').read_text().strip() == '0'
    assert all(row['status'] == 'passed' for row in outcomes), 'failed/skipped/interrupted case'
    assert report['stats']['expected'] == 329 and not any(report['stats'][key] for key in ['unexpected', 'skipped', 'flaky'])


def main():
    mode = sys.argv[1]
    if mode == 'capacity':
        capacity()
    elif mode == 'source':
        source()
    elif mode == 'discovery':
        report_contract(json.loads((OUT / 'discovery.json').read_text()))
    elif mode == 'build':
        report = json.loads((OUT / 'build-results.json').read_text())
        assert not cases(report), 'build step selected tests'
        assert not any(report['stats'][key] for key in ['expected', 'unexpected', 'skipped', 'flaky'])
        source()
    elif mode == 'final':
        final()
    else:
        raise ValueError(mode)


try:
    main()
except Exception:
    save('audit-' + sys.argv[1] + '.json', {'ok': False, 'error': traceback.format_exc()})
    raise
else:
    save('audit-' + sys.argv[1] + '.json', {'ok': True})
