/**
 * ContentBlock Strict Intake Utilities
 *
 * Validates incoming ContentBlock-shaped payloads against the canonical PROTOCOL.md §7
 * shape. The daemon (`intentd`) emits canonical fields directly; the renderer is a thin
 * presenter and MUST NOT silently heal/alias divergent payloads — any divergence
 * surfaces as a thrown error so the BE (or PROTOCOL.md) gets fixed at the source.
 *
 * Heals removed in AUDIT-P1-5:
 * - `content → text` aliasing  (PROTOCOL uses `text`)
 * - `toolName → name` aliasing  (PROTOCOL uses `name`)
 * - `toolCallId → tool_use_id` aliasing on tool_result  (different field on tool_use)
 * - `isError → is_error` aliasing
 * - default `type || 'text'`
 *
 * Structural transforms (proposal-from-resource, nav-link, flat→nested proposal) are
 * NOT field-name heals — they materialize FE-domain block types from canonical
 * wire-shaped envelopes — and remain.
 */

import type { ContentBlock } from './content-block';
import { normalizeContentBlock } from './content-block';
import { isProposalKind } from './proposal';
import { getProposalFromResourceBlock } from './proposal-resource';

const CANONICAL_BLOCK_TYPES = new Set<ContentBlock['type']>([
  'text',
  'code',
  'tool_use',
  'tool_result',
  'thinking',
  'image',
  'audio',
  'file',
  'nav-link',
  'proposal',
]);

/**
 * Strictly validate a ContentBlock-shaped payload against the canonical PROTOCOL.md §7
 * shape. Returns the block unchanged on success. Throws on any divergence — the FE
 * never silently rewrites field names or fills defaults for BE-owned payloads.
 *
 * Proposal-from-resource and nav-link structural transforms remain because they
 * materialize FE-domain block types from canonical wire-shaped envelopes (a
 * `type:"resource"` block carrying a proposal MIME, or a `kind:"nav-link"` flat
 * envelope) — they do not rename or default existing canonical fields.
 */
export function migrateFromLegacy(block: any): ContentBlock {
  if (!block || typeof block !== 'object') {
    throw new Error('Invalid block: must be an object');
  }

  const proposalFromResource = getProposalFromResourceBlock(block);
  if (proposalFromResource) {
    return {
      type: 'proposal',
      kind: proposalFromResource.kind,
      payload: proposalFromResource.payload,
      preview: proposalFromResource.preview,
      applyToolCallId: proposalFromResource.applyToolCallId,
      proposal: proposalFromResource,
      id: block.id,
      metadata: block.metadata,
    };
  }

  if (block.kind === 'nav-link' && typeof block.target === 'string') {
    return {
      type: 'nav-link',
      kind: 'nav-link',
      target: block.target,
      label: block.label,
      id: block.id,
      metadata: block.metadata,
    };
  }

  if ((block.type === 'proposal' || isProposalKind(block.kind)) && block.preview) {
    const proposal = block.proposal ?? {
      kind: block.kind,
      payload: block.payload ?? {},
      preview: block.preview,
      applyToolCallId: block.applyToolCallId,
    };
    return {
      type: 'proposal',
      kind: proposal.kind,
      payload: proposal.payload,
      preview: proposal.preview,
      applyToolCallId: proposal.applyToolCallId,
      proposal,
      id: block.id,
      metadata: block.metadata,
    };
  }

  if (typeof block.type !== 'string') {
    throw new Error(
      `Invalid ContentBlock: missing canonical 'type' field (PROTOCOL §7). Received: ${JSON.stringify(block)}`,
    );
  }
  if (!CANONICAL_BLOCK_TYPES.has(block.type as ContentBlock['type'])) {
    throw new Error(
      `Invalid ContentBlock: unknown 'type' "${block.type}" (PROTOCOL §7). Received: ${JSON.stringify(block)}`,
    );
  }

  assertNoLegacyAliases(block);

  return validateCanonicalBlock(block);
}

/**
 * Reject legacy field-name aliases that the FE used to silently rewrite. A divergent
 * payload must surface so the daemon (or PROTOCOL.md) is corrected at the source.
 */
function assertNoLegacyAliases(block: Record<string, any>): void {
  if (block.text === undefined && typeof block.content === 'string') {
    throw new Error(
      `Invalid ContentBlock: legacy 'content' field is not part of PROTOCOL §7 (use 'text'). Received: ${JSON.stringify(block)}`,
    );
  }
  if (block.name === undefined && typeof block.toolName === 'string') {
    throw new Error(
      `Invalid ContentBlock: legacy 'toolName' field is not part of PROTOCOL §7 (use 'name'). Received: ${JSON.stringify(block)}`,
    );
  }
  if (
    block.type === 'tool_result' &&
    block.tool_use_id === undefined &&
    typeof block.toolCallId === 'string'
  ) {
    throw new Error(
      `Invalid ContentBlock: tool_result must use 'tool_use_id' (PROTOCOL §7). Received: ${JSON.stringify(block)}`,
    );
  }
  if (block.is_error === undefined && block.isError !== undefined) {
    throw new Error(
      `Invalid ContentBlock: legacy 'isError' field is not part of PROTOCOL §7 (use 'is_error'). Received: ${JSON.stringify(block)}`,
    );
  }
}

