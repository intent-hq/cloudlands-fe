/**
 * Derives the `workspace.create` `contextLinks` param (PROTOCOL §5.1) from the
 * initializer's GitHub issue/PR context mentions.
 *
 * PR mentions are inserted with itemType `github-issue` (same as issues), so
 * PR-ness is detected from the canonical GitHub URL path (`/pull/`), the
 * explicit `github-pr` itemType, or PR-only mention metadata (`sourceBranch`).
 */
import type { ContextLink } from '$shared/types';

/** Wire cap on `contextLinks` entries (PROTOCOL §5.1). */
export const MAX_CONTEXT_LINKS = 20;

/** Structural subset of the editor's context mention shape (metadata is a JSON string). */
export interface ContextLinkMention {
  itemType?: string;
  provider?: string;
  identifier?: string;
  url?: string;
  metadata?: string;
}

const IDENTIFIER_PATTERN = /^([^/]+)\/([^#]+)#(\d+)$/;

function detectKind(mention: ContextLinkMention): ContextLink['kind'] {
  if (mention.itemType === 'github-pr') return 'pr';
  if (mention.url && /\/pull\/\d+/.test(mention.url)) return 'pr';
  if (mention.metadata) {
    try {
      const metadata = JSON.parse(mention.metadata);
      if (typeof metadata?.sourceBranch === 'string' && metadata.sourceBranch.length > 0) {
        return 'pr';
      }
    } catch {
      // Ignore parse errors — fall through to 'issue'
    }
  }
  return 'issue';
}

/**
 * Builds the `contextLinks` create param from context mentions. Only GitHub
 * issue/PR mentions with a parseable `owner/repo#number` identifier and a URL
 * qualify; duplicates collapse and the list is capped at the wire maximum.
 * Returns `undefined` when nothing qualifies so the param is omitted on the
 * wire (older daemons ignore the field entirely).
 */
export function buildContextLinks(mentions: ContextLinkMention[]): ContextLink[] | undefined {
  const links: ContextLink[] = [];
  const seen = new Set<string>();
  for (const mention of mentions) {
    if (links.length >= MAX_CONTEXT_LINKS) break;
    if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') continue;
    if (mention.provider !== 'github') continue;
    if (!mention.url) continue;
    const match = mention.identifier?.match(IDENTIFIER_PATTERN);
    if (!match) continue;
    const [, owner, repo, numberStr] = match;
    const number = parseInt(numberStr, 10);
    if (!Number.isInteger(number) || number <= 0) continue;
    const kind = detectKind(mention);
    const key = `${kind}:${owner}/${repo}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ kind, url: mention.url, owner, repo, number });
  }
  return links.length > 0 ? links : undefined;
}
