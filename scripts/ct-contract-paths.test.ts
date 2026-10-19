// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CT_CONTRACT_PATHS,
  changedFiles,
  ctRequired,
  isCtContractPath,
  main,
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
    'src/lib/components/chat/input/__tests__/nested.ts',
    'src/lib/components/chat/input/__tests__/unused/index.ts',
  ])('does not select unrelated files or traverse the application graph: %s', (file) => {
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
    "const hosts = import.meta.glob('./*.svelte');",
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
    "const hosts = import /* fixture */ .meta /* fixture */ .glob('./*.svelte');",
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
