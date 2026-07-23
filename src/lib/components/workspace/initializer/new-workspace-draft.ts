/**
 * New Workspace modal draft persistence via the daemon drafts API
 * (PROTOCOL §5.16 `drafts.*`).
 *
 * The modal drafts a prompt + image attachments before any workspace or agent
 * exists, so the draft is keyed under the reserved sentinel IDs documented in
 * PROTOCOL §5.16 ("Opaque keys & reserved sentinels"). The daemon treats draft
 * keys as opaque, and the `__…__` form cannot collide with real workspace IDs
 * (daemon-generated slugs are lowercase alphanumerics + hyphens). Drafts are
 * per-`clientId`, so each install keeps its own private modal draft that
 * survives app restarts. All `drafts.*` failures are non-fatal — the modal
 * keeps working from in-memory state.
 */
import type { DraftAttachment, DraftsClient } from '$lib/client/app-client';
import {
  deserializeDraftAttachments,
  serializeDraftAttachments,
} from '$lib/components/chat/chat-draft-attachments';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import { createLogger } from '$lib/utils/client-logger';

/** Reserved sentinel `workspaceId` for the New Workspace modal draft (PROTOCOL §5.16). */
export const NEW_WORKSPACE_DRAFT_WORKSPACE_ID = '__new-workspace__';
/** Reserved sentinel `agentId` for the New Workspace modal draft (PROTOCOL §5.16). */
export const NEW_WORKSPACE_DRAFT_AGENT_ID = '__initializer__';

/** Legacy sessionStorage text-draft key — read once for migration, then removed. */
export const LEGACY_PROMPT_SESSION_KEY = 'compact-workspace-initializer-state-prompt';

/**
 * Size guard for the serialized `attachments` payload: stay well under the
 * daemon's 25 MB cap (PROTOCOL §5.16) so `drafts.set` never fails with -32602
 * mid-typing. Oversized attachments are dropped from the wire call only —
 * in-memory context items are unaffected.
 */
export const MAX_DRAFT_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

const logger = createLogger('NewWorkspaceDraft');

export interface NewWorkspaceDraftPayload {
  text: string;
  attachments?: DraftAttachment[];
}

/**
 * Restore the modal draft from the daemon. Returns the prompt text and
 * rehydrated context items, or `null` when there is nothing to restore.
 * When the daemon has no draft, falls back once to the legacy sessionStorage
 * text draft and removes that key (one-time migration). A failed `drafts.get`
 * is non-fatal and skips the migration so the legacy value survives for a
 * later attempt.
 */
export async function restoreNewWorkspaceDraft(
  drafts: DraftsClient,
): Promise<{ text: string; contextItems: ContextItem[] } | null> {
  try {
    const draft = await drafts.get(NEW_WORKSPACE_DRAFT_WORKSPACE_ID, NEW_WORKSPACE_DRAFT_AGENT_ID);
    if (draft) {
      return {
        text: draft.text ?? '',
        contextItems: draft.attachments?.length
          ? deserializeDraftAttachments(draft.attachments)
          : [],
      };
    }
  } catch (err) {
    logger.warn('drafts.get failed; continuing without a persisted draft', {
      error: String(err),
    });
    return null;
  }

  let legacyPrompt: string | null = null;
  try {
    legacyPrompt = sessionStorage.getItem(LEGACY_PROMPT_SESSION_KEY);
    if (legacyPrompt !== null) sessionStorage.removeItem(LEGACY_PROMPT_SESSION_KEY);
  } catch {
    // sessionStorage unavailable — nothing to migrate
  }
  return legacyPrompt ? { text: legacyPrompt, contextItems: [] } : null;
}

/**
 * Build the debounced `drafts.set` payload from the current prompt text and
 * context items. Serializes image attachments (empty ⇒ field omitted) and
 * applies the size guard: oversized attachments are dropped so text still
 * persists. Empty text with no attachments is the documented clear.
 */
export function buildNewWorkspaceDraftPayload(
  text: string,
  contextItems: ContextItem[],
): NewWorkspaceDraftPayload {
  const attachments = serializeDraftAttachments(contextItems);
  if (attachments.length === 0) return { text };
  const serializedBytes = JSON.stringify(attachments).length;
  if (serializedBytes > MAX_DRAFT_ATTACHMENTS_BYTES) {
    logger.warn('Draft attachments exceed the size guard; persisting text only', {
      serializedBytes,
      limit: MAX_DRAFT_ATTACHMENTS_BYTES,
      attachmentCount: attachments.length,
    });
    return { text };
  }
  return { text, attachments };
}

/** Fire-and-forget `drafts.set` under the sentinel keys; failures log only. */
export function persistNewWorkspaceDraft(
  drafts: DraftsClient,
  payload: NewWorkspaceDraftPayload,
): void {
  drafts
    .set(
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
      payload.text,
      payload.attachments,
    )
    .catch((err) => {
      logger.warn('drafts.set failed; draft kept in memory only', { error: String(err) });
    });
}

/**
 * Fire-and-forget `drafts.clear` under the sentinel keys (called after a
 * successful workspace create); also removes the legacy sessionStorage key.
 */
export function clearNewWorkspaceDraft(drafts: DraftsClient): void {
  try {
    sessionStorage.removeItem(LEGACY_PROMPT_SESSION_KEY);
  } catch {
    // sessionStorage unavailable — nothing to remove
  }
  drafts.clear(NEW_WORKSPACE_DRAFT_WORKSPACE_ID, NEW_WORKSPACE_DRAFT_AGENT_ID).catch((err) => {
    logger.warn('drafts.clear failed', { error: String(err) });
  });
}
