import { parseIntentLink } from '$lib/utils/workspaces-link-handler';
import type { MentionCandidate } from '$lib/services/mentions/types';

export interface DiscussionReference {
  kind: 'agent' | 'file' | 'pr';
  label: string;
  url: string;
  agentId?: string;
}

/** Accept only known destinations; message text is never interpreted as HTML. */
export function parseDiscussionReference(
  url: string,
  label: string,
  workspaceId: string,
): DiscussionReference | null {
  if (!workspaceId || /[\s\\]/.test(url) || /%2f|%5c/i.test(url)) return null;
  try {
    if (/\p{Cc}/u.test(decodeURIComponent(url))) return null;
  } catch {
    return null;
  }
  const agent = /^intent:\/\/local\/([A-Za-z0-9_-]+)\/agent\/([A-Za-z0-9_-]+)$/.exec(url);
  if (agent && agent[1] === workspaceId) return { kind: 'agent', label, url, agentId: agent[2] };
  if (url.startsWith('intent://local/')) {
    const parsed = parseIntentLink(url);
    if (
      parsed.valid &&
      parsed.orgId === 'local' &&
      parsed.type === 'file' &&
      (!parsed.workspaceId || parsed.workspaceId === workspaceId)
    ) {
      return { kind: 'file', label, url };
    }
    return null;
  }
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(url)) {
    const parts = url.slice('https://github.com/'.length).split('/');
    if (parts[0] !== '.' && parts[0] !== '..' && parts[1] !== '.' && parts[1] !== '..')
      return { kind: 'pr', label, url };
  }
  return null;
}

export function discussionBodyParts(
  body: string,
  workspaceId: string,
): Array<string | DiscussionReference> {
  const result: Array<string | DiscussionReference> = [];
  const pattern = /\[([^\]\n]{1,200})\]\(([^\s)]+)\)/g;
  let cursor = 0;
  for (const match of body.matchAll(pattern)) {
    const reference = parseDiscussionReference(match[2], match[1], workspaceId);
    if (!reference) continue;
    if (match.index > cursor) result.push(body.slice(cursor, match.index));
    result.push(reference);
    cursor = match.index + match[0].length;
  }
  if (cursor < body.length) result.push(body.slice(cursor));
  return result;
}

export function discussionReferenceMarkdown(reference: DiscussionReference): string {
  const label = reference.label.replace(/[\[\]\\\r\n]/g, ' ').trim() || reference.kind;
  return `[${label}](${reference.url})`;
}

export function discussionCandidateReference(
  candidate: MentionCandidate,
  workspaceId: string,
): DiscussionReference | null {
  let url: string;
  if (candidate.type === 'agent') {
    url = `intent://local/${workspaceId}/agent/${candidate.id}`;
  } else if (candidate.type === 'file' && candidate.meta?.path) {
    const path = candidate.meta.path
      .split('/')
      .map((part) =>
        encodeURIComponent(part).replace(
          /[()]/g,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .join('/');
    url = `intent://local/${workspaceId}/file/${path}`;
  } else return null;
  return parseDiscussionReference(url, candidate.label, workspaceId);
}
