import type { WorkspaceMember } from '../types';

/** Effective host access supersedes any retained direct guest row. */
export function isWorkspaceGuest(member: Pick<WorkspaceMember, 'role' | 'hostRole'>): boolean {
  return member.role !== 'owner' && (member.hostRole === undefined || member.hostRole === 'guest');
}
