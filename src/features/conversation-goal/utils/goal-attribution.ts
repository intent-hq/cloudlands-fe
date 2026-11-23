/**
 * Who set a conversation goal, as shared workspaces show it (PROTOCOL
 * `methods/agents.md` "Conversation goal" → "Attribution"). The name prefers
 * the principal's current workspace member entry, then the write-time
 * `goalSetBy` snapshot (`displayName`, then `login`), then "a former member";
 * the viewer's own principal reads as "you".
 */
import type { GoalSetBy } from '$shared/types/agent-session';
import { m } from '$shared/paraglide/messages.js';

export type GoalAttribution =
  { kind: 'self' } | { kind: 'member'; name: string } | { kind: 'former' };

interface MemberProfile {
  principalId: string;
  displayName: string | null;
  login: string | null;
}

/** Display text for a profile name: control characters and runs of whitespace collapse. */
function cleanName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return (
    value
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\p{White_Space}+/gu, ' ')
      .trim() || null
  );
}

function profileName(profile: Pick<MemberProfile, 'displayName' | 'login'>): string | null {
  return cleanName(profile.displayName) ?? cleanName(profile.login);
}

export interface ResolveGoalAttributionInput {
  /** The writer: `goalSetBy.principalId` or a notice row's `fromPrincipalId`. */
  principalId: string | null | undefined;
  /** The write-time profile snapshot, used only when it names the same principal. */
  snapshot?: GoalSetBy | null;
  /**
   * The workspace's accepted members (`workspace.members.list`), or null while
   * the roster is unknown. Only a known roster can tell that someone left.
   */
  members: readonly MemberProfile[] | null;
  /** The viewer's own principal (`principal.me`), or null while unknown. */
  ownPrincipalId: string | null;
}

/**
 * The attribution to show, or null when there is nothing trustworthy to say
 * (no writer, or an unknown roster with no snapshot). Callers gate on the
 * workspace being shared before calling.
 */
export function resolveGoalAttribution({
  principalId,
  snapshot,
  members,
  ownPrincipalId,
}: ResolveGoalAttributionInput): GoalAttribution | null {
  if (typeof principalId !== 'string' || principalId.trim().length === 0) return null;
  if (ownPrincipalId && principalId === ownPrincipalId) return { kind: 'self' };
  const member = members?.find((entry) => entry.principalId === principalId);
  const memberName = member ? profileName(member) : null;
  if (memberName) return { kind: 'member', name: memberName };
  const snapshotName =
    snapshot && snapshot.principalId === principalId ? profileName(snapshot) : null;
  if (snapshotName) return { kind: 'member', name: snapshotName };
  // A current member without a profile name is not "former"; say nothing.
  if (members && !member) return { kind: 'former' };
  return null;
}

/** Strip text: "Set by Alice" / "Set by you" / "Set by a former member". */
export function goalStripAttributionLabel(attribution: GoalAttribution): string {
  switch (attribution.kind) {
    case 'self':
      return m.chat_goalStrip_setByYou_label();
    case 'member':
      return m.chat_goalStrip_setBy_label({ name: attribution.name });
    case 'former':
      return m.chat_goalStrip_setByFormerMember_label();
  }
}

/** Notice row suffix: "by Alice" / "by you" / "by a former member". */
export function goalNoticeAttributionLabel(attribution: GoalAttribution): string {
  switch (attribution.kind) {
    case 'self':
      return m.chat_goalNotice_byYou_label();
    case 'member':
      return m.chat_goalNotice_by_label({ name: attribution.name });
    case 'former':
      return m.chat_goalNotice_byFormerMember_label();
  }
}

export function sameGoalAttribution(a: GoalAttribution | null, b: GoalAttribution | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind !== 'member' || a.name === (b as { name: string }).name;
}
