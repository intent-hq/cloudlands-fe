/**
 * hook-wake-attribution tests: metadata detection (PROTOCOL §5.40
 * `{ type: 'hook_wake', hookId, hookName, reason, hookStillActive? }`) and
 * display-only stripping of the daemon's literal `[Background hook "<name>"]`
 * prefix and trailing `[This hook …]` state note.
 */
import { describe, expect, it } from 'vitest';
import {
  getHookWakeAttribution,
  stripHookWakePrefix,
  stripHookWakeStateNote,
} from './hook-wake-attribution';

describe('getHookWakeAttribution', () => {
  it('extracts hookId, hookName, and reason from hook_wake metadata', () => {
    const attr = getHookWakeAttribution({
      type: 'hook_wake',
      hookId: 'hook-1',
      hookName: 'ci-watch',
      reason: 'dispatched',
    });
    expect(attr).toEqual({
      hookId: 'hook-1',
      displayName: 'ci-watch',
      rawName: 'ci-watch',
      reason: 'dispatched',
    });
  });

  it('extracts the additive hookStillActive field when present', () => {
    const base = { type: 'hook_wake', hookId: 'h1', hookName: 'w', reason: 'dispatched' };
    expect(getHookWakeAttribution({ ...base, hookStillActive: true })?.hookStillActive).toBe(true);
    expect(getHookWakeAttribution({ ...base, hookStillActive: false })?.hookStillActive).toBe(
      false,
    );
  });

  it('omits hookStillActive when absent or non-boolean', () => {
    const base = { type: 'hook_wake', hookId: 'h1', hookName: 'w', reason: 'dispatched' };
    expect(getHookWakeAttribution(base)).not.toHaveProperty('hookStillActive');
    expect(getHookWakeAttribution({ ...base, hookStillActive: 'yes' })).not.toHaveProperty(
      'hookStillActive',
    );
  });

  it('returns null for absent, non-object, or wrong-type metadata', () => {
    expect(getHookWakeAttribution(undefined)).toBeNull();
    expect(getHookWakeAttribution(null)).toBeNull();
    expect(getHookWakeAttribution('hook_wake')).toBeNull();
    expect(getHookWakeAttribution({ type: 'agent_message', fromAgentId: 'a' })).toBeNull();
    expect(getHookWakeAttribution({ type: 'event_notification' })).toBeNull();
  });

  it('falls back to "Hook" when hookName is missing or blank, keeping rawName verbatim', () => {
    expect(getHookWakeAttribution({ type: 'hook_wake', hookId: 'h1' })?.displayName).toBe('Hook');
    const blank = getHookWakeAttribution({ type: 'hook_wake', hookId: 'h1', hookName: '   ' });
    expect(blank?.displayName).toBe('Hook');
    expect(blank?.rawName).toBe('   ');
  });

  it('keeps edge whitespace in rawName while trimming displayName', () => {
    const attr = getHookWakeAttribution({
      type: 'hook_wake',
      hookId: 'h1',
      hookName: ' my "quoted" hook ',
    });
    expect(attr?.rawName).toBe(' my "quoted" hook ');
    expect(attr?.displayName).toBe('my "quoted" hook');
  });

  it('truncates long hook names to ~20 chars with an ellipsis, keeping rawName untruncated', () => {
    const attr = getHookWakeAttribution({
      type: 'hook_wake',
      hookId: 'h1',
      hookName: 'a-very-long-hook-name-that-overflows',
    });
    expect(attr?.displayName.length).toBe(20);
    expect(attr?.displayName.endsWith('…')).toBe(true);
    expect(attr?.rawName).toBe('a-very-long-hook-name-that-overflows');
  });

  it('tolerates a missing hookId and reason (empty strings)', () => {
    const attr = getHookWakeAttribution({ type: 'hook_wake', hookName: 'watcher' });
    expect(attr).toEqual({ hookId: '', displayName: 'watcher', rawName: 'watcher', reason: '' });
  });
});

