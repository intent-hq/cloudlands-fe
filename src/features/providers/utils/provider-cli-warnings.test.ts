import { describe, expect, it } from 'vitest';
import { providerCliWarnings, type ProviderCliDiscovery } from './provider-cli-warnings';

const outdated = (id: string): ProviderCliDiscovery => ({
  id,
  displayName: id,
  cliResolved: true,
  cliVersion: '0.1.0',
  cliMinimumVersion: '0.2.0',
  cliVersionOk: false,
});

describe('providerCliWarnings update command', () => {
  it('offers `codex update` for an outdated Codex CLI', () => {
    expect(providerCliWarnings([outdated('codex')])).toEqual([
      {
        providerId: 'codex',
        providerName: 'codex',
        version: '0.1.0',
        minimumVersion: '0.2.0',
        updateCommand: 'codex update',
      },
    ]);
  });

  it.each(['claude-code', 'pi', 'constructor', 'toString'])(
    'omits the update command for %s',
    (id) => {
      const [warning] = providerCliWarnings([outdated(id)]);
      expect(warning).toBeDefined();
      expect(warning).not.toHaveProperty('updateCommand');
    },
  );
});

describe('providerCliWarnings bundled CLI', () => {
  it('carries the daemon-reported bundled version alongside the update command', () => {
    const [warning] = providerCliWarnings([{ ...outdated('codex'), cliBundledVersion: ' 0.2.0 ' }]);
    expect(warning).toEqual({
      providerId: 'codex',
      providerName: 'codex',
      version: '0.1.0',
      minimumVersion: '0.2.0',
      updateCommand: 'codex update',
      bundledVersion: '0.2.0',
    });
  });

  it.each([undefined, '', '   '])('omits a missing or blank bundled version (%j)', (value) => {
    const [warning] = providerCliWarnings([
      { ...outdated('claude-code'), cliBundledVersion: value },
    ]);
    expect(warning).toBeDefined();
    expect(warning).not.toHaveProperty('bundledVersion');
  });

  it('never warns about a bundled CLI for a current installed CLI', () => {
    expect(
      providerCliWarnings([
        { ...outdated('codex'), cliVersionOk: true, cliBundledVersion: '0.2.0' },
      ]),
    ).toEqual([]);
  });
});
