// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CT_CONTRACT_PATHS,
  CT_HARNESS_ENTRY,
  CT_PREVIEW_REGISTRY_GLOB,
  changedFiles,
  ctRequired,
  isCtContractPath,
  main,
  sourceReferences,
} from './ct-contract-paths.mjs';

const CLI = resolve('scripts/ct-contract-paths.mjs');

const temporaryPaths: string[] = [];

function git(root: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitFile(root: string, file: string, content = '') {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  git(root, 'add', file);
  git(root, 'commit', '-q', '-m', `add ${file}`);
}

function gitRepository() {
  const root = mkdtempSync(join(tmpdir(), 'ct-contract-paths-'));
  temporaryPaths.push(root);
  git(root, 'init', '-q');
  // Detached maintenance can remove a lock during rmSync and leave the fixture behind.
  git(root, 'config', 'maintenance.auto', 'false');
  git(root, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(root, 'config', 'user.name', 'ct-contract-paths test');
  git(root, 'config', 'user.email', 'ct-contract-paths@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.quotePath', 'true');
  git(root, 'config', 'diff.renames', 'true');
  commitFile(root, 'src/base.ts');
  commitFile(root, 'src/lib/styles/tokens.css', ':root { --a: 1; }');
  return root;
}

function branch(root: string, name: string, ...files: string[]) {
  git(root, 'checkout', '-q', '-b', name, 'main');
  for (const file of files) commitFile(root, file, `// ${name}`);
}

function runCli(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('disposable Git fixture ownership', () => {
  it('does not launch automatic maintenance', () => {
    const traceRoot = mkdtempSync(join(tmpdir(), 'ct-fixture-trace-'));
    temporaryPaths.push(traceRoot);
    const trace = join(traceRoot, 'events.json');
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_TRACE2_EVENT', trace);
    try {
      gitRepository();
      const children = readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
        .filter((event) => event.event === 'child_start')
        .map((event) => event.argv ?? []);
      expect(
        children.filter((argv) => argv.includes('maintenance') || argv.includes('gc')),
      ).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('isCtContractPath', () => {
  it.each([
    'src/app.css',
    'src/lib/styles/tokens.css',
    'src/lib/styles/nested/theme.css',
    'playwright-ct.config.ts',
    'playwright/index.ts',
    'playwright/app-stubs/stores.ts',
    'scripts/run-ct-tests.mjs',
    'scripts/ct-browser.mjs',
    'scripts/playwright-os-deps-lib.mjs',
    'patches/playwright-core@1.58.2.patch',
    'src/test/ct-test.ts',
    'src/lib/component-catalog/capture-stability.ts',
    'src/lib/component-catalog/preview-definition.ts',
    'package.json',
    'pnpm-lock.yaml',
    './src/app.css',
  ])('matches %s', (file) => {
    expect(isCtContractPath(file)).toBe(true);
  });

  it.each([
    'src/foo.test.ts',
    'src/lib/example.ts',
    'src/lib/styles-legacy/tokens.css',
    'src/app.css.map',
    'src/lib/component-catalog/catalog.ts',
    'src/lib/component-catalog/geometry-probe.ts',
    'src/lib/component-catalog/geometry-probe.test.ts',
    'src/lib/component-catalog/nested/preview-definition.ts',
    'src/test/ct-console-errors.ts',
    'playwright.config.ts',
    'scripts/verify-changed.mjs',
    'scripts/ct-contract-paths.mjs',
    'packages/cloudlands-fe/package.json',
    'e2e/playwright/index.ts',
    '.github/workflows/intent-pr.yml',
    'src/lib/components/ui/button/button.keyboard.ct.spec.ts',
  ])('does not match %s', (file) => {
    expect(isCtContractPath(file)).toBe(false);
  });

  it('exports the CT harness dependency paths', () => {
    expect([...CT_CONTRACT_PATHS].sort()).toEqual([
      'package.json',
      'patches/playwright-core@1.58.2.patch',
      'playwright-ct.config.ts',
      'playwright/**',
      'pnpm-lock.yaml',
      'scripts/ct-browser.mjs',
      'scripts/playwright-os-deps-lib.mjs',
      'scripts/run-ct-tests.mjs',
      'src/app.css',
      'src/lib/component-catalog/capture-stability.ts',
      'src/lib/component-catalog/preview-definition.ts',
      'src/lib/styles/**',
      'src/test/ct-test.ts',
    ]);
  });
});

describe('ctRequired and main', () => {
  it('requires CT when any changed file is a contract path', () => {
    expect(ctRequired(['src/lib/example.ts', 'src/lib/styles/tokens.css'])).toBe(true);
    expect(ctRequired(['src/lib/example.ts', 'scripts/verify-changed.mjs'])).toBe(false);
    expect(ctRequired([])).toBe(false);
  });

  it('requires CT when any changed file is a discovered CT spec', () => {
    expect(ctRequired(['src/lib/components/ui/button/button.keyboard.ct.spec.ts'])).toBe(true);
    expect(ctRequired(['test/added.ct.spec.ts'])).toBe(false);
    expect(ctRequired(['src/lib/components/ui/button/button.ct.test.ts'])).toBe(false);
    expect(ctRequired(['src/lib/components/ui/button/button.ct.spec.js'])).toBe(false);
    expect(ctRequired(['src/lib/components/ui/button/button.svelte'])).toBe(false);
  });

  it('prints one ct_required line from the injected diff', () => {
    const calls: string[][] = [];
    const io = (files: string[]) => {
      const logs: string[] = [];
      const code = main(['--diff', 'base', 'head'], {
        diff: (base: string, head: string) => {
          calls.push([base, head]);
          return files;
        },
        dependencies: () => new Set(),
        log: (line: string) => logs.push(line),
        warn: () => {},
      });
      return { code, logs };
    };
    expect(io(['src/app.css'])).toEqual({ code: 0, logs: ['ct_required=true'] });
    expect(io(['src/foo.test.ts'])).toEqual({ code: 0, logs: ['ct_required=false'] });
    expect(calls).toEqual([
      ['base', 'head'],
      ['base', 'head'],
    ]);
  });

  it('fails safe to ct_required=true on a diff error or bad usage', () => {
    for (const argv of [['--diff', 'base', 'head'], ['--diff', 'base'], [], ['--list']]) {
      const logs: string[] = [];
      const warnings: string[] = [];
      const code = main(argv, {
        diff: () => {
          throw new Error('git exploded');
        },
        log: (line: string) => logs.push(line),
        warn: (line: string) => warnings.push(line),
      });
      expect(code, argv.join(' ')).toBe(0);
      expect(logs, argv.join(' ')).toEqual(['ct_required=true']);
      expect(warnings.join('\n'), argv.join(' ')).toContain('fail-safe');
    }
  });
});

describe('--diff against a git repository', () => {
  it('lists added, modified and deleted files between two refs', () => {
    const root = gitRepository();
    branch(root, 'feature', 'src/lib/styles/theme.css', 'src/base.ts');
    git(root, 'rm', '-q', 'src/lib/styles/tokens.css');
    git(root, 'commit', '-q', '-m', 'remove tokens');
    expect(changedFiles('main', 'feature', { cwd: root }).sort()).toEqual([
      'src/base.ts',
      'src/lib/styles/theme.css',
      'src/lib/styles/tokens.css',
    ]);
  });

  it('prints ct_required=false when the diff only touches scripts and tests', () => {
    const root = gitRepository();
    branch(root, 'scripts-only', 'scripts/verify-changed.mjs', 'src/foo.test.ts');
    expect(runCli(root, '--diff', 'main', 'scripts-only')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it('prints ct_required=true when a contract path is in the diff', () => {
    const root = gitRepository();
    branch(root, 'tokens', 'scripts/verify-changed.mjs', 'src/lib/styles/tokens.css');
    expect(runCli(root, '--diff', 'main', 'tokens')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'deleted', 'src/other.ts');
    git(root, 'rm', '-q', 'src/lib/styles/tokens.css');
    git(root, 'commit', '-q', '-m', 'remove tokens');
    expect(runCli(root, '--diff', 'main', 'deleted').stdout).toBe('ct_required=true\n');
  });

  it('requires CT for a dist:all script edit without dependency changes', () => {
    const root = gitRepository();
    const manifest = {
      scripts: { 'dist:all': 'electron-builder -mw' },
      devDependencies: { '@playwright/test': '1.58.2' },
    };
    commitFile(root, 'package.json', JSON.stringify(manifest));
    branch(root, 'manifest-edit');
    commitFile(
      root,
      'package.json',
      JSON.stringify({ ...manifest, scripts: { 'dist:all': 'electron-builder -mwl' } }),
    );
    expect(runCli(root, '--diff', 'main', 'manifest-edit')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
  });

  it('requires CT for a discovered spec, but not an unrelated component or undiscovered spec', () => {
    const root = gitRepository();
    branch(root, 'spec-only', 'src/lib/components/ui/button/button.keyboard.ct.spec.ts');
    expect(runCli(root, '--diff', 'main', 'spec-only')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'svelte-only', 'src/lib/components/ui/button/button.svelte');
    expect(runCli(root, '--diff', 'main', 'svelte-only').stdout).toBe('ct_required=false\n');
    branch(root, 'spec-outside-src', 'test/added.ct.spec.ts');
    expect(runCli(root, '--diff', 'main', 'spec-outside-src').stdout).toBe('ct_required=false\n');
  });

  it('keeps non-ASCII paths verbatim instead of the quoted form git prints by default', () => {
    const root = gitRepository();
    branch(root, 'unicode', 'src/lib/styles/thème.css');
    expect(changedFiles('main', 'unicode', { cwd: root })).toEqual(['src/lib/styles/thème.css']);
    expect(runCli(root, '--diff', 'main', 'unicode')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
  });

  it('reports both sides of a rename so a contract file moved away still requires CT', () => {
    const root = gitRepository();
    branch(root, 'renamed');
    git(root, 'mv', 'src/lib/styles/tokens.css', 'src/moved.css');
    git(root, 'commit', '-q', '-m', 'move tokens');
    expect(git(root, 'diff', '--name-status', '-M', 'main', 'renamed')).toMatch(/^R100\t/);
    expect(changedFiles('main', 'renamed', { cwd: root }).sort()).toEqual([
      'src/lib/styles/tokens.css',
      'src/moved.css',
    ]);
    expect(runCli(root, '--diff', 'main', 'renamed')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
  });

  it('exits 0 with ct_required=true when git cannot resolve the refs', () => {
    const root = gitRepository();
    const result = runCli(root, '--diff', 'main', 'no-such-ref');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ct_required=true\n');
    expect(result.stderr).toContain('fail-safe');
  });
});

describe('CT spec fixture dependencies', () => {
  const spec = 'src/lib/components/chat/input/__tests__/member-mentions.ct.spec.ts';
  const host = 'src/lib/components/chat/input/__tests__/MemberMentionsHost.svelte';

  function fixtureRepository(imports = "import Host from './MemberMentionsHost.svelte';") {
    const root = gitRepository();
    commitFile(root, host, '<div>original fixture</div>');
    commitFile(root, spec, imports);
    return root;
  }

  it('requires CT for a MemberMentionsHost-only modification, even on another checkout', () => {
    const root = fixtureRepository();
    branch(root, 'fixture-only', host);
    git(root, 'checkout', '-q', '--orphan', 'unrelated-checkout');
    git(root, 'rm', '-q', '-rf', '.');
    commitFile(root, 'unrelated.txt');
    expect(runCli(root, '--diff', 'main', 'fixture-only')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    expect(isCtContractPath(host)).toBe(false);
  });

  it.each([
    [
      "import Host from './AddedHost.svelte';",
      'src/lib/components/chat/input/__tests__/AddedHost.svelte',
    ],
    [
      "import { data } from './fixture-data';",
      'src/lib/components/chat/input/__tests__/fixture-data.ts',
    ],
    [
      "import { data } from './fixtures';",
      'src/lib/components/chat/input/__tests__/fixtures/index.ts',
    ],
    [
      "import { preview } from './example.preview';",
      'src/lib/components/chat/input/__tests__/example.preview.ts',
    ],
    ["import Host from '$lib/fixtures/Host.svelte';", 'src/lib/fixtures/Host.svelte'],
    ["import Host from '$features/example/Host.svelte';", 'src/features/example/Host.svelte'],
    ["import { data } from '$shared/fixture';", 'src/shared/fixture.ts'],
    ["import { data } from '$store/fixture';", 'src/store/fixture.ts'],
    ["import './fixture.css';", 'src/lib/components/chat/input/__tests__/fixture.css'],
    [
      "const host = import('./LazyHost.svelte');",
      'src/lib/components/chat/input/__tests__/LazyHost.svelte',
    ],
    [
      "export { default } from './ExportedHost.svelte';",
      'src/lib/components/chat/input/__tests__/ExportedHost.svelte',
    ],
    ["import Host from\n './Hôte.svelte';", 'src/lib/components/chat/input/__tests__/Hôte.svelte'],
  ])('requires CT when a direct dependency is added: %s', (imports, fixture) => {
    const root = fixtureRepository(imports);
    branch(root, 'added-fixture', fixture);
    expect(runCli(root, '--diff', 'main', 'added-fixture')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
  });

  it.each(['delete', 'rename'])(
    'requires CT when a referenced fixture is removed by %s',
    (change) => {
      const root = fixtureRepository();
      branch(root, 'removed-fixture');
      if (change === 'rename') git(root, 'mv', host, 'src/moved.svelte');
      else git(root, 'rm', '-q', host);
      git(root, 'commit', '-q', '-m', change);
      expect(runCli(root, '--diff', 'main', 'removed-fixture')).toEqual({
        status: 0,
        stdout: 'ct_required=true\n',
        stderr: '',
      });
    },
  );

  it('ignores stale dependencies removed before the requested fixture-only diff', () => {
    const root = fixtureRepository();
    branch(root, 'new-spec', spec);
    commitFile(root, spec, "import Host from './OtherHost.svelte';");
    const base = git(root, 'rev-parse', 'HEAD');
    commitFile(root, host, 'changed old dependency');
    expect(runCli(root, '--diff', base, 'HEAD').stdout).toBe('ct_required=false\n');
    expect(runCli(root, '--diff', 'main', 'HEAD').stdout).toBe('ct_required=true\n');
  });

  it.each([
    'src/lib/components/chat/input/__tests__/UnreferencedHost.svelte',
    'src/lib/components/chat/input/__tests__/unit-only-fixture.ts',
    'src/lib/components/chat/input/production.svelte',
    'src/lib/components/chat/input/__tests__/unused/index.ts',
  ])('does not select files no CT run can load: %s', (file) => {
    const root = fixtureRepository();
    commitFile(root, host, "<script>import value from './nested';</script>");
    commitFile(
      root,
      'src/lib/components/chat/input/__tests__/unit.test.ts',
      "import './unit-only-fixture';",
    );
    commitFile(
      root,
      'test/not-discovered.ct.spec.ts',
      "import '../src/lib/components/chat/input/production.svelte';",
    );
    branch(root, 'unrelated', file);
    expect(runCli(root, '--diff', 'main', 'unrelated')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it('recognizes dependencies of dot-directory and mixed-case discovered specs', () => {
    const root = gitRepository();
    commitFile(root, 'src/.tests/example.CT.SPEC.TS', "import './Fixture.svelte';");
    branch(root, 'fixture', 'src/.tests/Fixture.svelte');
    expect(runCli(root, '--diff', 'main', 'fixture').stdout).toBe('ct_required=true\n');
  });

  it.each(['delete', 'rename'])(
    'keeps base-only references safe when the spec and fixture %s',
    (change) => {
      const root = fixtureRepository();
      branch(root, 'removed-spec-and-fixture');
      if (change === 'rename') {
        git(root, 'mv', host, 'src/moved.svelte');
        git(root, 'mv', spec, 'src/moved.test.ts');
      } else git(root, 'rm', '-q', host, spec);
      git(root, 'commit', '-q', '-m', change);
      expect(runCli(root, '--diff', 'main', 'HEAD')).toEqual({
        status: 0,
        stdout: 'ct_required=true\n',
        stderr: '',
      });
    },
  );

  it.each([
    "const host = import('./' + name);",
    'const host = import(`./${name}.svelte`);',
    'const hosts = import.meta.glob(pattern);',
    "const hosts = import.meta.glob('!./*.svelte');",
    "const hosts = import.meta.glob('./[ab].svelte');",
    "const hosts = import.meta.globEager('./*.svelte');",
    "const host = require('./Host.svelte');",
    "import Host from '$custom/Host.svelte';",
  ])('fails safe for unsupported dependency syntax: %s', (imports) => {
    const root = fixtureRepository(imports);
    branch(root, 'fixture', host);
    const result = runCli(root, '--diff', 'main', 'fixture');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ct_required=true\n');
    expect(result.stderr).toContain('unsupported CT dependency');
    expect(result.stderr).toContain('fail-safe');
  });

  it.each([
    "import Host from /* fixture */ './MemberMentionsHost.svelte';",
    "import Host from // fixture\n './MemberMentionsHost.svelte';",
    "import /* fixture */ './MemberMentionsHost.svelte';",
    "import // fixture\n './MemberMentionsHost.svelte';",
    "export { default } from /* fixture */ './MemberMentionsHost.svelte';",
    "export * from // fixture\n './MemberMentionsHost.svelte';",
    "const host = import /* fixture */ ('./MemberMentionsHost.svelte');",
    "const host = import // fixture\n ('./MemberMentionsHost.svelte');",
    "const host = import( /* fixture */ './MemberMentionsHost.svelte');",
    "const host = import('./MemberMentionsHost.svelte' /* fixture */);",
    "const host = import /* before */ ( /* path */ './MemberMentionsHost.svelte' /* options */ , {});",
  ])('handles comments between import tokens without broadening selection: %s', (imports) => {
    const root = fixtureRepository(imports);
    branch(root, 'fixture', host);
    expect(runCli(root, '--diff', 'main', 'fixture')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'unrelated', 'src/lib/components/chat/input/__tests__/OtherHost.svelte');
    expect(runCli(root, '--diff', 'main', 'unrelated')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it.each([
    "const host = import /* fixture */ ('./' + name);",
    "const host = import // fixture\n ('./' + name);",
    'const host = import /* fixture */ (`./${name}.svelte`);',
    "const host = require /* fixture */ ('./MemberMentionsHost.svelte');",
    'const hosts = import /* fixture */ .meta /* fixture */ .glob(`./*.svelte`);',
    "import Host from /* fixture */ '$custom/Host.svelte';",
    String.raw`import Host from './H\u006fst.svelte';`,
  ])('fails safe for unsupported imports with comments or escapes: %s', (imports) => {
    const root = fixtureRepository(imports);
    branch(root, 'fixture', host);
    const result = runCli(root, '--diff', 'main', 'fixture');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ct_required=true\n');
    expect(result.stderr).toContain('unsupported CT dependency');
    expect(result.stderr).toContain('fail-safe');
  });

  it('preserves comment-like text and the other quote inside module strings', () => {
    const root = fixtureRepository(`import Host from "./folder/* literal */Host's.svelte";`);
    branch(
      root,
      'fixture',
      "src/lib/components/chat/input/__tests__/folder/* literal */Host's.svelte",
    );
    expect(runCli(root, '--diff', 'main', 'fixture')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'unrelated', "src/lib/components/chat/input/__tests__/folder/Host's.svelte");
    expect(runCli(root, '--diff', 'main', 'unrelated')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it('recognizes query-suffixed fixture imports without treating other files as dependencies', () => {
    const root = fixtureRepository("import data from './fixture.svg?raw';");
    branch(root, 'fixture', 'src/lib/components/chat/input/__tests__/fixture.svg');
    expect(runCli(root, '--diff', 'main', 'fixture')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'unrelated', 'src/lib/components/chat/input/__tests__/other.svg');
    expect(runCli(root, '--diff', 'main', 'unrelated')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it.each(['base-only', 'head-only', 'relocated'])(
    'reads %s spec dependencies without the changed-spec shortcut',
    (side) => {
      const root = fixtureRepository(
        side === 'head-only' ? '' : "import Host from './MemberMentionsHost.svelte';",
      );
      branch(root, 'feature');
      let fixture = host;
      if (side === 'base-only') git(root, 'rm', '-q', spec);
      else if (side === 'head-only') {
        commitFile(root, spec, "import Host from './MemberMentionsHost.svelte';");
      } else {
        // Same blob at a different path must resolve relative imports there too.
        git(root, 'mv', spec, 'src/relocated.ct.spec.ts');
        fixture = 'src/MemberMentionsHost.svelte';
      }
      commitFile(root, fixture, 'changed fixture');
      // Inject only the fixture diff: changing a spec would otherwise select CT
      // before either Git tree is read, hiding a broken dependency reader.
      const result = spawnSync(process.execPath, ['--input-type=module'], {
        cwd: root,
        encoding: 'utf8',
        input: `import { main } from ${JSON.stringify(pathToFileURL(CLI).href)};
        main(['--diff', 'main', 'feature'], { diff: () => ${JSON.stringify([fixture])} });`,
      });
      expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
        status: 0,
        stdout: 'ct_required=true\n',
        stderr: '',
      });
    },
  );

  it.each([
    "const keyword = 'import';\nimport Host from './MemberMentionsHost.svelte';",
    "const keyword = 'from';\nimport Host from './MemberMentionsHost.svelte';",
    "// The keyword is 'import'\nimport Host from './MemberMentionsHost.svelte';",
    "/* The keyword is 'from' */ import Host from './MemberMentionsHost.svelte';",
    "const keyword = 'import'; import Host from './MemberMentionsHost.svelte';",
    "const keyword = 'import'; const host = import('./MemberMentionsHost.svelte');",
    "import assert from 'node:assert'; const keyword = 'import'; import Host from './MemberMentionsHost.svelte';",
    "const text = `the keyword is 'import'`; import Host from './MemberMentionsHost.svelte';",
    "const text = `import './Ghost.svelte' ${import('./MemberMentionsHost.svelte')}`;",
    "const text = `${`${import('./MemberMentionsHost.svelte')}`}`;",
    String.raw`const pattern = /['"]import['"]/; import Host from './MemberMentionsHost.svelte';`,
    String.raw`if (true) /['"]import['"]/.test('text'); import Host from './MemberMentionsHost.svelte';`,
    "const ratio = (10 + 2) / 2 / 3; import Host from './MemberMentionsHost.svelte';",
    "const ratio = value! / await import('./MemberMentionsHost.svelte') / 3;",
    "const ratio = object.return / await import('./MemberMentionsHost.svelte') / 3;",
  ])('does not let non-code text hide a fixture dependency: %s', (imports) => {
    const root = fixtureRepository(imports);
    branch(root, 'fixture', host);
    expect(runCli(root, '--diff', 'main', 'fixture')).toEqual({
      status: 0,
      stdout: 'ct_required=true\n',
      stderr: '',
    });
    branch(root, 'unrelated', 'src/lib/components/chat/input/__tests__/Ghost.svelte');
    expect(runCli(root, '--diff', 'main', 'unrelated')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it.each([
    "// import './Ghost.svelte';",
    "/* export { value } from './Ghost.svelte'; */",
    `const text = "import './Ghost.svelte';";`,
    "const text = `import './Ghost.svelte'; require('./Ghost.svelte')`;",
    String.raw`const pattern = /import ['"]\.\/Ghost.svelte['"]/;`,
    "const text = `import.meta.glob('./*.svelte')`;",
  ])('ignores import-looking text outside code: %s', (prefix) => {
    const root = fixtureRepository(`${prefix}\nimport Host from './MemberMentionsHost.svelte';`);
    branch(root, 'unrelated', 'src/lib/components/chat/input/__tests__/Ghost.svelte');
    expect(runCli(root, '--diff', 'main', 'unrelated')).toEqual({
      status: 0,
      stdout: 'ct_required=false\n',
      stderr: '',
    });
  });

  it.each([
    '/* unclosed comment',
    "const text = 'unclosed string",
    'const text = `unclosed template',
    "const value = {} / import('./MemberMentionsHost.svelte') / 3;",
    'const text = `${import(name)}`;',
  ])(
    'fails safe when lexical analysis is incomplete or a template computes an import: %s',
    (imports) => {
      const root = fixtureRepository(imports);
      branch(root, 'fixture', host);
      const result = runCli(root, '--diff', 'main', 'fixture');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('ct_required=true\n');
      expect(result.stderr).toContain('fail-safe');
    },
  );

  it('fails safe when dependency discovery fails', () => {
    const logs: string[] = [];
    const warnings: string[] = [];
    const code = main(['--diff', 'base', 'head'], {
      diff: () => [host],
      dependencies: () => {
        throw new Error('cannot read CT spec tree');
      },
      log: (line: string) => logs.push(line),
      warn: (line: string) => warnings.push(line),
    });
    expect(code).toBe(0);
    expect(logs).toEqual(['ct_required=true']);
    expect(warnings.join('\n')).toContain('cannot read CT spec tree');
    expect(warnings.join('\n')).toContain('fail-safe');
  });
});

describe('transitive CT dependencies', () => {
  const spec = 'src/features/home/home-opening.ct.spec.ts';
  const preview = 'src/features/home/home.preview.svelte';
  const page = 'src/features/home/HomePage.svelte';
  const helper = 'src/lib/utils/show-workspace.ts';

  // The cloudlands-fe#3876 shape: spec -> preview harness -> page -> helper.
  function homeRepository() {
    const root = gitRepository();
    commitFile(
      root,
      helper,
      "import { open } from './workspace-navigation';\nexport const show = open;",
    );
    commitFile(root, 'src/lib/utils/workspace-navigation.ts', 'export const open = () => {};');
    commitFile(
      root,
      page,
      '<script lang="ts">\n  import { show } from \'$lib/utils/show-workspace\';\n</script>\n<button onclick={() => show()}>Open</button>',
    );
    commitFile(
      root,
      preview,
      '<script module lang="ts">\n  export const preview = {};\n</script>\n<script lang="ts">\n  import HomePage from \'./HomePage.svelte\';\n</script>\n<HomePage />',
    );
    commitFile(
      root,
      spec,
      "import { test } from '../../test/ct-test';\nimport Preview from './home.preview.svelte';\ntest('opens', async ({ mount }) => { await mount(Preview); });",
    );
    return root;
  }

  it.each([page, helper, 'src/lib/utils/workspace-navigation.ts'])(
    'requires CT for a change %s levels below a spec',
    (file) => {
      const root = homeRepository();
      branch(root, 'change', file);
      expect(runCli(root, '--diff', 'main', 'change')).toEqual({
        status: 0,
        stdout: 'ct_required=true\n',
        stderr: '',
      });
    },
  );

  it('does not select a module only an unmounted file imports', () => {
    const root = homeRepository();
    commitFile(root, 'src/features/home/home-open.test.ts', "import './unit-only';");
    commitFile(
      root,
      'src/features/other/Other.svelte',
      "<script>import './other-helper';</script>",
    );
    branch(
      root,
      'unrelated',
      'src/features/home/unit-only.ts',
      'src/features/other/other-helper.ts',
    );
    expect(runCli(root, '--diff', 'main', 'unrelated').stdout).toBe('ct_required=false\n');
  });

  it('requires CT when a deeper module is newly imported or removed', () => {
    const root = homeRepository();
    branch(root, 'new-import');
    commitFile(root, page, "<script>import './NewChild.svelte';</script>");
    commitFile(root, 'src/features/home/NewChild.svelte', '<p>child</p>');
    const base = git(root, 'rev-parse', 'HEAD~1');
    expect(runCli(root, '--diff', base, 'HEAD').stdout).toBe('ct_required=true\n');
    branch(root, 'removed');
    git(root, 'rm', '-q', 'src/lib/utils/workspace-navigation.ts');
    git(root, 'commit', '-q', '-m', 'remove');
    expect(runCli(root, '--diff', 'main', 'removed').stdout).toBe('ct_required=true\n');
  });

  it('terminates on import cycles', () => {
    const root = homeRepository();
    commitFile(root, 'src/lib/utils/workspace-navigation.ts', "import './show-workspace';");
    branch(root, 'cycle', helper);
    expect(runCli(root, '--diff', 'main', 'cycle').stdout).toBe('ct_required=true\n');
  });

  it.each([
    [
      'markup dynamic import',
      "{#await import('./Lazy.svelte') then m}<m.default />{/await}",
      'src/features/home/Lazy.svelte',
    ],
    ['style @import', "<style>\n  @import './home.css';\n</style>", 'src/features/home/home.css'],
    [
      'style unquoted url() @import',
      '<style>\n  @import url(./home.css);\n</style>',
      'src/features/home/home.css',
    ],
    [
      'style quoted url() @import',
      '<style>\n  @import url("./home.css") layer(base);\n</style>',
      'src/features/home/home.css',
    ],
    [
      'runes module',
      "<script>import { state } from './state.svelte';</script>",
      'src/features/home/state.svelte.ts',
    ],
    [
      'TypeScript .js specifier',
      "<script>import { x } from './x.js';</script>",
      'src/features/home/x.ts',
    ],
    [
      'package alias',
      "<script>import Fa from 'svelte-fa';</script>",
      'src/lib/components/shared/icons/fa-proxy.ts',
    ],
    [
      'inline type specifier',
      "<script>import { type T, value } from './values';</script>",
      'src/features/home/values.ts',
    ],
  ])('follows a %s from a mounted component', (_kind, source, dependency) => {
    const root = homeRepository();
    commitFile(root, page, source);
    branch(root, 'change', dependency);
    expect(runCli(root, '--diff', 'main', 'change').stdout).toBe('ct_required=true\n');
  });

  it.each(["@import 'tokens.css';", '@import url(tokens.css) screen;'])(
    'follows CSS @import chains: %s',
    (rule) => {
      const root = homeRepository();
      commitFile(root, page, "<script>import './home.css';</script>");
      commitFile(root, 'src/features/home/home.css', `/* @import is documented here */\n${rule}`);
      branch(root, 'change', 'src/features/home/tokens.css');
      const result = runCli(root, '--diff', 'main', 'change');
      expect(result.stdout).toBe('ct_required=true\n');
      expect(result.stderr).not.toContain('fail-safe');
    },
  );

  it.each([
    "<script>export type { T }\nimport { value } from './types'</script>",
    "<script>import type from './types';</script>",
    "<script>export type T = string\nexport { value } from './types'</script>",
  ])('keeps a runtime edge next to type syntax: %s', (source) => {
    const root = homeRepository();
    commitFile(root, page, source);
    branch(root, 'change', 'src/features/home/types.ts');
    expect(runCli(root, '--diff', 'main', 'change').stdout).toBe('ct_required=true\n');
  });

  it.each([
    "<script>import type { T } from './types';</script>",
    "<script>export type { T } from './types';</script>",
    "<script>import type * as T from './types';</script>",
    "<script>import type T from './types';</script>",
  ])('ignores type-only edges, which load nothing: %s', (source) => {
    const root = homeRepository();
    commitFile(root, page, source);
    branch(root, 'change', 'src/features/home/types.ts');
    expect(runCli(root, '--diff', 'main', 'change').stdout).toBe('ct_required=false\n');
  });

  it.each([
    [
      "import.meta.glob('./scenes/*.svelte')",
      'src/features/home/scenes/a.svelte',
      'src/features/home/b.svelte',
    ],
    [
      "import.meta.glob<Loader>(['./a/*.ts', './b/**/*.{ts,svelte}'], { eager: true })",
      'src/features/home/b/x/y.svelte',
      'src/features/home/b/y.css',
    ],
    [
      "import.meta.glob('$lib/fixtures/*.ts', { eager: true })",
      'src/lib/fixtures/a.ts',
      'src/lib/fixtures/a.css',
    ],
    [
      "import.meta.glob('/src/assets/*.mp3', { query: '?url' })",
      'src/assets/cue.mp3',
      'src/assets/cue.wav',
    ],
  ])('resolves literal glob %s against the tree', (glob, matched, unmatched) => {
    const root = homeRepository();
    commitFile(root, page, `<script lang="ts">const modules = ${glob};</script>`);
    commitFile(root, matched, '// base');
    commitFile(root, unmatched, '// base');
    branch(root, 'matched', matched);
    expect(runCli(root, '--diff', 'main', 'matched').stdout).toBe('ct_required=true\n');
    branch(root, 'unmatched', unmatched);
    expect(runCli(root, '--diff', 'main', 'unmatched').stdout).toBe('ct_required=false\n');
  });

  it('follows a preview mounted by previewScene name without an import', () => {
    const root = gitRepository();
    commitFile(
      root,
      'src/lib/status.ct.spec.ts',
      "import Indicator from './Indicator.svelte';\ntest('s', async ({ mount }) => mount(Indicator, { hooksConfig: { previewScene: { scene: 'status-indicator', state: 'ok' } } }));",
    );
    commitFile(root, 'src/lib/Indicator.svelte', '<p>indicator</p>');
    commitFile(
      root,
      'src/lib/layout/status-indicator.preview.ts',
      "import { data } from './status-data';",
    );
    commitFile(root, 'src/lib/layout/other.preview.ts', "import { data } from './other-data';");
    branch(root, 'scene', 'src/lib/layout/status-data.ts');
    expect(runCli(root, '--diff', 'main', 'scene').stdout).toBe('ct_required=true\n');
    branch(root, 'other', 'src/lib/layout/other-data.ts');
    expect(runCli(root, '--diff', 'main', 'other').stdout).toBe('ct_required=false\n');
  });

  it.each([
    'mount(Host, { hooksConfig: { previewScene: config } });',
    'mount(Host, { hooksConfig: { previewScene: { scene: name, state } } });',
    'mount(Host, { hooksConfig: { previewScene } });',
  ])('fails safe for a computed previewScene: %s', (source) => {
    const root = gitRepository();
    commitFile(root, 'src/lib/host.ct.spec.ts', source);
    const result = runCli(root, '--diff', 'main', 'main');
    expect(result.stdout).toBe('ct_required=false\n');
    branch(root, 'change', 'src/lib/unrelated.ts');
    const changed = runCli(root, '--diff', 'main', 'change');
    expect(changed.stdout).toBe('ct_required=true\n');
    expect(changed.stderr).toContain('previewScene');
    expect(changed.stderr).toContain('fail-safe');
  });

  it("follows the mount harness's imports but not its lazy preview registry", () => {
    const root = gitRepository();
    commitFile(
      root,
      'playwright/index.ts',
      "import { store } from '../src/store/configured-store';\nconst loaders = import.meta.glob<Definition>(\n  '../src/**/*.preview.{ts,svelte}',\n  { import: 'preview' },\n);",
    );
    commitFile(root, 'src/store/configured-store.ts', "import { reducers } from './reducer';");
    commitFile(root, 'src/store/reducer.ts', 'export const reducers = {};');
    commitFile(
      root,
      'src/lib/unmounted.preview.svelte',
      "<script>import './unmounted-data';</script>",
    );
    branch(root, 'store', 'src/store/reducer.ts');
    expect(runCli(root, '--diff', 'main', 'store').stdout).toBe('ct_required=true\n');
    branch(root, 'registry', 'src/lib/unmounted-data.ts');
    expect(runCli(root, '--diff', 'main', 'registry').stdout).toBe('ct_required=false\n');
  });

  it.each([
    '{#await import(name) then m}<m.default />{/await}',
    '<script>const m = import.meta.glob(`./${dir}/*.svelte`);</script>',
    "<script>const m = import.meta.glob('$unknown/*.ts');</script>",
    "<script>const m = import.meta.glob('fixtures/*.ts');</script>",
    '<style>@import theme;</style>',
  ])('fails safe for computed imports anywhere in a mounted component: %s', (source) => {
    const root = homeRepository();
    commitFile(root, page, source);
    branch(root, 'change', 'src/features/unrelated.ts');
    const result = runCli(root, '--diff', 'main', 'change');
    expect(result.stdout).toBe('ct_required=true\n');
    expect(result.stderr).toContain('fail-safe');
  });
});

// The repository's own graph: the closure must resolve without falling back,
// or every queue entry would run CT and hide a scanner regression.
describe('this repository', () => {
  function decide(files: string[]) {
    const logs: string[] = [];
    const warnings: string[] = [];
    main(['--diff', 'HEAD', 'HEAD'], {
      diff: () => files,
      log: (line: string) => logs.push(line),
      warn: (line: string) => warnings.push(line),
    });
    return { logs, warnings };
  }

  it.each(['src/features/home/HomePage.svelte', 'src/lib/utils/show-workspace.ts'])(
    'requires CT for a %s change (cloudlands-fe#3876)',
    (file) => {
      expect(decide([file])).toEqual({ logs: ['ct_required=true'], warnings: [] });
    },
  );

  // The walk skips exactly this registry glob in the harness. If the harness
  // renames it, the walk would treat every preview as mounted.
  it('finds the lazy preview registry it skips in the real mount harness', () => {
    const harness = readFileSync(resolve(CT_HARNESS_ENTRY), 'utf8');
    expect(sourceReferences(harness, CT_HARNESS_ENTRY).globs).toContainEqual([
      CT_PREVIEW_REGISTRY_GLOB,
    ]);
  });

  it('does not require CT for main-process code no CT run mounts', () => {
    expect(decide(['src/main/index.ts'])).toEqual({ logs: ['ct_required=false'], warnings: [] });
  });
});
