// @vitest-environment node
// The ratchet lints every file in the rule's eslint.config.js scope.
// @verify-changed-triggers: src/**/*.{js,ts}, eslint.config.js,
//   eslint-rules/baselines/no-hand-rolled-backend-transport-mock/**
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import {
  baselineCounts,
  findBaselineGrowth,
  lintRuleFromRepoConfig,
  loadBaseline,
  readComparisonBaseline,
} from './lib/baseline-ratchet.js';
import rule from './no-hand-rolled-backend-transport-mock.js';

const root = process.cwd();
const ruleName = 'no-hand-rolled-backend-transport-mock';
// `eslint-rules/baselines/no-hand-rolled-backend-transport-mock/<test file>.json`, each
// holding `{ "count": N }`; lower it as files move to the shared fake, delete it at zero.
const baselineTree = loadBaseline({ cwd: root, rules: [ruleName] });
const baseline = baselineCounts(baselineTree[ruleName]) ?? {};
const ruleId = `intent/${ruleName}`;

const sourceRelative = 'src/lib/client/live/example.test.ts';
const filename = path.resolve(sourceRelative);
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
});
const error = (line) => ({ messageId: 'handRolled', line });

describe('no-hand-rolled-backend-transport-mock guidance', () => {
  it('points at the shared fake, the scripted mock and the incident', () => {
    const message = rule.meta.messages.handRolled;
    expect(message).toContain('createBackendTransportFake');
    expect(message).toContain('src/test/mocks/backend-transport-fake.ts');
    expect(message).toContain('mockBackendTransportModule');
    expect(message).toContain('cloudlands-fe#5090');
  });
});

describe('no-hand-rolled-backend-transport-mock in the repo config', () => {
  const eslint = new ESLint({
    cwd: root,
    ruleFilter: ({ ruleId: id }) => id === ruleId,
    cache: false,
  });
  const handRolled = `import { vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
`;
  const lint = async (file) => {
    const [result] = await eslint.lintText(handRolled, { filePath: path.join(root, file) });
    return result.messages.filter((message) => message.ruleId === ruleId);
  };

  it('rejects a new hand-rolled factory in unit tests and test helpers', async () => {
    for (const file of [
      'src/features/agent/fixture-transport.test.ts',
      'src/lib/components/chat/__tests__/fixture-transport.test.ts',
      'src/features/agent/__tests__/fixture-transport.fixture.ts',
      'src/test/fixture-transport-helper.ts',
    ]) {
      expect(await lint(file), file).toHaveLength(1);
    }
  });

  it('leaves production source alone', async () => {
    expect(await lint('src/features/agent/fixture-transport.ts')).toEqual([]);
  });
});

