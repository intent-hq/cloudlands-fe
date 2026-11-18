import { describe, expect, it } from 'vitest';
import type { ProviderProfile } from '$shared/provider-profiles';
import {
  CONNECT_KINDS,
  canContinueConnect,
  connectSecretIssue,
  savedConnectProfile,
  uniqueProfileName,
} from './onboarding-connect-step';

const pad = 'A1b2C3d4E5f6G7h8I9j0K1l2';

describe('CONNECT_KINDS', () => {
  it('preselects the subscription or ChatGPT token, then offers an API key', () => {
    expect(CONNECT_KINDS).toEqual(['token', 'apiKey']);
  });
});

describe('connectSecretIssue', () => {
  it.each([
    ['claude', 'token', '', 'empty'],
    ['claude', 'token', `sk-ant-oat01-${pad}`, undefined],
    ['claude', 'token', `sk-ant-api03-${pad}`, 'shape'],
    ['claude', 'apiKey', `sk-ant-api03-${pad}`, undefined],
    ['codex', 'token', 'eyJh.eyJz.c2ln', undefined],
    ['codex', 'token', `sk-proj-${pad}`, 'shape'],
    ['codex', 'apiKey', `sk-proj-${pad}`, undefined],
    ['codex', 'apiKey', '  ', 'empty'],
  ] as const)('%s %s %j → %s', (provider, kind, secret, issue) => {
    expect(connectSecretIssue(provider, kind, secret)).toBe(issue);
  });
});

describe('savedConnectProfile', () => {
  const profile = { id: 'p1', baseProviderId: 'codex', providerRef: 'codex@p1' } as ProviderProfile;

  it('is the active profile of the chosen provider', () => {
    expect(savedConnectProfile('codex@p1', 'codex', [profile])).toBe(profile);
  });

  it('is nothing for the bare provider, another provider or a deleted profile', () => {
    expect(savedConnectProfile('codex', 'codex', [profile])).toBeUndefined();
    expect(savedConnectProfile('codex@p1', 'claude-code', [profile])).toBeUndefined();
    expect(savedConnectProfile('codex@p2', 'codex', [profile])).toBeUndefined();
  });
});

describe('canContinueConnect', () => {
  it('needs a well-formed secret, or a saved profile that is not being replaced', () => {
    expect(
      canContinueConnect({ saved: false, replacing: false, issue: 'empty', busy: false }),
    ).toBe(false);
    expect(
      canContinueConnect({ saved: false, replacing: false, issue: 'shape', busy: false }),
    ).toBe(false);
    expect(
      canContinueConnect({ saved: false, replacing: false, issue: undefined, busy: false }),
    ).toBe(true);
    expect(canContinueConnect({ saved: true, replacing: false, issue: 'empty', busy: false })).toBe(
      true,
    );
    expect(canContinueConnect({ saved: true, replacing: true, issue: 'empty', busy: false })).toBe(
      false,
    );
  });

  it('waits while the profile saves', () => {
    expect(
      canContinueConnect({ saved: false, replacing: false, issue: undefined, busy: true }),
    ).toBe(false);
  });
});

describe('uniqueProfileName', () => {
  it('keeps a free name and numbers a taken one, ignoring case', () => {
    expect(uniqueProfileName('Claude subscription', ['Default'])).toBe('Claude subscription');
    expect(uniqueProfileName('Claude subscription', ['claude SUBSCRIPTION'])).toBe(
      'Claude subscription 2',
    );
    expect(uniqueProfileName('OpenAI API key', ['OpenAI API key', 'OpenAI API key 2'])).toBe(
      'OpenAI API key 3',
    );
  });
});
