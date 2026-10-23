/**
 * Shared New Workspace draft keys and payload serialization for the saga-owned
 * daemon drafts flow (PROTOCOL §5.16 `drafts.*`).
 *
 * The prompt + image attachments are drafted before any workspace or agent
 * exists, so the draft is keyed under the reserved sentinel IDs documented in
 * PROTOCOL §5.16 ("Opaque keys & reserved sentinels"). The daemon treats draft
 * keys as opaque, and the `__…__` form cannot collide with real workspace IDs
 * (daemon-generated slugs are lowercase alphanumerics + hyphens). Drafts are
 * per-`clientId`, so each install keeps its own private modal draft that
 * survives app restarts. All `drafts.*` failures are non-fatal — the modal
 * keeps working from in-memory state.
 */
import type { DraftAttachment } from '$lib/client/app-client';
import { serializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import { createLogger } from '$lib/utils/client-logger';

/** Reserved sentinel `workspaceId` for the New Workspace modal draft (PROTOCOL §5.16). */
export const NEW_WORKSPACE_DRAFT_WORKSPACE_ID = '__new-workspace__';
/** Reserved sentinel `agentId` for the New Workspace modal draft (PROTOCOL §5.16). */
export const NEW_WORKSPACE_DRAFT_AGENT_ID = '__initializer__';

/** Legacy sessionStorage text-draft key — read once for migration, then removed. */
export const LEGACY_PROMPT_SESSION_KEY = 'compact-workspace-initializer-state-prompt';

/** Legacy onboarding-page sessionStorage text-draft key — read once for
 * migration, then removed. */
export const LEGACY_ONBOARDING_PROMPT_SESSION_KEY = 'onboarding-prompt';

/**
 * Size guard for the serialized draft payload (text + attachments combined):
 * stay well under the daemon's 25 MB cap (PROTOCOL §5.16) so `drafts.set`
 * never fails with -32602 mid-typing. Oversized attachments are dropped from
 * the wire call only — in-memory context items are unaffected.
 *
 * Measured in UTF-16 code units (`string.length`), not UTF-8 bytes as the
 * daemon counts them. Base64 attachment payloads are ASCII so it's ~1:1 in
 * practice, and the 5 MB headroom covers non-ASCII text/labels — do not
 * tighten the margin without switching to a byte-accurate measure.
 */
export const MAX_DRAFT_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

const logger = createLogger('NewWorkspaceDraft');

export interface NewWorkspaceDraftPayload {
  text: string;
  attachments?: DraftAttachment[];
}

/**
 * Build the debounced `drafts.set` payload from the current prompt text and
 * context items. Serializes image attachments (empty ⇒ field omitted) and
 * applies the size guard to text + attachments combined: attachments that
 * don't fit are dropped greedily (in item order) so text and every
 * attachment that fits still persist — one oversized image (the accepted
 * image cap, `REFERENCE_IMAGE_MAX_BYTES` = 30 MiB, exceeds this draft
 * guard; such images survive the send but not a reload) doesn't wipe the
 * rest from the draft. A pathologically large text returns `null` (skip the
 * wire call entirely). Empty text with no attachments is the documented
 * clear.
 */
export function buildNewWorkspaceDraftPayload(
  text: string,
  contextItems: ContextItem[],
): NewWorkspaceDraftPayload | null {
  if (text.length > MAX_DRAFT_ATTACHMENTS_BYTES) {
    logger.warn('Draft text exceeds the size guard; skipping persistence', {
      textLength: text.length,
      limit: MAX_DRAFT_ATTACHMENTS_BYTES,
    });
    return null;
  }
  const attachments = serializeDraftAttachments(contextItems);
  if (attachments.length === 0) return { text };
  // Greedy fit: keep each attachment whose serialized size still fits under
  // the guard alongside the text and the attachments already kept.
  const kept: DraftAttachment[] = [];
  let usedBytes = text.length + 2; // '[' + ']' of the serialized array
  let droppedCount = 0;
  for (const attachment of attachments) {
    const attachmentBytes = JSON.stringify(attachment).length + 1; // + separator
    if (usedBytes + attachmentBytes > MAX_DRAFT_ATTACHMENTS_BYTES) {
      droppedCount += 1;
      continue;
    }
    kept.push(attachment);
    usedBytes += attachmentBytes;
  }
  if (droppedCount > 0) {
    logger.warn('Draft attachments exceed the size guard; persisting the ones that fit', {
      limit: MAX_DRAFT_ATTACHMENTS_BYTES,
      attachmentCount: attachments.length,
      droppedCount,
    });
  }
  return kept.length > 0 ? { text, attachments: kept } : { text };
}