describe('no-hand-rolled-backend-transport-mock baseline ratchet', () => {
  it('maps existing package-relative test files to counted entries only', () => {
    for (const exception of baselineTree[ruleName] ?? []) {
      expect(exception.files, 'every entry must carry a count').toBeUndefined();
    }
    for (const file of Object.keys(baseline)) {
      expect(file, `${file} should be a package-relative source file`).toMatch(
        /^src\/[^\\]*\.(js|ts)$/,
      );
      expect(fs.existsSync(path.join(root, file)), `${file} no longer exists`).toBe(true);
    }
  });

  it('never grows a count against the comparison revision', () => {
    const comparison = readComparisonBaseline({ cwd: root, rules: [ruleName] });
    // A revision whose eslint.config.js does not enable the rule enforced nothing, so
    // the initial baseline may be established against it; afterwards counts only shrink.
    const comparisonConfig = execFileSync('git', ['show', `${comparison.ref}:eslint.config.js`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const newRules = comparisonConfig.includes(`'${ruleId}'`) ? [] : [ruleName];
    expect(
      findBaselineGrowth(comparison.baseline, baselineTree, { newRules }),
      `per-file counts may only shrink relative to ${comparison.ref}`,
    ).toEqual({});
  });

  // Lints every file the real `eslint.config.js` lints (same rule entry, same global
  // ignores), so this ratchet and `pnpm lint` cannot disagree on scope.
  it('matches today’s hand-rolled factories exactly: no stale count, no new one', async () => {
    const { [ruleId]: current } = await lintRuleFromRepoConfig({ cwd: root, ruleIds: ruleId });

    const stale = Object.fromEntries(
      Object.entries(baseline)
        .filter(([file, count]) => (current[file] ?? 0) < count)
        .map(([file, count]) => [file, { baseline: count, current: current[file] ?? 0 }]),
    );
    expect(stale, 'lower or remove these baseline counts; the factories were migrated').toEqual({});
    const grown = Object.fromEntries(
      Object.entries(current)
        .filter(([file, count]) => count > (baseline[file] ?? 0))
        .map(([file, count]) => [file, { baseline: baseline[file] ?? 0, current: count }]),
    );
    expect(
      grown,
      'new hand-rolled transport factories; use createBackendTransportFake instead of raising the baseline',
    ).toEqual({});
  }, 240_000);
});

tester.run('no-hand-rolled-backend-transport-mock', rule, {
  valid: [
    {
      name: 'the shared fake through a dynamic import (cloudlands-fe#5090 follow-up)',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport', async () =>
  (await import('../../../test/mocks/backend-transport-fake')).createBackendTransportFake({
    backendRequest: vi.fn(),
  }),
);`,
    },
    {
      name: 'the shared fake through a destructured import, an alias and a block body',
      filename,
      code: `
vi.mock('./backend-transport', async () => {
  const { createBackendTransportFake } = await import('../../../test/mocks/backend-transport-fake');
  const fake = createBackendTransportFake({ backendRequest: vi.fn() });
  return fake;
});`,
    },
    {
      name: 'the shared fake spread under extra exports',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport', async () => ({
  ...(await import('../../../test/mocks/backend-transport-fake')).createBackendTransportFake(),
  isBackendAvailable: () => true,
}));`,
    },
    {
      name: 'the scripted mock module, directly or spread under overrides',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});
vi.doMock('$lib/client/live/backend-transport', async () => ({
  ...(await import('../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
  backendRequest: vi.fn(),
}));`,
    },
    {
      name: 'automock, spy mode and the real module spread under overrides',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport');
vi.mock('$lib/client/live/backend-transport', { spy: true });
vi.mock('$lib/client/live/backend-transport', async (importOriginal) => ({
  ...(await importOriginal()),
  backendRequest: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', async () => ({
  ...(await vi.importActual('$lib/client/live/backend-transport')),
  backendRequest: vi.fn(),
}));`,
    },
    {
      name: 'other modules beside the transport',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport-types', () => ({ BackendError: class {} }));
vi.mock('$lib/client/live/backend-transport-factory', () => ({ resolveBackendTransport: vi.fn() }));
vi.mock('../../../test/mocks/backend-transport.mock', () => ({}));
vi.mock('$lib/client', () => ({ appClient: {} }));`,
    },
    {
      name: 'a reasoned disable does not use up the allowance',
      filename,
      options: [{ baseline: { [sourceRelative]: 1 } }],
      code: `
// eslint-disable-next-line rule-to-test/no-hand-rolled-backend-transport-mock -- checks a missing export
vi.mock('$lib/client/live/backend-transport', () => ({}));
vi.doMock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));`,
    },
    {
      name: 'baselined factories up to the count',
      filename,
      options: [{ baseline: { [sourceRelative]: 2 } }],
      code: `
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.doMock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));`,
    },
  ],
  invalid: [
    {
      name: 'an object literal factory (cloudlands-fe#5090)',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
}));`,
      errors: [error(2)],
    },
    {
      name: 'the #5090 shim: a block body returning a spread local fake',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport', () => {
  const fake = { backendRequest: vi.fn() };
  return { ...fake, readBackendHello: () => fake.backendRequest('client.hello', {}) };
});`,
      errors: [error(2)],
    },
    {
      name: 'relative, suffixed, template and import() module paths, and vi.doMock',
      filename,
      code: `
vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
vi.mock('../live/backend-transport.ts', () => ({ backendRequest: vi.fn() }));
vi.doMock(\`$lib/client/live/backend-transport\`, () => ({ backendRequest: vi.fn() }));
vi.mock(import('$lib/client/live/backend-transport'), () => ({ backendRequest: vi.fn() }));`,
      errors: [error(2), error(3), error(4), error(5)],
    },
    {
      name: 'a hoisted object or a named factory the rule cannot read',
      filename,
      code: `
const transport = vi.hoisted(() => ({ backendRequest: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => transport);
const factory = () => ({ backendRequest: vi.fn() });
vi.mock('$lib/client/live/backend-transport', factory);`,
      errors: [error(3), error(5)],
    },
    {
      name: 'one branch returning a hand-rolled object',
      filename,
      code: `
vi.mock('$lib/client/live/backend-transport', async () => {
  if (process.env.REAL) return (await import('../../../test/mocks/backend-transport-fake')).createBackendTransportFake();
  return { backendRequest: vi.fn() };
});`,
      errors: [error(2)],
    },
    {
      name: 'factories beyond the baselined count, in source order',
      filename,
      options: [{ baseline: { [sourceRelative]: 1 } }],
      code: `
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
vi.doMock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));`,
      errors: [error(3)],
    },
    {
      name: 'a baseline for another file does not apply',
      filename,
      options: [{ baseline: { 'src/lib/client/live/other.test.ts': 3 } }],
      code: `
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));`,
      errors: [error(2)],
    },
  ],
});
