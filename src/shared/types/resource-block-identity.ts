import { isProposal } from './proposal';
import { PROPOSAL_RESOURCE_MIME_TYPE } from './proposal-resource';

/**
 * Identity helpers for standalone `{ type: "resource", resource: {…} }`
 * content blocks (PROTOCOL §7.1). The daemon registers canonical resource
 * blocks in its turn-attachment registry and carries the claimed batch on the
 * `agent:tool:call` event as `registeredAttachments`; the FE also keeps a
 * legacy lift that rebuilds the same block from the echoed tool output. Both
 * paths can surface the same logical resource, so every consumer (the events
 * bridge, MessageContent, StreamingMessageContent) needs ONE shared notion of
 * "these two blocks are the same card" to guarantee exactly one card renders
 * per resource. Dependency-light on purpose — no stores, no components.
 */

/**
 * Key the daemon stamps into a registered attachment's JSON-object `text`
 * (`intent_core::turn_attachments::ATTACHMENT_ID_KEY`, nonce format
 * `tar-` + 12 hex). FE-rebuilt lifts never carry it — only daemon-registered
 * payloads do — which is what makes it a canonicality marker.
 */
export const ATTACHMENT_ID_KEY = 'attachmentId';

export interface ResourceBlockContents {
  uri: string;
  name?: string;
  mimeType: string;
  text: string;
}

/**
 * Extract the `resource` contents from a §7.1 standalone resource block or an
 * MCP resource content item — both share the `{ type: "resource", resource:
 * { uri, mimeType, text } }` shape. Returns null for anything malformed.
 */
export function getResourceContents(block: unknown): ResourceBlockContents | null {
  if (!block || typeof block !== 'object') return null;
  const candidate = block as { type?: unknown; resource?: unknown };
  if (candidate.type !== 'resource') return null;
  const resource = candidate.resource as Partial<ResourceBlockContents> | undefined;
  if (
    !resource ||
    typeof resource !== 'object' ||
    typeof resource.uri !== 'string' ||
    typeof resource.mimeType !== 'string' ||
    typeof resource.text !== 'string'
  ) {
    return null;
  }
  return resource as ResourceBlockContents;
}

/**
 * The `attachmentId` nonce stamped into a registered resource's JSON-object
 * `text`, or null when the text is not a JSON object or carries no nonce
 * (e.g. an FE-rebuilt lift).
 */
export function getResourceAttachmentId(block: unknown): string | null {
  const contents = getResourceContents(block);
  if (!contents) return null;
  try {
    const parsed: unknown = JSON.parse(contents.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const id = (parsed as Record<string, unknown>)[ATTACHMENT_ID_KEY];
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * Deterministic JSON serialization (recursively sorted object keys) so two
 * serializations of the same value fingerprint identically regardless of the
 * serializer's key order (serde_json on the daemon vs JSON.stringify here).
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Stable identity key for a resource block, or null for non-resource blocks
 * (which are never deduped).
 *
 * Proposal-MIME resources key on the proposal itself (`kind` +
 * `applyToolCallId ?? preview.title` + a stable payload fingerprint) rather
 * than the nonce or URI: the daemon-registered variant carries a stamped
 * nonce and the FE-rebuilt lift does not, and their URIs/texts can differ
 * superficially (percent-encoding set, key order), yet they are the same
 * card. The payload fingerprint keeps two genuinely distinct proposals that
 * happen to share kind + title apart. Other MIME types key on the nonce when
 * stamped, else the URI.
 */
export function resourceDedupeKey(block: unknown): string | null {
  const contents = getResourceContents(block);
  if (!contents) return null;
  if (contents.mimeType === PROPOSAL_RESOURCE_MIME_TYPE) {
    try {
      const proposal: unknown = JSON.parse(contents.text);
      if (isProposal(proposal)) {
        return `proposal:${proposal.kind}:${proposal.applyToolCallId ?? proposal.preview.title}:${stableStringify(proposal.payload)}`;
      }
    } catch {
      // fall through to nonce/uri keys
    }
  }
  const nonce = getResourceAttachmentId(block);
  if (nonce) return `nonce:${nonce}`;
  return contents.uri.length > 0 ? `uri:${contents.uri}` : null;
}

/**
 * Whether the block is a daemon-registered canonical resource (its `text`
 * carries the stamped `attachmentId` nonce) as opposed to an FE-rebuilt lift.
 */
export function isCanonicalResourceBlock(block: unknown): boolean {
  return getResourceAttachmentId(block) !== null;
}

/**
 * Collapse duplicate resource blocks so exactly one card renders per logical
 * resource: the first occurrence's position is kept, and a later
 * daemon-canonical variant (stamped nonce) replaces an earlier non-canonical
 * one in place. Non-resource blocks pass through untouched.
 */
export function dedupeResourceBlocks<T>(blocks: readonly T[]): T[] {
  const keptIndexByKey = new Map<string, number>();
  const out: T[] = [];
  for (const block of blocks) {
    const key = resourceDedupeKey(block);
    if (key === null) {
      out.push(block);
      continue;
    }
    const keptIndex = keptIndexByKey.get(key);
    if (keptIndex === undefined) {
      keptIndexByKey.set(key, out.length);
      out.push(block);
      continue;
    }
    if (isCanonicalResourceBlock(block) && !isCanonicalResourceBlock(out[keptIndex])) {
      out[keptIndex] = block;
    }
  }
  return out;
}
