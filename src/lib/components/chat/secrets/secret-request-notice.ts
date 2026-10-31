/**
 * Daemon-delivered secret-request notices (PROTOCOL §5.56). After the user
 * provides or declines a secret, intentd delivers a user-origin row to the
 * agent tagged `{ type: "secret_provided" | "secret_declined", source:
 * "system", requestId, name }` (on the row's `metadata` and on the persisted
 * text block's `messageMetadata`). The FE renders it as a compact chip
 * instead of a user bubble. The row never carries the value.
 */

import type { ContentBlock } from '$shared/types/content-block';
import type { SecretRequestOutcome } from '$shared/types/secret-request-resource';

interface MessageLike {
  metadata?: Record<string, unknown> | null;
  contentBlocks?: ContentBlock[];
}

export interface SecretRequestNoticeInfo {
  outcome: SecretRequestOutcome;
  requestId: string;
  name: string;
}

function fromMetadata(metadata: unknown): SecretRequestNoticeInfo | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const md = metadata as Record<string, unknown>;
  const outcome =
    md.type === 'secret_provided' ? 'provided' : md.type === 'secret_declined' ? 'declined' : null;
  if (!outcome || typeof md.requestId !== 'string' || typeof md.name !== 'string') return null;
  return { outcome, requestId: md.requestId, name: md.name };
}

/** The notice info when `message` is a secret-request notice row, else null. */
export function getSecretRequestNotice(
  message: MessageLike | null | undefined,
): SecretRequestNoticeInfo | null {
  if (!message) return null;
  const fromRow = fromMetadata(message.metadata);
  if (fromRow) return fromRow;
  const blocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
  for (const block of blocks) {
    if (block.type === 'text') {
      const fromBlock = fromMetadata(block.messageMetadata);
      if (fromBlock) return fromBlock;
    }
  }
  return null;
}
