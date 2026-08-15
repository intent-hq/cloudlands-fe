/**
 * pr-chip-label tests: the four shared label rules (`repo #N` same-owner,
 * `owner/repo #N` cross-owner or unknown workspace repo) plus the defensive
 * branches — repo without a `/`, workspaceRepo without a `/`, and
 * case-insensitive owner comparison.
 */
import { describe, expect, it } from 'vitest';
import { getPrChipLabel, getPrRepoLabel } from './pr-chip-label';

describe('getPrRepoLabel', () => {
  it('renders "repo" when the owner matches the workspace owner', () => {
    expect(getPrRepoLabel('acme/widgets', 'acme/widgets')).toBe('widgets');
    expect(getPrRepoLabel('acme/lib', 'acme/widgets')).toBe('lib');
  });

  it('renders "owner/repo" for a different owner or unknown workspace repo', () => {
    expect(getPrRepoLabel('other/lib', 'acme/widgets')).toBe('other/lib');
    expect(getPrRepoLabel('acme/widgets')).toBe('acme/widgets');
  });
});

describe('getPrChipLabel', () => {
  it('renders "repo #N" when owner and repo match the workspace repo', () => {
    expect(getPrChipLabel('acme/widgets', 42, 'acme/widgets')).toBe('widgets #42');
  });

  it('renders "repo #N" for a same-owner, different-repo PR', () => {
    expect(getPrChipLabel('acme/lib', 42, 'acme/widgets')).toBe('lib #42');
  });

  it('renders "owner/repo #N" for a different-owner PR', () => {
    expect(getPrChipLabel('other/lib', 42, 'acme/widgets')).toBe('other/lib #42');
  });

  it('renders "owner/repo #N" when the workspace repo is unknown', () => {
    expect(getPrChipLabel('acme/widgets', 42)).toBe('acme/widgets #42');
    expect(getPrChipLabel('acme/widgets', 42, undefined)).toBe('acme/widgets #42');
  });

  it('compares owners case-insensitively', () => {
    expect(getPrChipLabel('Acme/widgets', 42, 'acme/widgets')).toBe('widgets #42');
    expect(getPrChipLabel('acme/lib', 42, 'ACME/widgets')).toBe('lib #42');
  });

  it('does not lowercase the repo name in the rendered label', () => {
    expect(getPrChipLabel('Other/Lib', 42, 'acme/widgets')).toBe('Other/Lib #42');
    expect(getPrChipLabel('ACME/Widgets', 42, 'acme/widgets')).toBe('Widgets #42');
  });

  it('renders the repo string as-is when it has no "/"', () => {
    expect(getPrChipLabel('widgets', 42, 'acme/widgets')).toBe('widgets #42');
    expect(getPrChipLabel('widgets', 42)).toBe('widgets #42');
  });

  it('treats a workspaceRepo without a "/" as unknown', () => {
    expect(getPrChipLabel('acme/widgets', 42, 'acme')).toBe('acme/widgets #42');
    expect(getPrChipLabel('acme/widgets', 42, '')).toBe('acme/widgets #42');
  });

  it('splits the repo on the first "/" only', () => {
    expect(getPrChipLabel('acme/group/widgets', 42, 'acme/other')).toBe('group/widgets #42');
    expect(getPrChipLabel('acme/group/widgets', 42, 'other/x')).toBe('acme/group/widgets #42');
  });

  it('renders 4+ digit PR numbers without digit grouping', () => {
    expect(getPrChipLabel('acme/widgets', 1182, 'acme/widgets')).toBe('widgets #1182');
  });
});
