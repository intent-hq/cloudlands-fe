import type { MentionCandidate } from '$lib/services/mentions/types';

/** A text-only persistence format, distinct from file and attached context tokens. */
export function serializeMemberMention(member: Pick<MentionCandidate, 'label' | 'meta'>): string {
  const json = JSON.stringify({
    label: member.label,
    principalId: member.meta?.principalId,
    workspaceId: member.meta?.workspaceId,
    identity: member.meta?.identity,
  });
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `@member[${encoded}]`;
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Treat persisted tokens as untrusted input. Never infer a forge from a handle. */
export function parseMemberMention(token: string): MentionCandidate | null {
  const match = /^@member\[([A-Za-z0-9+/=]+)\]$/.exec(token);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      !data ||
      !nonemptyString(data.label) ||
      !nonemptyString(data.principalId) ||
      !nonemptyString(data.workspaceId)
    )
      return null;
    const { identity } = data;
    if (
      identity !== undefined &&
      (!identity ||
        (identity.provider !== 'github' && identity.provider !== 'gitlab') ||
        !nonemptyString(identity.host) ||
        !nonemptyString(identity.externalUserId))
    )
      return null;

    return {
      type: 'member',
      id: `member-${data.principalId}`,
      label: data.label,
      uri: `devspace://member/${encodeURIComponent(data.principalId)}?workspaceId=${encodeURIComponent(data.workspaceId)}`,
      meta: {
        principalId: data.principalId,
        workspaceId: data.workspaceId,
        ...(identity
          ? {
              identity: {
                provider: identity.provider,
                host: identity.host,
                externalUserId: identity.externalUserId,
              },
            }
          : {}),
      },
    };
  } catch {
    return null;
  }
}

export function memberMentionLabel(label: string): string {
  return `@${label.replace(/^@/, '')}`;
}

/** Plain-text previews retain the handle without exposing persistence metadata. */
export function memberMentionsToText(text: string): string {
  return text.replace(/@member\[[^\]\s]*\]/g, (token) => {
    const member = parseMemberMention(token);
    return member ? memberMentionLabel(member.label) : token;
  });
}

export function memberMentionSubtitle(member: Pick<MentionCandidate, 'meta'>): string {
  const identity = member.meta?.identity;
  // i18n-ignore (forge brand and instance host)
  return identity
    ? `${identity.provider === 'github' ? 'GitHub' : 'GitLab'} · ${identity.host}`
    : '';
}
