"""Single-case, read-only hosted diagnostic. Not a release or test-retry driver."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.diagnostics' / 'dev-console-stall'
CASE = 'native console isolation, duplicate focus, reload, crash, load failure and reopen$'
COMMAND = ['xvfb-run', '-a', 'pnpm', 'run', 'test:playwright:manual:browser-lifetime',
           '--workers=1', '--retries=0', '--grep', CASE, '--trace=on', '--reporter=list,json']
SOURCE_FILES = ['test/electron-browser-lifetime-dev-console.fixture.ts',
                'test/electron-browser-lifetime.spec.ts', 'playwright.manual.config.ts',
                'playwright.config.ts', 'src/features/dev-console/main/dev-console-window.ts',
                'src/features/dev-console/main/dev-console-capture.ts',
                'src/main/window-backend.ts', 'src/preload/index.template.ts',
                'scripts/dev-console-stall-diagnostic.py', 'scripts/dev-console-native-observer.py',
                '.github/workflows/nightly-browser-tests.yml', '.github/workflows/browser-tests.yml',
                'package.json', 'pnpm-lock.yaml']


def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + '\n')


def tracked_hashes():
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
            for p in paths if p and (ROOT / p).is_file()}


def generated_hashes():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT / 'src/shared/paraglide').rglob('*') if p.is_file()}


def prepare():
    if (OUT / 'prepared.json').exists():
        raise RuntimeError('Refusing to overwrite an earlier diagnostic')
    write('prepared.json', {
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'parents': subprocess.check_output(['git', 'show', '-s', '--format=%P', 'HEAD'], cwd=ROOT, text=True).strip(),
        'originalHostedCheckout': 'af099159923b793d357b6feb7134388dadaa9ad5',
        'command': COMMAND, 'inputs': tracked_hashes(),
        'context': {k: os.environ.get(k) for k in ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
                   'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'RUNNER_NAME', 'RUNNER_OS', 'RUNNER_ARCH']},
        'limits': 'One case; original 60s test and 30s teardown; diagnostic retries=0. '
                  'Instrumentation changes timing; matching runner label is not matching machine.'})
    for name in SOURCE_FILES:
        dest = OUT / 'source' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, dest)


def ready():
    prepared = json.loads((OUT / 'prepared.json').read_text())
    if prepared['inputs'] != tracked_hashes():
        raise RuntimeError('Tracked input drift during setup')
    subprocess.run(['node', '--input-type=module', '-e',
                    "import {canReuseGeneratedParaglide,repoParaglidePaths} from './scripts/paraglide-inputs-hash.mjs';"
                    "if(!canReuseGeneratedParaglide(repoParaglidePaths(process.cwd())))throw Error('Generated input mismatch');"],
                   cwd=ROOT, check=True)
    executable = subprocess.check_output(['node', '-e',
        "const f=require('fs'),p=require('path'),r=p.dirname(require.resolve('electron/package.json'));"
        "process.stdout.write(p.join(r,'dist',f.readFileSync(p.join(r,'path.txt'),'utf8').trim()))"], cwd=ROOT, text=True).strip()
    if not os.access(executable, os.X_OK):
        raise RuntimeError('Electron binary not executable')
    versions = subprocess.check_output(['node', '-e',
        "console.log(JSON.stringify({node:process.version,electron:require('electron/package.json').version,"
        "playwright:require('@playwright/test/package.json').version,vite:require('vite/package.json').version}))"],
        cwd=ROOT, text=True).strip()
    with open(executable, 'rb') as binary:
        digest = hashlib.file_digest(binary, 'sha256').hexdigest()
    discovery = subprocess.check_output(['pnpm', 'run', 'test:playwright:manual:browser-lifetime',
        '--list', '--grep', CASE], cwd=ROOT, text=True, stderr=subprocess.STDOUT)
    (OUT / 'discovery.log').write_text(discovery)
    if 'Total: 1 test in 1 file' not in discovery:
        raise RuntimeError('Expected exactly one diagnostic case')
    write('ready.json', {'versions': json.loads(versions), 'electronSha256': digest,
                        'electronBytes': Path(executable).stat().st_size, 'generatedInputs': generated_hashes()})
    capability_env = dict(os.environ, DEV_CONSOLE_DIAGNOSTIC_DIR=str(OUT))
    subprocess.run([sys.executable, 'scripts/dev-console-native-observer.py', '--self-test'],
                   cwd=ROOT, env=capability_env, check=True, timeout=10)
    write('native-capability-ready.json', {'checked': True})


def run():
    prepared = json.loads((OUT / 'prepared.json').read_text())
    readiness = json.loads((OUT / 'ready.json').read_text())
    if json.loads((OUT / 'native-capability-ready.json').read_text()) != {'checked': True}:
        raise RuntimeError('Native collector capability was not qualified')
    if prepared['inputs'] != tracked_hashes() or readiness['generatedInputs'] != generated_hashes():
        raise RuntimeError('Input drift before launch')
    if (OUT / 'runner-process.json').exists():
        raise RuntimeError('Diagnostic already attempted; no automatic replay')
    env = os.environ.copy()
    env.update(DEBUG='pw:protocol,pw:api', DEV_CONSOLE_DIAGNOSTIC_DIR=str(OUT),
               PLAYWRIGHT_JSON_OUTPUT_FILE=str(OUT / 'results.json'), PLAYWRIGHT_HTML_OPEN='never')
    # Keep hosted CI/environment; only the explicit diagnostic retry policy differs.
    ansi = re.compile(r'\x1b\[[0-9;]*m')
    pending = {}
    count = 0
    parse_errors = 0
    log_bytes = 0
    started = time.time()
    with (OUT / 'output.log').open('w') as log, (OUT / 'protocol.jsonl').open('w', buffering=1) as protocol:
        observed_command = [sys.executable, 'scripts/dev-console-native-observer.py', '--', *COMMAND]
        proc = subprocess.Popen(observed_command, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, bufsize=1)
        write('runner-process.json', {'pid': proc.pid, 'startedAt': started, 'command': observed_command})
        for raw in proc.stdout:
            line = ansi.sub('', raw).rstrip()
            at = time.time_ns() // 1000000
            if 'pw:protocol' in line:
                match = re.search(r'(SEND ►|◀ RECV) (\{.*\})', line)
                if match:
                    try:
                        data = json.loads(match.group(2))
                    except json.JSONDecodeError:
                        parse_errors += 1
                        continue
                    direction = 'send' if match.group(1).startswith('SEND') else 'receive'
                    key = (data.get('sessionId'), data.get('id'))
                    if direction == 'send':
                        pending.setdefault(key, []).append((data.get('method'), at))
                    matches = pending.get(key, [])
                    method = data.get('method') or (matches[0][0] if len(matches) == 1 else None)
                    item = {'at': at, 'direction': direction, 'id': data.get('id'),
                            'sessionId': data.get('sessionId'), 'method': method,
                            'hasResult': 'result' in data, 'hasError': 'error' in data}
                    if direction == 'receive' and key in pending:
                        matches = pending.pop(key)
                        if len(matches) == 1:
                            item['responseAfterMs'] = at - matches[0][1]
                        else:
                            item['ambiguousConnectionIds'] = True
                    if count < 15000:
                        protocol.write(json.dumps(item) + '\n')
                    count += 1
                continue
            line = re.sub(r'(?:https?|wss?)://\S+', '[url]', line)
            line = re.sub(r'(?i)(?:Bearer\s+|token[=:]\s*)[A-Za-z0-9._-]+', '[credential]', line)[:4096]
            rendered = json.dumps({'at': at, 'line': line}) + '\n'
            if log_bytes + len(rendered.encode()) <= 1048576:
                log.write(rendered)
                log.flush()
                log_bytes += len(rendered.encode())
        code = proc.wait()
    input_drift = prepared['inputs'] != tracked_hashes()
    generated_drift = readiness['generatedInputs'] != generated_hashes()
    write('result.json', {'exitCode': code, 'startedAt': started, 'finishedAt': time.time(),
                         'protocolRecordsObserved': count, 'protocolRecordsCap': 15000, 'protocolParseErrors': parse_errors,
                         'logBytes': log_bytes, 'inputDrift': input_drift, 'generatedInputDrift': generated_drift})
    print(json.dumps({'exitCode': code, 'artifacts': '.diagnostics/dev-console-stall'}))
    return code or (2 if input_drift or generated_drift else 0)


def seal():
    if (ROOT / 'test-results').exists():
        shutil.copytree(ROOT / 'test-results', OUT / 'test-results', dirs_exist_ok=True)
    write('final-inputs.json', tracked_hashes())
    write('manifest.json', {str(p.relative_to(OUT)): hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in OUT.rglob('*') if p.is_file() and p != OUT / 'manifest.json'})


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    mode = sys.argv[1] if len(sys.argv) == 2 else ''
    if mode == '--prepare':
        prepare()
    elif mode == '--ready':
        ready()
    elif mode == '--run':
        sys.exit(run())
    elif mode == '--seal':
        seal()
    else:
        raise SystemExit('Expected --prepare, --ready, --run or --seal')
