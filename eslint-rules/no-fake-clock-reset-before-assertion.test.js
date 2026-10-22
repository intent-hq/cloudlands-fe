// @vitest-environment node
import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import rule from './no-fake-clock-reset-before-assertion.js';

const filename = path.resolve('src/features/example/__tests__/example.test.ts');
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = (line, call = 'vi.clearAllTimers()') => ({
  messageId: 'fakeClockReset',
  data: { call },
  line,
});

// The shape of intent-hq/cloudlands-fe#3574's auto-update-daily-cadence test: a same-file
// `setup()` helper pins the clock, then the test drops the startup/hourly timers.
const incidentSetup = `
async function setup(now) {
  vi.setSystemTime(new Date(now));
  await svc.initialize();
  return { focus };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});`;

describe('no-fake-clock-reset-before-assertion guidance', () => {
  it('names each reset, cites the incident, and says how to re-pin', () => {
    const message = rule.meta.messages.fakeClockReset;
    expect(message).toContain('`{{call}}`');
    expect(message).toContain('vi.clearAllTimers() rewinds the fake clock');
    expect(message).toContain('vi.useRealTimers() restores the real clock');
    expect(message).toContain("vi.useFakeTimers({ toFake }) without 'Date'");
    expect(message).toContain('intent-hq/cloudlands-fe#3574');
    expect(message).toContain('merge_group run 39583441525');
    expect(message).toMatch(/Pin the clock again with vi\.setSystemTime\(\.\.\.\) right after/);
  });

  it('takes no options: it is enforced at zero debt', () => {
    expect(rule.meta.schema).toEqual([]);
  });
});

