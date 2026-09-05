/**
 * Derives the `workspace.create` `contextLinks` param (PROTOCOL §5.1) from the
 * initializer's GitHub issue/PR context mentions.
 *
 * PR mentions are inserted with itemType `github-issue` (same as issues), so
 * PR-ness is detected from the canonical GitHub URL path (`/pull/`), the
 * explicit `github-pr` itemType, or PR-only mention metadata (`sourceBranch`).
 */
import type { ContextLink } from '$shared/types';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';

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

/** Build one context link from a canonical GitHub issue or pull-request URL. */
export function buildContextLinkFromUrl(url: string): ContextLink | null {
  const parsed = parseGitHubIssueOrPrUrl(url);
  if (!parsed) return null;
  return {
    kind: parsed.kind,
    url,
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
  };
}

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
  // Dedupe on owner/repo#number alone — the same object mentioned via both an
  // issue-style and a /pull/ URL is one link; a 'pr' detection wins over 'issue'.
  const byKey = new Map<string, ContextLink>();
  for (const mention of mentions) {
    if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') continue;
    if (mention.provider !== 'github') continue;
    if (!mention.url) continue;
    const match = mention.identifier?.match(IDENTIFIER_PATTERN);
    if (!match) continue;
    const [, owner, repo, numberStr] = match;
    const number = parseInt(numberStr, 10);
    if (!Number.isInteger(number) || number <= 0) continue;
    const kind = detectKind(mention);
    const key = `${owner}/${repo}#${number}`;
    const existing = byKey.get(key);
    if (existing) {
      if (existing.kind === 'issue' && kind === 'pr') {
        byKey.set(key, { kind, url: mention.url, owner, repo, number });
      }
      continue;
    }
    if (byKey.size >= MAX_CONTEXT_LINKS) continue;
    byKey.set(key, { kind, url: mention.url, owner, repo, number });
  }
  return byKey.size > 0 ? [...byKey.values()] : undefined;
}
