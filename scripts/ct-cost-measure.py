#!/usr/bin/env python3
"""Measure a CI phase without changing its command, output or exit status."""
import json
from pathlib import Path
import subprocess
import sys
import threading
import time


def memory_used_mib():
    fields = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return (int(fields['MemTotal'].split()[0]) - int(fields['MemAvailable'].split()[0])) / 1024


def measure(output, command):
    samples = []
    stopped = threading.Event()

    def sample():
        while True:
            samples.append(memory_used_mib())
            if stopped.wait(1):
                return

    worker = threading.Thread(target=sample)
    start = time.monotonic()
    worker.start()
    code = 127
    try:
        code = subprocess.run(command, check=False).returncode
    finally:
        stopped.set()
        worker.join()
        Path(output).write_text(json.dumps({
            'command': command,
            'exit_code': code,
            'seconds': time.monotonic() - start,
            'peak_host_memory_used_mib': max(samples, default=None),
            'memory_samples': len(samples),
        }) + '\n')
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    if len(sys.argv) < 4 or sys.argv[2] != '--':
        raise SystemExit('usage: ct-cost-measure.py OUTPUT -- COMMAND [ARG...]')
    raise SystemExit(measure(sys.argv[1], sys.argv[3:]))
