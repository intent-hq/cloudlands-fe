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
