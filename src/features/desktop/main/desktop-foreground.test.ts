import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopForegroundTracker } from './desktop-foreground';

const INTENT = 100;
const SAFARI = 411;
const SLACK = 522;
const GRACE = 5_000;

function setup(initial: number | null = INTENT) {
  let front: number | undefined = initial ?? undefined;
  const sample = vi.fn(async () => front);
  const tracker = new DesktopForegroundTracker(sample, GRACE, () => Date.now());
  return {
    tracker,
    sample,
    setFront: (pid: number | undefined) => {
      front = pid;
    },
    /** One agent action that leaves `pid` frontmost when it returns. */
    act: async (pid?: number) => {
      await tracker.beforeAgentAction('s');
      if (pid !== undefined) front = pid;
      await tracker.afterAgentAction('s');
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('user app switch detection', () => {
  it('is not a user switch when the agent leaves another app in front', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await t.act(SAFARI);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(false);
  });
  it('attributes a delayed activation after an agent click (Dock) to the agent', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await t.act(); // Dock click returns while Intent is still in front
    await vi.advanceTimersByTimeAsync(1_500);
    t.setFront(SAFARI); // Safari finishes activating 1.5 s later
    await vi.advanceTimersByTimeAsync(60_000); // no later agent action
    await expect(t.tracker.userSwitched('s')).resolves.toBe(false);
  });
  it('re-samples before a later action so a delayed activation is not a user switch', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await t.act();
    await vi.advanceTimersByTimeAsync(1_500);
    t.setFront(SAFARI);
    await t.act(); // typed into Safari
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(false);
  });
  it('detects a Safari-to-Slack user switch after the attribution window', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await t.act(SAFARI);
    await vi.advanceTimersByTimeAsync(GRACE + 1_000);
    t.setFront(SLACK);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(true);
  });
  it('keeps a mid-session user switch even if the agent later brings an app back', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await t.act(SAFARI);
    await vi.advanceTimersByTimeAsync(GRACE + 1_000);
    t.setFront(SLACK); // user
    await t.act(SAFARI); // agent switches back
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(true);
  });
  it('detects a user switch when the agent never acted', async () => {
    const t = setup();
    await t.tracker.begin('s');
    t.setFront(SLACK);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(true);
  });
  it('treats a change right after the last agent action as the agent', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await t.act(SAFARI);
    await vi.advanceTimersByTimeAsync(1_000);
    t.setFront(SLACK);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(false);
  });
  it('cannot tell without readings, for another session, or when sampling fails', async () => {
    const t = setup(null);
    await t.tracker.begin('s');
    await t.act();
    await vi.advanceTimersByTimeAsync(60_000);
    t.setFront(SLACK);
    await expect(t.tracker.userSwitched('s')).resolves.toBeUndefined();
    const u = setup();
    await u.tracker.begin('s');
    await expect(u.tracker.userSwitched('other')).resolves.toBeUndefined();
    u.sample.mockRejectedValue(new Error('helper gone'));
    await expect(u.tracker.userSwitched('s')).resolves.toBeUndefined();
  });
  it('never throws into agent actions when sampling fails', async () => {
    const t = setup();
    t.sample.mockRejectedValue(new Error('helper gone'));
    await expect(t.tracker.begin('s')).resolves.toBeUndefined();
    await expect(t.act()).resolves.toBeUndefined();
  });
  it('a new session starts with a clean slate', async () => {
    const t = setup();
    await t.tracker.begin('s');
    await vi.advanceTimersByTimeAsync(GRACE + 1);
    t.setFront(SLACK);
    await expect(t.tracker.userSwitched('s')).resolves.toBe(true);
    await t.tracker.begin('s2');
    await expect(t.tracker.userSwitched('s2')).resolves.toBe(false);
  });
});