tester.run('no-fake-clock-reset-before-assertion', rule, {
  valid: [
    // intent-hq/cloudlands-fe#3574's fix: re-pin right after clearAllTimers.
    {
      code: `${incidentSetup}
it('beta: focus/resume check only 4 h after the last check', async () => {
  const { focus } = await setup('2026-10-21T08:00:00Z');
  vi.clearAllTimers();
  vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
  focus();
  expect(triggers).toEqual(['focus']);
});`,
      filename,
    },
    // A reset after the last assertion cannot change what was asserted.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  expect(a).toBe(1);\n  vi.useRealTimers();\n});",
      filename,
    },
    // Reinstalling fake timers without options keeps the current (pinned) fake time.
    {
      code: "it('t', () => {\n  vi.useFakeTimers();\n  vi.setSystemTime(NOW);\n  vi.useFakeTimers();\n  expect(a).toBe(1);\n});",
      filename,
    },
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useFakeTimers({ shouldAdvanceTime: true });\n  expect(a).toBe(1);\n});",
      filename,
    },
    // A toFake list that still fakes Date keeps the pin.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });\n  expect(a).toBe(1);\n});",
      filename,
    },
    // Teardown hooks reset the clock after the test has asserted.
    {
      code: `beforeEach(() => {\n  vi.useFakeTimers();\n  vi.setSystemTime(NOW);\n});
afterEach(() => {\n  vi.clearAllTimers();\n  vi.useRealTimers();\n});
it('t', () => {\n  expect(a).toBe(1);\n});`,
      filename,
    },
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  onTestFinished(() => vi.useRealTimers());\n  expect(a).toBe(1);\n});",
      filename,
    },
    // A test that never pinned the clock does not depend on a pinned time of day.
    {
      code: "it('t', () => {\n  vi.useFakeTimers();\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n});",
      filename,
    },
    // Re-pinning after the reset, in every supported spelling.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useRealTimers();\n  vi.useFakeTimers({ now: NOW });\n  expect(a).toBe(1);\n});",
      filename,
    },
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useRealTimers();\n  vi.useFakeTimers().setSystemTime(NOW);\n  expect(a).toBe(1);\n});",
      filename,
    },
    // With real timers, vi.setSystemTime fakes only Date: still a pin.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useRealTimers();\n  vi.setSystemTime(NOW);\n  expect(a).toBe(1);\n});",
      filename,
    },
    {
      code: "function pin() {\n  vi.setSystemTime(NOW);\n}\nit('t', () => {\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  pin();\n  expect(a).toBe(1);\n});",
      filename,
    },
    // Helpers imported from another file are not followed.
    {
      code: "import { setup } from './harness';\nit('t', async () => {\n  await setup(NOW);\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n});",
      filename,
    },
    // A nested declaration that is never called does not run.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  function unused() {\n    vi.useRealTimers();\n  }\n  expect(a).toBe(1);\n});",
      filename,
    },
    // A sibling suite's setup hook does not pin this suite's tests.
    {
      code: `describe('pinned', () => {
  beforeEach(() => {\n    vi.setSystemTime(NOW);\n  });
  it('a', () => {\n    expect(a).toBe(1);\n  });
});
describe('real', () => {
  it('b', () => {\n    vi.useFakeTimers();\n    vi.clearAllTimers();\n    expect(b).toBe(1);\n  });
});`,
      filename,
    },
    // clearAllTimers rewinds to the install time, which is fixed when the install was
    // pinned: vi.useFakeTimers({ now }) or vi.useFakeTimers() after a pin.
    {
      code: "it('t', () => {\n  vi.useFakeTimers({ now: NOW });\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n});",
      filename,
    },
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useFakeTimers();\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n});",
      filename,
    },
    // clearAllTimers is a no-op with real timers, so a date-only pin survives it.
    {
      code: "it('t', () => {\n  vi.useRealTimers();\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n});",
      filename,
    },
    // Teardown registered on the test context runs after the assertions.
    {
      code: "it('t', (ctx) => {\n  vi.setSystemTime(NOW);\n  ctx.onTestFinished(() => vi.useRealTimers());\n  expect(a).toBe(1);\n});",
      filename,
    },
    // A closure that is defined but only called after the assertions.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  const restore = () => vi.useRealTimers();\n  expect(a).toBe(1);\n  restore();\n});",
      filename,
    },
    // A helper whose last clock call is a pin counts as a pin.
    {
      code: "function restart() {\n  vi.useRealTimers();\n  vi.useFakeTimers({ now: NOW });\n}\nit('t', () => {\n  vi.setSystemTime(NOW);\n  restart();\n  expect(a).toBe(1);\n});",
      filename,
    },
  ],
  invalid: [
    // intent-hq/cloudlands-fe#3574 before its fix (merge_group run 39583441525).
    {
      code: `${incidentSetup}
it('beta: focus/resume check only 4 h after the last check', async () => {
  const { focus } = await setup('2026-10-21T08:00:00Z');
  vi.clearAllTimers();
  focus();
  expect(triggers).toEqual(['focus']);
  vi.setSystemTime(new Date('2026-10-21T11:00:00Z'));
  expect(checkMock).toHaveBeenCalledTimes(1);
});`,
      filename,
      errors: [error(16)],
    },
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useRealTimers();\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(3, 'vi.useRealTimers()')],
    },
    // A pin from an enclosing suite's setup hook, or a top-level one.
    {
      code: `describe('s', () => {
  beforeEach(() => {\n    vi.useFakeTimers();\n    vi.setSystemTime(NOW);\n  });
  it('t', () => {\n    vi.clearAllTimers();\n    expect(a).toBe(1);\n  });
});`,
      filename,
      errors: [error(7)],
    },
    {
      code: `function pinClock() {\n  vi.setSystemTime(NOW);\n}
beforeAll(() => {\n  vi.useFakeTimers();\n  pinClock();\n});
describe('s', () => {
  it('t', () => {\n    vi.clearAllTimers();\n    expect(a).toBe(1);\n  });
});`,
      filename,
      errors: [error(10)],
    },
    // A toFake list without Date stops faking Date.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useFakeTimers({ toFake: ['setTimeout'] });\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(3, "vi.useFakeTimers({ toFake: ['setTimeout'] })")],
    },
    // A config that sets `now` but does not fake Date leaves Date on the real clock.
    {
      code: "it('t', () => {\n  vi.useFakeTimers();\n  vi.setSystemTime(NOW);\n  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout'] });\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(4, "vi.useFakeTimers({ now: NOW, toFake: ['setTimeout'] })")],
    },
    // A re-pin closure that is only defined, never called, does not re-pin.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.useRealTimers();\n  const repin = () => vi.setSystemTime(NOW);\n  expect(Date.now()).toBe(NOW);\n});",
      filename,
      errors: [error(3, 'vi.useRealTimers()')],
    },
    // A setup hook registered by function name.
    {
      code: `function pin() {\n  vi.useFakeTimers();\n  vi.setSystemTime(NOW);\n}
describe('s', () => {
  beforeEach(pin);
  it('t', () => {\n    vi.clearAllTimers();\n    expect(a).toBe(1);\n  });
});`,
      filename,
      errors: [error(8)],
    },
    // A test-local closure resets the clock where it is called.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  const restore = () => vi.useRealTimers();\n  restore();\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(4, 'restore()')],
    },
    {
      code: "it('t', () => {\n  vi.useFakeTimers().setSystemTime(NOW);\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(3)],
    },
    // A same-file helper whose last clock call is a reset is reported at its call.
    {
      code: "const resetClock = () => {\n  vi.useRealTimers();\n};\nit('t', () => {\n  vi.setSystemTime(NOW);\n  resetClock();\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(6, 'resetClock()')],
    },
    // Assertions inside callbacks still run after the reset.
    {
      code: "it('t', async () => {\n  vi.setSystemTime(NOW);\n  vi.useRealTimers();\n  await waitFor(() => expect(a).toBe(1));\n});",
      filename,
      errors: [error(3, 'vi.useRealTimers()')],
    },
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  expect.soft(a).toBe(1);\n});",
      filename,
      errors: [error(3)],
    },
    // Every test spelling is checked.
    {
      code: "it.each([1, 2])('t %i', (n) => {\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  expect(n).toBe(1);\n});",
      filename,
      errors: [error(3)],
    },
    {
      code: "test.concurrent.only('t', async () => {\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n}, 10_000);",
      filename,
      errors: [error(3)],
    },
    // One report per reset, however many assertions follow it; each reset is reported.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n  vi.setSystemTime(LATER);\n  vi.useRealTimers();\n  expect(c).toBe(3);\n});",
      filename,
      errors: [error(3), error(7, 'vi.useRealTimers()')],
    },
    // A second reset while already dropped is not a separate offence.
    {
      code: "it('t', () => {\n  vi.setSystemTime(NOW);\n  vi.clearAllTimers();\n  vi.useRealTimers();\n  expect(a).toBe(1);\n});",
      filename,
      errors: [error(3)],
    },
  ],
});
