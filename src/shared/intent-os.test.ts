import { describe, expect, it } from 'vitest';
import {
  intentOsBooleanDefault,
  intentOsRendererArguments,
  intentOsSwitchOn,
  isIntentOs,
  type IntentOsImpliedSwitch,
} from './intent-os';
import { tabWindowDisplayMode } from './types/tab-window';

const IMPLIED: IntentOsImpliedSwitch[] = [
  'INTENT_NO_SYSTEM_BROWSER',
  'INTENT_IN_APP_PICKER',
  'INTENT_BROWSER_PASSKEYS',
];

describe('isIntentOs', () => {
  it('is on only for INTENT_OS=1', () => {
    expect(isIntentOs({ INTENT_OS: '1' })).toBe(true);
    expect(isIntentOs({ INTENT_OS: 'true' })).toBe(false);
    expect(isIntentOs({ INTENT_OS: '0' })).toBe(false);
    expect(isIntentOs({})).toBe(false);
  });
});

describe('intentOsSwitchOn', () => {
  it.each(IMPLIED)('INTENT_OS=1 implies %s', (name) => {
    expect(intentOsSwitchOn(name, { INTENT_OS: '1' })).toBe(true);
  });

  it.each(IMPLIED)('%s=1 still works alone', (name) => {
    expect(intentOsSwitchOn(name, { [name]: '1' })).toBe(true);
    for (const other of IMPLIED.filter((candidate) => candidate !== name)) {
      expect(intentOsSwitchOn(other, { [name]: '1' })).toBe(false);
    }
  });

  it.each(IMPLIED)('%s is off with neither switch', (name) => {
    expect(intentOsSwitchOn(name, {})).toBe(false);
  });
});

describe('intentOsBooleanDefault', () => {
  it('uses the Intent OS default only when nothing is saved', () => {
    const intentOs = { INTENT_OS: '1' };
    expect(intentOsBooleanDefault(undefined, false, true, intentOs)).toBe(true);
    expect(intentOsBooleanDefault(undefined, false, true, {})).toBe(false);
    expect(intentOsBooleanDefault('yes', false, true, intentOs)).toBe(true);
  });

  it('lets a saved value win, so turning a default off sticks', () => {
    const intentOs = { INTENT_OS: '1' };
    expect(intentOsBooleanDefault(false, false, true, intentOs)).toBe(false);
    expect(intentOsBooleanDefault(true, true, false, intentOs)).toBe(true);
  });
});

describe('intentOsRendererArguments', () => {
  it('passes Intent OS and the implied in-app picker to renderers', () => {
    // The preload reads these exact arguments (src/preload/index.template.ts).
    expect(intentOsRendererArguments({ INTENT_OS: '1' })).toEqual([
      '--intent-os',
      '--intent-in-app-picker',
    ]);
  });

  it('passes the in-app picker alone under INTENT_IN_APP_PICKER=1', () => {
    expect(intentOsRendererArguments({ INTENT_IN_APP_PICKER: '1' })).toEqual([
      '--intent-in-app-picker',
    ]);
    expect(intentOsRendererArguments({})).toEqual([]);
  });
});

describe('tab windows on Intent OS', () => {
  it('open full screen', () => {
    expect(tabWindowDisplayMode('linux', { INTENT_OS: '1' })).toBe('full-screen');
  });
});
