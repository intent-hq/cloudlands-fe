import { describe, expect, it } from 'vitest';
import {
  decideEnable,
  decideServiceChange,
  shouldDisableOnKeyCancel,
  decideKeyRemove,
} from './autocomplete-settings-rules';

const noKeys = { kilo: false, openrouter: false };
const allKeys = { kilo: true, openrouter: true };

describe('decideEnable', () => {
  it('asks for the Kilo data confirmation when Kilo has no key', () => {
    expect(decideEnable('kilo', noKeys)).toBe('confirm-kilo');
  });

  it('enables Kilo straight away with a key', () => {
    expect(decideEnable('kilo', { ...noKeys, kilo: true })).toBe('enable');
  });

  it('opens the key field when OpenRouter has no key', () => {
    expect(decideEnable('openrouter', { ...noKeys, kilo: true })).toBe('ask-key');
  });

  it('enables OpenRouter straight away with a key', () => {
    expect(decideEnable('openrouter', { ...noKeys, openrouter: true })).toBe('enable');
  });
});

describe('decideServiceChange', () => {
  it('gates nothing while off', () => {
    expect(decideServiceChange(false, 'kilo', noKeys)).toEqual({
      disable: false,
      confirmKilo: false,
      askKey: false,
    });
    expect(decideServiceChange(false, 'openrouter', noKeys).askKey).toBe(false);
  });

  it('turns off and asks for confirmation when switching to keyless Kilo while on', () => {
    expect(decideServiceChange(true, 'kilo', noKeys)).toEqual({
      disable: true,
      confirmKilo: true,
      askKey: false,
    });
  });

  it('opens the key field when switching to keyless OpenRouter while on', () => {
    expect(decideServiceChange(true, 'openrouter', noKeys)).toEqual({
      disable: false,
      confirmKilo: false,
      askKey: true,
    });
  });

  it('gates nothing when the new service has a key', () => {
    expect(decideServiceChange(true, 'kilo', allKeys).confirmKilo).toBe(false);
    expect(decideServiceChange(true, 'openrouter', allKeys).askKey).toBe(false);
  });
});

describe('key field cancel and remove', () => {
  it('turns off when the OpenRouter key field is cancelled without a key', () => {
    expect(shouldDisableOnKeyCancel('openrouter', noKeys)).toBe(true);
    expect(shouldDisableOnKeyCancel('openrouter', allKeys)).toBe(false);
    expect(shouldDisableOnKeyCancel('kilo', noKeys)).toBe(false);
  });

  it('turns off when the OpenRouter key is removed while on', () => {
    expect(decideKeyRemove(true, 'openrouter')).toEqual({ disable: true, confirmKilo: false });
    expect(decideKeyRemove(false, 'openrouter')).toEqual({ disable: false, confirmKilo: false });
  });

  it('turns off and asks for the Kilo data confirmation when the Kilo key is removed while on', () => {
    expect(decideKeyRemove(true, 'kilo')).toEqual({ disable: true, confirmKilo: true });
    expect(decideKeyRemove(false, 'kilo')).toEqual({ disable: false, confirmKilo: false });
  });
});
