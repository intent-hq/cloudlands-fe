import json
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(os.environ['GITHUB_WORKSPACE']) / 'evidence'
OWN = str(Path(os.environ['GITHUB_WORKSPACE']))


def sample(previous=None):
    pressure = {}
    for kind in ('cpu', 'memory', 'io'):
        text = Path('/proc/pressure', kind).read_text()
        pressure[kind] = {line.split()[0]: float(re.search(r'avg10=([\d.]+)', line)[1])
                          for line in text.splitlines()}
    workloads = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().decode(errors='replace').strip('\0').split('\0')
            comm = (proc / 'comm').read_text().strip()
            cwd = os.readlink(proc / 'cwd')
            stat = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
        except (OSError, ProcessLookupError):
            continue
        if not args or stat[0] == 'Z':
            continue
        command = ' '.join(args)
        exe = Path(args[0]).name
        compiler = comm in ('rustc', 'clippy-driver', 'cc1', 'cc1plus', 'clang', 'clang++', 'gcc', 'g++', 'cc', 'ld', 'rust-lld')
        cargo = exe.startswith('cargo') and any(a in ('test', 'check', 'build', 'clippy', 'nextest', 'run') for a in args[1:])
        node_gate = (exe.startswith('node') or comm.startswith('vitest')) and bool(re.search(
            r'vitest|playwright/(?:cli|lib/common/process)\.js|run-ct-tests|svelte-check|run-svelte-check|(?:^|/)(?:tsc|vue-tsc)(?: |$)|vite(?:\.js)? (?:build|test)', command))
        browser = comm in ('chrome-headless', 'chromium', 'chrome') and ('--headless' in command or 'ms-playwright' in command)
        python_gate = exe.startswith('python') and any('pytest' in a for a in args[1:3])
        if compiler or cargo or node_gate or browser or python_gate:
            workloads.append({'pid': int(proc.name), 'startTicks': int(stat[19]), 'comm': comm,
                              'cwd': cwd, 'ownWorkspace': cwd.startswith(OWN), 'command': command[:700]})
    affinity = os.sched_getaffinity(0)
    ticks = [0] * 8
    for line in Path('/proc/stat').read_text().splitlines():
        fields = line.split()
        if fields and fields[0].startswith('cpu') and fields[0][3:].isdigit() and int(fields[0][3:]) in affinity:
            for i, value in enumerate(fields[1:9]):
                ticks[i] += int(value)
    idle_percent = None
    if previous:
        total_delta = sum(ticks) - sum(previous['cpuTicks'])
        if total_delta > 0:
            idle_percent = 100 * (ticks[3] - previous['cpuTicks'][3]) / total_delta
    groups = []
    cgroup_error = None
    try:
        relative = next(line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::'))
        root = Path('/sys/fs/cgroup')
        group = root / relative.lstrip('/')
        while True:
            maximum = (group / 'cpu.max').read_text().split() if (group / 'cpu.max').exists() else None
            if maximum is None and group != root:
                raise RuntimeError('Missing non-root cpu.max: ' + str(group))
            stats = {k: int(v) for k, v in (line.split() for line in (group / 'cpu.stat').read_text().splitlines())}
            old = next((x for x in (previous or {}).get('cgroups', []) if x['path'] == str(group)), None)
            groups.append({'path': str(group), 'cpuMax': maximum, 'cpuStat': stats,
                           'quotaCPUs': None if not maximum or maximum[0] == 'max' else int(maximum[0]) / int(maximum[1]),
                           'throttledUsecDelta': stats.get('throttled_usec', 0) - old['cpuStat'].get('throttled_usec', 0) if old else None,
                           'throttledPeriodsDelta': stats.get('nr_throttled', 0) - old['cpuStat'].get('nr_throttled', 0) if old else None})
            if group == root:
                break
            group = group.parent
    except (OSError, RuntimeError, StopIteration, ValueError) as error:
        cgroup_error = str(error)
    return {'time': time.time(), 'monotonic': time.monotonic(), 'load': os.getloadavg(),
            'availableCPUs': len(affinity), 'pressure': pressure, 'cpuTicks': ticks,
            'cpuIdlePercent': idle_percent, 'cgroups': groups, 'cgroupError': cgroup_error,
            'workloads': workloads}

previous = None
while True:
    try:
        row = sample(previous)
        row['memory'] = Path('/proc/meminfo').read_text()
        row['disk'] = __import__('shutil').disk_usage(OWN)._asdict()
        row['processStats'] = []
        for item in row['workloads']:
            proc = Path('/proc') / str(item['pid'])
            try:
                row['processStats'].append({'pid': item['pid'], 'stat': (proc / 'stat').read_text(), 'io': (proc / 'io').read_text(), 'status': (proc / 'status').read_text()})
            except (OSError, ProcessLookupError):
                pass
        print(json.dumps(row), flush=True)
        previous = row
    except Exception as error:
        print(json.dumps({'sampleError': str(error), 'time': time.time()}), flush=True)
    time.sleep(20)
