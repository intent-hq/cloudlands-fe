import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { localizeDaemonTerminalName, terminalDisplayName } from './terminal-display-name';

describe('localizeDaemonTerminalName', () => {
  it('localizes the daemon "Setup Script" spawn-time name', () => {
    expect(localizeDaemonTerminalName('Setup Script')).toBe(
      m.terminal_daemonName_setupScript_label(),
    );
  });

  it('localizes the daemon "Terminal" fallback name', () => {
    expect(localizeDaemonTerminalName('Terminal')).toBe(m.terminal_quakeOverlay_terminal_fallback());
  });

  it('returns unknown names unchanged (e.g. future daemon names, or already-localized values)', () => {
    expect(localizeDaemonTerminalName('some-unmapped-name')).toBe('some-unmapped-name');
  });

  it('returns undefined for an undefined name', () => {
    expect(localizeDaemonTerminalName(undefined)).toBeUndefined();
  });

  it('does not resolve prototype property names as daemon names', () => {
    expect(localizeDaemonTerminalName('toString')).toBe('toString');
    expect(localizeDaemonTerminalName('constructor')).toBe('constructor');
  });
});

describe('terminalDisplayName', () => {
  it('prefers the user-set customName verbatim over any daemon name', () => {
    expect(terminalDisplayName({ name: 'Setup Script', customName: 'My Terminal' })).toBe(
      'My Terminal',
    );
  });

  it('localizes the daemon name when there is no customName', () => {
    expect(terminalDisplayName({ name: 'Setup Script' })).toBe(
      m.terminal_daemonName_setupScript_label(),
    );
  });

  it('falls back to the generic fallback label when neither name nor customName is set', () => {
    expect(terminalDisplayName({})).toBe(m.terminal_quakeOverlay_terminal_fallback());
  });

  it('falls back to the raw name for an unrecognized daemon name', () => {
    expect(terminalDisplayName({ name: 'some-unmapped-name' })).toBe('some-unmapped-name');
  });
});
