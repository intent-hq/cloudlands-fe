/**
 * Google sign-in buttons spin forever in the browser panel when FedCM exists:
 * Electron has no FedCM account chooser, and Google Identity Services ignores
 * the rejected button request instead of opening its popup. Intent turns the
 * FedCm feature off, keeping any --disable-features value already given.
 */
import { describe, expect, it } from 'vitest';

import { disableChromiumFeatures, type ChromiumCommandLine } from '../chromium-features';

/** Mirrors Chromium: a repeated switch keeps only its last value. */
function fakeCommandLine(initial?: string): ChromiumCommandLine & { value(): string } {
  const switches = new Map<string, string>();
  if (initial !== undefined) switches.set('disable-features', initial);
  return {
    getSwitchValue: (name) => switches.get(name) ?? '',
    appendSwitch: (name, value = '') => {
      switches.set(name, value);
    },
    value: () => switches.get('disable-features') ?? '',
  };
}

describe('disableChromiumFeatures', () => {
  it('turns FedCM off by default', () => {
    const commandLine = fakeCommandLine();
    disableChromiumFeatures(commandLine);
    expect(commandLine.value()).toBe('FedCm');
  });

  it('keeps features the user already disabled', () => {
    const commandLine = fakeCommandLine('Foo, Bar');
    disableChromiumFeatures(commandLine, ['FedCm']);
    expect(commandLine.value()).toBe('Foo,Bar,FedCm');
  });

  it('does not rewrite the switch when every feature is already off', () => {
    const commandLine = fakeCommandLine('FedCm,Foo');
    let appended = 0;
    const counting: ChromiumCommandLine = {
      getSwitchValue: commandLine.getSwitchValue,
      appendSwitch: (name, value) => {
        appended += 1;
        commandLine.appendSwitch(name, value);
      },
    };
    disableChromiumFeatures(counting, ['FedCm']);
    expect(appended).toBe(0);
    expect(commandLine.value()).toBe('FedCm,Foo');
  });
});
