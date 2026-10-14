#!/usr/bin/env python3
"""Portable pre-import denial of real processes and networking in retirement tests.

Functional tests inject FakeGitHub or mock subprocess.run. No shell or child
process is needed; CLI parsing is tested in-process. This guard applies on every
supported Python platform, including macOS and Windows.
"""
import os
import sys


def install():
    if getattr(sys, '_retirement_tests_isolated', False):
        return

    def audit(event, _args):
        if event.startswith('socket.') or event in {
            'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec',
            'os.fork', 'os.forkpty', 'pty.spawn',
        }:
            raise RuntimeError('Retirement tests deny real process/network access; inject a fake transport')

    sys.addaudithook(audit)
    for name in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
                 'RETIREMENT_READ_TOKEN', 'CI_QUEUE_READ_TOKEN'):
        os.environ.pop(name, None)
    sys._retirement_tests_isolated = True
