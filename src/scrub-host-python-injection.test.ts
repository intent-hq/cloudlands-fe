// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scrubHostNodeInjection } from './scrub-host-node-injection';
import { scrubHostPythonInjection } from './scrub-host-python-injection';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('scrubHostPythonInjection', () => {
  it('removes injected library and bootstrap paths, retaining ordinary entries byte for byte', () => {
    const injected = [
      '/opt/datadog-packages/datadog-apm-library-python/4.15.0',
      '/opt/datadog-packages/datadog-apm-library-python/stable/',
      '/venv/lib/python3.12/site-packages/ddtrace/bootstrap',
    ];
    const legitimate = ['', '/project/python packages', './relative', '/project/ddtrace', ''];
    const env = {
      PYTHONPATH: [legitimate[0], injected[0], ...legitimate.slice(1), ...injected.slice(1)].join(
        delimiter,
      ),
      PYTHONHOME: '/venv',
      PATH: '/usr/bin',
    };

    expect(scrubHostPythonInjection(env)).toEqual(injected);
    expect(env).toEqual({
      PYTHONPATH: legitimate.join(delimiter),
      PYTHONHOME: '/venv',
      PATH: '/usr/bin',
    });
    expect(scrubHostPythonInjection(env)).toEqual([]);
  });

  it('deletes PYTHONPATH when every entry is instrumentation', () => {
    const env: NodeJS.ProcessEnv = {
      PYTHONPATH: '/opt/datadog-packages/datadog-apm-library-python/4.15.0',
    };
    scrubHostPythonInjection(env);
    expect(env).toEqual({});
  });

  it.each([
    undefined,
    '',
    '/project/datadog',
    './my-datadog-apm-library-python/modules',
    '/project/ddtrace/bootstrap-data',
    '/venv/site-packages/ddtrace',
  ])('preserves unrelated PYTHONPATH %s', (value) => {
    const env = value === undefined ? {} : { PYTHONPATH: value };
    const before = { ...env };
    expect(scrubHostPythonInjection(env)).toEqual([]);
    expect(env).toEqual(before);
  });

  it.each(['datadog-apm-library-python/fixture', 'venv/site-packages/ddtrace/bootstrap'])(
    'prevents real Python startup injection from %s while preserving normal imports',
    (injectedPath) => {
      const root = mkdtempSync(join(tmpdir(), 'python-injection-'));
      roots.push(root);
      const injection = join(root, injectedPath);
      const modules = join(root, 'ordinary modules');
      const scratch = join(root, 'scratch');
      for (const dir of [injection, modules, scratch]) mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(injection, 'sitecustomize.py'),
        'import pathlib,tempfile\npathlib.Path(tempfile.gettempdir(), "host-startup").write_text("injected")\n',
      );
      writeFileSync(join(modules, 'ordinary_module.py'), 'VALUE = "legitimate-import"\n');
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TMPDIR: scratch,
        TMP: scratch,
        TEMP: scratch,
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONPATH: [injection, modules].join(delimiter),
        NODE_OPTIONS: '--require /missing/host-preload.cjs',
        DD_INJECTION_ENABLED: 'tracer',
      };
      // Exercise the existing Node scrub/launcher opt-out: neither prevents an
      // already inherited Python sitecustomize from running.
      scrubHostNodeInjection(env);
      env.DD_INSTRUMENT_SERVICE_WITH_APM = 'false';
      const run = () =>
        execFileSync('python3', ['-c', 'import ordinary_module; print(ordinary_module.VALUE)'], {
          cwd: root,
          env,
          encoding: 'utf8',
          timeout: 10_000,
        });
      expect(run()).toBe('legitimate-import\n');
      expect(readdirSync(scratch)).toEqual(['host-startup']);
      rmSync(join(scratch, 'host-startup'));

      scrubHostPythonInjection(env);
      expect(run()).toBe('legitimate-import\n');
      expect(readdirSync(scratch)).toEqual([]);
    },
  );
});
