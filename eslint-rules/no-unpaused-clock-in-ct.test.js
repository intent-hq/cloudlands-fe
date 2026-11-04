// @vitest-environment node
import path from 'node:path';
import { Linter, RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import rule from './no-unpaused-clock-in-ct.js';
import requireDisableReason from './require-disable-reason.js';

const filename = path.resolve('src/lib/components/example/example.ct.spec.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
});

const error = (line) => ({ messageId: 'unpausedClock', line });

describe('no-unpaused-clock-in-ct guidance', () => {
  it('cites the incident and names the shared helpers and the opt-out', () => {
    const message = rule.meta.messages.unpausedClock;
    expect(message).toContain('cloudlands-fe#4148');
    expect(message).toContain('installPausedClock(page)');
    expect(message).toContain('pauseClock(page)');
    expect(message).toContain('disable this rule on this line with a reason');
  });

  it('takes no options: it is enforced at zero debt', () => {
    expect(rule.meta.schema).toEqual([]);
  });
});

// The opt-out runs through ESLint's directive handling, which RuleTester bypasses.
function lintWithOptOutRules(code) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    code,
    [
      {
        files: ['**/*.ct.spec.ts'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'module', parser: tsParser },
        plugins: {
          intent: {
            rules: {
              'no-unpaused-clock-in-ct': rule,
              'require-disable-reason': requireDisableReason,
            },
          },
        },
        rules: {
          'intent/no-unpaused-clock-in-ct': 'error',
          'intent/require-disable-reason': ['error', { rules: ['intent/no-unpaused-clock-in-ct'] }],
        },
      },
    ],
    filename,
  );
}

describe('no-unpaused-clock-in-ct opt-out', () => {
  const body = (directive) => `
test('t', async ({ page }) => {
  ${directive}
  await page.clock.install();
  await page.clock.runFor(2600);
});`;

  it('accepts a single-line disable that gives a reason', () => {
    const messages = lintWithOptOutRules(
      body(
        '// eslint-disable-next-line intent/no-unpaused-clock-in-ct -- only skips the show delay',
      ),
    );
    expect(messages).toEqual([]);
  });

  it('rejects a disable without a reason', () => {
    const messages = lintWithOptOutRules(
      body('// eslint-disable-next-line intent/no-unpaused-clock-in-ct'),
    );
    expect(messages.map((message) => message.ruleId)).toEqual(['intent/require-disable-reason']);
  });

  it('reports the bare install when there is no directive', () => {
    const messages = lintWithOptOutRules(body(''));
    expect(messages.map((message) => message.ruleId)).toEqual(['intent/no-unpaused-clock-in-ct']);
  });
});

tester.run('no-unpaused-clock-in-ct', rule, {
  valid: [
    {
      name: 'the shared helper installs and pauses',
      filename,
      code: `
test('steps the reveal', async ({ mount, page }) => {
  const side = await installPausedClock(page, () => mount(Side));
  await page.clock.runFor(16);
});`,
    },
    {
      name: 'a hand-written pauseAt in the same test',
      filename,
      code: `
test('t', async ({ page }) => {
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1000);
});`,
    },
    {
      name: 'pauseClock later in the test',
      filename,
      code: `
test('t', async ({ mount, page }) => {
  await page.clock.install();
  await mount(Host);
  await pauseClock(page);
});`,
    },
    {
      name: 'install in beforeEach, pause in the same hook',
      filename,
      code: `
test.beforeEach(async ({ mount, page }) => {
  await page.clock.install();
  await mount(Harness);
  await pauseClock(page);
});
test('a', async ({ page }) => {});`,
    },
    {
      name: 'install in a suite beforeEach, every test pauses through a same-file helper',
      filename,
      code: `
async function freezeMotion(page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}
test.describe('easing', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });
  test('a', async ({ page }) => {
    await freezeMotion(page);
  });
  test('b', async ({ page }) => {
    await freezeMotion(page);
  });
});
test('outside the suite', async ({ page }) => {});`,
    },
    {
      name: 'install in a same-file helper whose callers pause',
      filename,
      code: `
async function mountSide(mount, page) {
  await page.clock.install();
  return mount(Side);
}
test('a', async ({ mount, page }) => {
  await mountSide(mount, page);
  await pauseClock(page);
});`,
    },
    {
      name: 'install in a const arrow helper whose callers pause',
      filename,
      code: `
const setup = async (page) => {
  await page.clock.install();
};
test('a', async ({ page }) => {
  await setup(page);
  await pauseClock(page);
});`,
    },
    {
      name: 'a conditional test.skip(condition, reason) is not a test',
      filename,
      code: `
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});
test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');
test('a', async ({ page }) => {
  await pauseClock(page);
});`,
    },
    {
      name: 'install inside a test.step callback of a pausing test',
      filename,
      code: `
test('t', async ({ page }) => {
  await test.step('setup', async () => {
    await page.clock.install();
  });
  await pauseClock(page);
});`,
    },
    {
      name: 'not a component spec',
      filename: path.resolve('src/lib/components/example/example.test.ts'),
      code: `
it('t', async () => {
  await page.clock.install();
});`,
    },
  ],
  invalid: [
    {
      name: 'a bare install never paused',
      filename,
      code: `
test('t', async ({ page }) => {
  await page.clock.install();
  await page.clock.runFor(16);
});`,
      errors: [error(3)],
    },
    {
      name: 'cloudlands-fe#4148 before the fix: install, mount, step frames',
      filename,
      code: `
async function mountSide(mount, page) {
  await page.clock.install();
  return mount(Side);
}
test('reveals part-way', async ({ mount, page }) => {
  const side = await mountSide(mount, page);
  await page.clock.runFor(100);
});`,
      errors: [error(3)],
    },
    {
      name: 'a pause in another test does not cover this one',
      filename,
      code: `
test('paused', async ({ page }) => {
  await installPausedClock(page);
});
test('unpaused', async ({ page }) => {
  await page.clock.install();
});`,
      errors: [error(6)],
    },
    {
      name: 'a suite hook install where only some tests pause',
      filename,
      code: `
test.describe('s', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });
  test('a', async ({ page }) => {
    await pauseClock(page);
  });
  test('b', async ({ page }) => {});
});`,
      errors: [error(4)],
    },
    {
      name: 'a helper called by one pausing and one unpaused test',
      filename,
      code: `
async function setup(page) {
  await page.clock.install();
}
test('a', async ({ page }) => {
  await setup(page);
  await pauseClock(page);
});
test.fixme('b', async ({ page }) => {
  await setup(page);
});`,
      errors: [error(3)],
    },
    {
      name: 'a helper never called in this file must pause itself',
      filename,
      code: `
export async function setup(page) {
  await page.clock.install();
}`,
      errors: [error(3)],
    },
    {
      name: 'resume does not count as a pause',
      filename,
      code: `
test('t', async ({ page }) => {
  await page.clock.install();
  await page.clock.fastForward(10_000);
  await page.clock.resume();
});`,
      errors: [error(3)],
    },
  ],
});