describe('stripHookWakePrefix', () => {
  it('strips the literal [Background hook "<name>"] prefix and following whitespace', () => {
    expect(stripHookWakePrefix('[Background hook "dispatcher"] CI is red')).toBe('CI is red');
    expect(stripHookWakePrefix('[Background hook ""] no name')).toBe('no name');
  });

  it('returns non-prefixed text unchanged', () => {
    expect(stripHookWakePrefix('CI is red')).toBe('CI is red');
    expect(stripHookWakePrefix('prefix [Background hook "x"] mid-text')).toBe(
      'prefix [Background hook "x"] mid-text',
    );
  });

  it('only strips the first prefix occurrence at the start', () => {
    expect(stripHookWakePrefix('[Background hook "a"] [Background hook "b"] tail')).toBe(
      '[Background hook "b"] tail',
    );
  });

  it('strips the exact prefix for names containing double quotes when rawName is given', () => {
    expect(
      stripHookWakePrefix('[Background hook "my "quoted" hook"] CI is red', 'my "quoted" hook'),
    ).toBe('CI is red');
  });

  it('strips the exact prefix for names with edge whitespace and quotes', () => {
    expect(
      stripHookWakePrefix('[Background hook " my "quoted" hook "] CI is red', ' my "quoted" hook '),
    ).toBe('CI is red');
  });

  it('strips the literal prefix of a whitespace-only rawName', () => {
    expect(stripHookWakePrefix('[Background hook "   "] CI is red', '   ')).toBe('CI is red');
  });

  it('leaves quoted-name prefixes intact without rawName (regex fallback cannot match)', () => {
    const text = '[Background hook "my "quoted" hook"] CI is red';
    expect(stripHookWakePrefix(text)).toBe(text);
  });

  it('falls back to the regex when rawName does not match the prefix', () => {
    expect(stripHookWakePrefix('[Background hook "dispatcher"] CI is red', 'other-name')).toBe(
      'CI is red',
    );
  });

  it('returns non-prefixed text unchanged when rawName is given', () => {
    expect(stripHookWakePrefix('CI is red', 'my "quoted" hook')).toBe('CI is red');
  });
});

describe('stripHookWakeStateNote', () => {
  it('strips the old one-shot dispatched note', () => {
    const note =
      '[This hook has now fired and is retired — it will not run again. ' +
      'Schedule a new hook via ws.hook.schedule if you still need to watch this condition.]';
    expect(stripHookWakeStateNote(`CI is red\n\n${note}`)).toBe('CI is red');
  });

  it('strips the old perpetual dispatched note', () => {
    const note =
      '[This hook has now fired, and it is PERPETUAL — it remains active and will keep ' +
      'running on its cadence until its TTL (expiresAt 2026-08-08T12:00:00Z). ' +
      'Cancel it via ws.hook.cancel if you no longer need this watch.]';
    expect(stripHookWakeStateNote(`CI is red\n\n${note}`)).toBe('CI is red');
  });

  it('strips the new one-shot and perpetual notes', () => {
    expect(
      stripHookWakeStateNote(
        'CI is red\n\n[This hook is now retired and will not run again — ' +
          'reschedule via ws.hook.schedule if still needed.]',
      ),
    ).toBe('CI is red');
    expect(
      stripHookWakeStateNote(
        'CI is red\n\n[This hook remains active until 2026-08-08T12:00:00Z — ' +
          'cancel via ws.hook.cancel when no longer needed.]',
      ),
    ).toBe('CI is red');
  });

  it('strips the note after a multi-paragraph body, trailing whitespace included', () => {
    expect(
      stripHookWakeStateNote(
        'CI is red\n\n[hook logs]\nchecked 3 runs\n\n[This hook will not run again. ' +
          'Schedule a new hook via ws.hook.schedule if the condition is still worth watching.]\n',
      ),
    ).toBe('CI is red\n\n[hook logs]\nchecked 3 runs');
  });

  it('strips a note constituting the whole string (empty dispatch message)', () => {
    expect(
      stripHookWakeStateNote(
        stripHookWakePrefix(
          '[Background hook "x"] \n\n[This hook is now retired and will not run again — ' +
            'reschedule via ws.hook.schedule if still needed.]',
        ),
      ),
    ).toBe('');
  });

  it('returns text without a trailing state note unchanged', () => {
    expect(stripHookWakeStateNote('CI is red')).toBe('CI is red');
    expect(stripHookWakeStateNote('CI is red\n\nall good now')).toBe('CI is red\n\nall good now');
    // Not a final paragraph (text follows the note) — no strip.
    expect(stripHookWakeStateNote('body\n\n[This hook is retired.] trailing text')).toBe(
      'body\n\n[This hook is retired.] trailing text',
    );
    // Mid-text note without a blank-line separator — no strip.
    expect(stripHookWakeStateNote('body [This hook is retired.]')).toBe(
      'body [This hook is retired.]',
    );
  });
});
