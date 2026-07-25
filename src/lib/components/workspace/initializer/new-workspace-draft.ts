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

/** Result of {@link restoreNewWorkspaceDraft}: `error` means `drafts.get`
 * failed, so the caller must not treat the daemon draft as absent (an empty
 * debounced save would clear a draft that may still exist). */
export type NewWorkspaceDraftRestore =
  | { status: 'restored'; text: string; contextItems: ContextItem[] }
  | { status: 'empty' }
  | { status: 'error' };

/**
 * Restore the modal draft from the daemon. When the daemon has no draft,
 * falls back once to the legacy sessionStorage text draft: the legacy value
 * is persisted to the daemon immediately (fire-and-forget `drafts.set`) and
 * the key removed, so the one-time migration does not depend on the caller's
 * debounced save path. A failed `drafts.get` is non-fatal, returns
 * `{ status: 'error' }`, and skips the migration so the legacy value
 * survives for a later attempt.
 */
export async function restoreNewWorkspaceDraft(
  drafts: DraftsClient,
): Promise<NewWorkspaceDraftRestore> {
  try {
    const draft = await drafts.get(NEW_WORKSPACE_DRAFT_WORKSPACE_ID, NEW_WORKSPACE_DRAFT_AGENT_ID);
    if (draft) {
      // The daemon draft supersedes any legacy value — drop the legacy key so
      // a stale prompt can't be "migrated" back in after the draft is cleared.
      try {
        sessionStorage.removeItem(LEGACY_PROMPT_SESSION_KEY);
      } catch {
        // sessionStorage unavailable — nothing to remove
      }
      return {
        status: 'restored',
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
    return { status: 'error' };
  }

  let legacyPrompt: string | null = null;
  try {
    legacyPrompt = sessionStorage.getItem(LEGACY_PROMPT_SESSION_KEY);
    if (legacyPrompt !== null) sessionStorage.removeItem(LEGACY_PROMPT_SESSION_KEY);
  } catch {
    // sessionStorage unavailable — nothing to migrate
  }
  if (!legacyPrompt) return { status: 'empty' };
  // Persist the migrated value right away so the handoff doesn't depend on
  // the caller's debounced save firing (it may drop the text if the prompt
  // was already populated).
  persistNewWorkspaceDraft(drafts, { text: legacyPrompt });
  return { status: 'restored', text: legacyPrompt, contextItems: [] };
}

/**
 * Build the debounced `drafts.set` payload from the current prompt text and
 * context items. Serializes image attachments (empty ⇒ field omitted) and
 * applies the size guard to text + attachments combined: oversized
 * attachments are dropped so text still persists, and a pathologically large
 * text returns `null` (skip the wire call entirely). Empty text with no
 * attachments is the documented clear.
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
  const serializedBytes = text.length + JSON.stringify(attachments).length;
  if (serializedBytes > MAX_DRAFT_ATTACHMENTS_BYTES) {
    logger.warn('Draft text + attachments exceed the size guard; persisting text only', {
      serializedBytes,
      limit: MAX_DRAFT_ATTACHMENTS_BYTES,
      attachmentCount: attachments.length,
    });
    return { text };
  }
  return { text, attachments };
}

/** Fire-and-forget `drafts.set` under the sentinel keys; failures log only.
 * A `null` payload (size guard) is a no-op. */
export function persistNewWorkspaceDraft(
  drafts: DraftsClient,
  payload: NewWorkspaceDraftPayload | null,
): void {
  if (!payload) return;
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

/** Debounce window for the modal draft save (`drafts.set`, PROTOCOL §5.16). */
export const NEW_WORKSPACE_DRAFT_DEBOUNCE_MS = 300;

/** Debounced draft saver with an explicit flush for unload/destroy. */
export interface NewWorkspaceDraftSaver {
  /** (Re)start the debounce timer with the latest text + context items. */
  schedule(text: string, contextItems: ContextItem[]): void;
  /** Persist a pending debounced save immediately; no-op when none is pending. */
  flush(): void;
}

/**
 * Create the debounced saver for the modal draft. Payload serialization
 * (incl. the size-guard stringify) is deferred to save time — `schedule` only
 * stores references, so it stays cheap per keystroke. `flush` closes the loss
 * window when the renderer unloads (cmd+R / window close) or the component is
 * destroyed inside the debounce window. `skipEmptySave` is consulted at save
 * time: when it returns true, an empty save (no text, no items) is dropped so
 * a failed restore can't clear a daemon draft that was never read.
 */
export function createNewWorkspaceDraftSaver(
  drafts: DraftsClient,
  options: { skipEmptySave?: () => boolean } = {},
): NewWorkspaceDraftSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { text: string; contextItems: ContextItem[] } | null = null;

  function save(): void {
    if (!pending) return;
    const { text, contextItems } = pending;
    pending = null;
    if (options.skipEmptySave?.() && !text && contextItems.length === 0) return;
    persistNewWorkspaceDraft(drafts, buildNewWorkspaceDraftPayload(text, contextItems));
  }

  return {
    schedule(text, contextItems) {
      pending = { text, contextItems };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        save();
      }, NEW_WORKSPACE_DRAFT_DEBOUNCE_MS);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      save();
    },
  };
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
