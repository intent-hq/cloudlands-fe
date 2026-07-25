/**
 * Identity/dedupe helpers for §7.1 standalone resource blocks: the shared
 * notion of "same card" between a daemon-registered canonical block (nonce
 * stamped into its JSON text under `attachmentId`) and an FE-lifted rebuild
 * (no nonce, superficially different uri/text).
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ID_KEY,
  dedupeResourceBlocks,
  getResourceAttachmentId,
  getResourceContents,
  isCanonicalResourceBlock,
  resourceDedupeKey,
} from '../resource-block-identity';
import { PROPOSAL_RESOURCE_MIME_TYPE } from '../proposal-resource';

const PROPOSAL = {
  kind: 'workspace-create',
  payload: { operation: 'workspace.create', params: { repositoryPath: '/repo' } },
  preview: { title: 'Create workspace' },
  applyToolCallId: 'tc-1',
};

function proposalBlock(overrides: { nonce?: string; uri?: string } = {}) {
  const payload: Record<string, unknown> = { ...PROPOSAL };
  if (overrides.nonce) payload[ATTACHMENT_ID_KEY] = overrides.nonce;
  return {
    type: 'resource',
    resource: {
      uri: overrides.uri ?? 'intent-proposal://workspace-create/tc-1',
      name: 'Create workspace',
      mimeType: PROPOSAL_RESOURCE_MIME_TYPE,
      text: JSON.stringify(payload),
    },
  };
}

function genericBlock(overrides: { nonce?: string; uri?: string; text?: string } = {}) {
  const text =
    overrides.text ??
    JSON.stringify(overrides.nonce ? { [ATTACHMENT_ID_KEY]: overrides.nonce, a: 1 } : { a: 1 });
  return {
    type: 'resource',
    resource: {
      uri: overrides.uri ?? 'intent-card://generic/1',
      name: 'Generic',
      mimeType: 'application/vnd.intent.other+json',
      text,
    },
  };
}

describe('getResourceContents', () => {
  it('extracts well-formed resource contents', () => {
    expect(getResourceContents(proposalBlock())?.mimeType).toBe(PROPOSAL_RESOURCE_MIME_TYPE);
  });

  it('rejects non-resource blocks and malformed resources', () => {
    expect(getResourceContents({ type: 'text', text: 'hi' })).toBeNull();
    expect(getResourceContents({ type: 'resource', resource: { uri: 'x' } })).toBeNull();
    expect(getResourceContents(null)).toBeNull();
  });

  it('rejects a present-but-non-string name', () => {
    const block = proposalBlock() as { resource: Record<string, unknown> };
    block.resource.name = 42;
    expect(getResourceContents(block)).toBeNull();
  });
});

describe('getResourceAttachmentId / isCanonicalResourceBlock', () => {
  it('reads the stamped nonce from a registered payload', () => {
    const block = proposalBlock({ nonce: 'tar-abc123def456' });
    expect(getResourceAttachmentId(block)).toBe('tar-abc123def456');
    expect(isCanonicalResourceBlock(block)).toBe(true);
  });

  it('returns null for unstamped payloads and non-JSON text', () => {
    expect(getResourceAttachmentId(proposalBlock())).toBeNull();
    expect(isCanonicalResourceBlock(proposalBlock())).toBe(false);
    expect(getResourceAttachmentId(genericBlock({ text: 'not json' }))).toBeNull();
  });

  it('rejects attachmentId values that do not match the daemon nonce format', () => {
    // A user/tool payload that happens to carry an `attachmentId` key must
    // not be misclassified as canonical (tar- + 12 hex only).
    expect(getResourceAttachmentId(proposalBlock({ nonce: 'my-custom-id' }))).toBeNull();
    expect(getResourceAttachmentId(proposalBlock({ nonce: 'tar-SHOUTY12HEX' }))).toBeNull();
    expect(getResourceAttachmentId(proposalBlock({ nonce: 'tar-abc' }))).toBeNull();
    expect(isCanonicalResourceBlock(proposalBlock({ nonce: 'my-custom-id' }))).toBe(false);
  });
});

describe('resourceDedupeKey', () => {
  it('keys proposal resources on the proposal identity regardless of nonce/uri', () => {
    const lifted = proposalBlock({ uri: 'intent-proposal://workspace-create/Create%20workspace' });
    const attached = proposalBlock({ nonce: 'tar-abc123def456' });
    expect(resourceDedupeKey(lifted)).toMatch(/^proposal:workspace-create:tc-1:/);
    expect(resourceDedupeKey(attached)).toBe(resourceDedupeKey(lifted));
  });

  it('keeps two proposals with the same kind + title but different payloads apart', () => {
    const a = proposalBlock();
    const b = structuredClone(proposalBlock());
    const parsed = JSON.parse(b.resource.text) as Record<string, unknown>;
    parsed.payload = { operation: 'workspace.create', params: { repositoryPath: '/other' } };
    b.resource.text = JSON.stringify(parsed);
    expect(resourceDedupeKey(a)).not.toBe(resourceDedupeKey(b));
  });

  it('fingerprints payloads independently of JSON key order', () => {
    const a = proposalBlock();
    const b = structuredClone(proposalBlock());
    const parsed = JSON.parse(b.resource.text) as {
      payload: { operation: string; params: Record<string, unknown> };
    };
    // Re-serialize with reversed key insertion order.
    parsed.payload = { params: parsed.payload.params, operation: parsed.payload.operation } as {
      operation: string;
      params: Record<string, unknown>;
    };
    b.resource.text = JSON.stringify(parsed);
    expect(resourceDedupeKey(a)).toBe(resourceDedupeKey(b));
  });

  it('keys non-proposal resources on nonce when stamped, else uri', () => {
    expect(resourceDedupeKey(genericBlock({ nonce: 'tar-000000000001' }))).toBe(
      'nonce:tar-000000000001',
    );
    expect(resourceDedupeKey(genericBlock())).toBe('uri:intent-card://generic/1');
  });

  it('returns null for non-resource blocks', () => {
    expect(resourceDedupeKey({ type: 'text', text: 'hi' })).toBeNull();
  });
});

describe('dedupeResourceBlocks', () => {
  it('keeps exactly one block per logical resource, preferring the canonical variant', () => {
    const lifted = proposalBlock();
    const attached = proposalBlock({ nonce: 'tar-abc123def456' });
    const text = { type: 'text', text: 'hello' };
    const out = dedupeResourceBlocks([text, lifted, attached]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(text);
    expect(out[1]).toBe(attached);
  });

  it('keeps the first occurrence when neither variant is canonical', () => {
    const first = proposalBlock();
    const second = proposalBlock({ uri: 'intent-proposal://workspace-create/other-encoding' });
    const out = dedupeResourceBlocks([first, second]);
    expect(out).toEqual([first]);
  });

  it('does not collapse distinct resources or non-resource blocks', () => {
    const a = genericBlock({ uri: 'intent-card://generic/a' });
    const b = genericBlock({ uri: 'intent-card://generic/b' });
    const text = { type: 'text', text: 'x' };
    const dupText = { type: 'text', text: 'x' };
    expect(dedupeResourceBlocks([a, b, text, dupText])).toEqual([a, b, text, dupText]);
  });
});