/**
 * Convert an ACP-shaped ContentBlock to the internal representation. The ACP spec
 * requires a `type` discriminator — a missing/non-string `type` is an upstream
 * divergence and surfaces here rather than being silently defaulted to `"text"`.
 */
export function convertFromACP(acpBlock: any): ContentBlock {
  if (!acpBlock || typeof acpBlock !== 'object') {
    throw new Error('Invalid ACP block: must be an object');
  }

  const proposal = getProposalFromResourceBlock(acpBlock);
  if (proposal) {
    return {
      type: 'proposal',
      kind: proposal.kind,
      payload: proposal.payload,
      preview: proposal.preview,
      applyToolCallId: proposal.applyToolCallId,
      proposal,
    };
  }

  if (typeof acpBlock.type !== 'string') {
    throw new Error(
      `Invalid ACP block: missing 'type' discriminator. Received: ${JSON.stringify(acpBlock)}`,
    );
  }

  const block: ContentBlock = { type: acpBlock.type };

  // Text content
  if (acpBlock.text) {
    block.text = acpBlock.text;
  }

  // Image/Audio media
  if (acpBlock.data) {
    block.data = acpBlock.data;
  }
  if (acpBlock.mimeType) {
    block.mimeType = acpBlock.mimeType;
  }

  // Audio transcript
  if (acpBlock.transcript) {
    block.transcript = acpBlock.transcript;
  }

  // Resource handling
  if (acpBlock.resource) {
    block.metadata = {
      resource: acpBlock.resource,
    };
  }

  return block;
}

/**
 * Convert internal ContentBlock to ACP format
 * Returns ACP-compatible representation
 */
export function convertToACP(block: ContentBlock): any {
  const normalized = normalizeContentBlock(block);

  const acpBlock: any = {
    type: normalized.type,
  };

  // Text content
  if (normalized.text) {
    acpBlock.text = normalized.text;
  }

  if (normalized.kind === 'nav-link' || normalized.type === 'nav-link') {
    acpBlock.kind = 'nav-link';
    acpBlock.target = normalized.target;
    acpBlock.label = normalized.label;
  }

  if (normalized.type === 'proposal' && normalized.preview && isProposalKind(normalized.kind)) {
    acpBlock.kind = normalized.kind;
    acpBlock.payload = normalized.payload ?? {};
    acpBlock.preview = normalized.preview;
    acpBlock.applyToolCallId = normalized.applyToolCallId;
  }

  // Media
  if (normalized.data) {
    acpBlock.data = normalized.data;
  }
  if (normalized.mimeType) {
    acpBlock.mimeType = normalized.mimeType;
  }

  // Audio transcript
  if (normalized.transcript) {
    acpBlock.transcript = normalized.transcript;
  }

  // Resource from metadata
  if (normalized.metadata?.resource) {
    acpBlock.resource = normalized.metadata.resource;
  }

  return acpBlock;
}

/**
 * Strictly validate an array of ContentBlocks. Throws on the first divergent block —
 * the FE never silently drops blocks it cannot parse, because dropping is itself a
 * silent heal that hides BE/PROTOCOL drift from operators.
 */
export function migrateContentBlocks(blocks: any[]): ContentBlock[] {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks.map((block) => migrateFromLegacy(block));
}

/**
 * Validate a block whose `type` has already been confirmed to be canonical. Returns
 * the block (a shallow copy, to prevent caller mutation surfacing here) when the
 * canonical required fields for its type are present and well-typed; throws otherwise.
 */
function validateCanonicalBlock(block: Record<string, any>): ContentBlock {
  switch (block.type as ContentBlock['type']) {
    case 'text':
    case 'thinking':
      if (typeof block.text !== 'string') {
        throw new Error(
          `Invalid ${block.type} block: required 'text' field missing (PROTOCOL §7). Received: ${JSON.stringify(block)}`,
        );
      }
      break;
    case 'tool_use':
      if (typeof block.name !== 'string') {
        throw new Error(
          `Invalid tool_use block: required 'name' field missing (PROTOCOL §7). Received: ${JSON.stringify(block)}`,
        );
      }
      break;
    case 'tool_result':
      if (typeof block.tool_use_id !== 'string') {
        throw new Error(
          `Invalid tool_result block: required 'tool_use_id' field missing (PROTOCOL §7). Received: ${JSON.stringify(block)}`,
        );
      }
      break;
    case 'image':
    case 'audio':
      if (typeof block.data !== 'string' || typeof block.mimeType !== 'string') {
        throw new Error(
          `Invalid ${block.type} block: required 'data'/'mimeType' fields missing. Received: ${JSON.stringify(block)}`,
        );
      }
      break;
    case 'file':
      if (
        typeof block.data !== 'string' ||
        typeof block.mimeType !== 'string' ||
        typeof block.fileName !== 'string'
      ) {
        throw new Error(
          `Invalid file block: required 'data'/'mimeType'/'fileName' fields missing. Received: ${JSON.stringify(block)}`,
        );
      }
      break;
    case 'code':
    case 'nav-link':
    case 'proposal':
      // Handled by dedicated branches above or carries no required text/tool fields.
      break;
  }
  return { ...block } as ContentBlock;
}
