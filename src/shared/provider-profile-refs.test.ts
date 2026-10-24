import { describe, expect, it } from 'vitest';
import {
  expandProviderIdsWithProfiles,
  findProfileByRef,
  providerRefBaseId,
  providerRefLabelParts,
} from './provider-profiles';
import { formatProviderRefLabel } from './provider-ref-label';

// §5.54 catalog `profiles` summaries, in the daemon's stored order.
const work = { providerRef: 'codex@pwork00000001', baseProviderId: 'codex', name: 'Work' };
const personal = { providerRef: 'codex@ppers00000001', baseProviderId: 'codex', name: 'Personal' };
const claudeWork = {
  providerRef: 'claude-code@pclwk0000001',
  baseProviderId: 'claude-code',
  name: 'Work',
};

describe('provider reference helpers (§5.54)', () => {
  it('recovers the base provider of qualified and bare references', () => {
    expect(providerRefBaseId('codex@pwork00000001')).toBe('codex');
    expect(providerRefBaseId('claude-code')).toBe('claude-code');
  });

  it('finds a profile only by its exact qualified reference', () => {
    expect(findProfileByRef([work, personal], 'codex@ppers00000001')).toBe(personal);
    expect(findProfileByRef([work], 'codex')).toBeUndefined();
    expect(findProfileByRef([work], 'codex@pgone00000001')).toBeUndefined();
  });

  it('places each profile right after its available base provider', () => {
    expect(
      expandProviderIdsWithProfiles(
        ['auggie', 'codex', 'claude-code'],
        [work, claudeWork, personal],
      ),
    ).toEqual([
      'auggie',
      'codex',
      'codex@pwork00000001',
      'codex@ppers00000001',
      'claude-code',
      'claude-code@pclwk0000001',
    ]);
  });

  it('offers no profile whose base provider is not available', () => {
    expect(expandProviderIdsWithProfiles(['auggie'], [work])).toEqual(['auggie']);
  });

  it('does not duplicate references already present', () => {
    expect(expandProviderIdsWithProfiles(['codex', 'codex@pwork00000001'], [work])).toEqual([
      'codex',
      'codex@pwork00000001',
    ]);
  });

  it('labels bare providers plainly until their base has a profile', () => {
    expect(providerRefLabelParts('codex', [])).toEqual({ kind: 'plain' });
    expect(providerRefLabelParts('codex', [claudeWork])).toEqual({ kind: 'plain' });
    expect(providerRefLabelParts('codex', [work])).toEqual({ kind: 'default' });
  });

  it('labels a renamed Default by its catalog name once its base has profiles', () => {
    const names = { codex: 'Personal' };
    expect(providerRefLabelParts('codex', [work], 'codex', names)).toEqual({
      kind: 'default',
      name: 'Personal',
    });
    // Without profiles the bare provider name stands, renamed or not.
    expect(providerRefLabelParts('codex', [], 'codex', names)).toEqual({ kind: 'plain' });
    expect(providerRefLabelParts('claude-code', [claudeWork], 'claude-code', names)).toEqual({
      kind: 'default',
    });
    expect(formatProviderRefLabel('codex', 'Codex', [work], 'codex', names)).toBe(
      formatProviderRefLabel('codex@pwork00000001', 'Codex', [{ ...work, name: 'Personal' }]),
    );
    expect(formatProviderRefLabel('codex', 'Codex', [], 'codex', names)).toBe('Codex');
    // A profile keeps its own name.
    expect(formatProviderRefLabel(work.providerRef, 'Codex', [work], 'codex', names)).toContain(
      'Work',
    );
  });

  it('labels a qualified reference by its current name, or as missing once removed', () => {
    expect(providerRefLabelParts('codex@pwork00000001', [work])).toEqual({
      kind: 'profile',
      name: 'Work',
    });
    expect(providerRefLabelParts('codex@pwork00000001', [])).toEqual({ kind: 'missing' });
  });

  it('changes only the label when a profile is renamed', () => {
    const before = formatProviderRefLabel(work.providerRef, 'Codex', [work]);
    const renamed = { ...work, name: 'Client A' };
    const after = formatProviderRefLabel(work.providerRef, 'Codex', [renamed]);
    expect(before).toContain('Work');
    expect(after).toContain('Client A');
    expect(after).not.toContain('Work');
    // Identity is untouched: the same reference still finds the renamed profile.
    expect(findProfileByRef([renamed], work.providerRef)).toBe(renamed);
  });

  it('keeps the bare provider name when no profile applies', () => {
    expect(formatProviderRefLabel('codex', 'Codex', [])).toBe('Codex');
    expect(formatProviderRefLabel('codex', 'Codex', [work])).not.toBe('Codex');
  });
});
