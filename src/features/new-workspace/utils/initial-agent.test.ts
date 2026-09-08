import { describe, expect, it } from 'vitest';

import { resolveNewWorkspaceAgentName, resolveNewWorkspaceSpecialistId } from './initial-agent';

describe('Untitled workspace initial agent resolution', () => {
  it('defaults to Developer until an authoritative roster omits it', () => {
    expect(resolveNewWorkspaceSpecialistId([], undefined)).toBe('developer');
    expect(
      resolveNewWorkspaceSpecialistId([{ id: 'developer', name: 'Project Developer' }], undefined),
    ).toBe('developer');
    expect(
      resolveNewWorkspaceSpecialistId([{ id: 'spec-writer', name: 'Coordinator' }], undefined),
    ).toBeUndefined();
  });

  it('honors explicit General and derives names from the resolved roster', () => {
    const specialists = [{ id: 'developer', name: 'Project Developer' }];
    expect(resolveNewWorkspaceSpecialistId(specialists, null)).toBeUndefined();
    expect(resolveNewWorkspaceAgentName(specialists, 'developer')).toBe('Project Developer');
    expect(resolveNewWorkspaceAgentName(specialists, undefined)).toBeTruthy();
  });
});
