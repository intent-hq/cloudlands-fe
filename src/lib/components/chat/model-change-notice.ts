/**
 * Daemon-persisted model-change transcript notice (PROTOCOL.md §5.5,
 * `agent.setModel`). When a turn starts under a different model/provider
 * identity than the last committed turn, intentd persists an informational
 * `role: "system"` row with metadata
 * `{ type: "model_changed", from: string | null, to: string | null,
 *    fromProvider: string, toProvider: string }` —
 * `from`/`to` are spawn-resolved raw model ids (no provider prefix) and
 * `null` means "provider default model". The row is transcript-only (never
 * replayed to providers); the FE renders it as a centered inline notice.
 */
import { selectModelDisplayName } from '$store/renderer/slices/model/model-selectors';
import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

interface MessageLike {
  role?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ModelChangeNoticeInfo {
  /** Spawn-resolved model id; null = provider default model. */
  from: string | null;
  to: string | null;
  fromProvider?: string;
  toProvider?: string;
}

/**
 * Returns the model-change info when the message is a daemon-persisted
 * model-change notice row, or null for every other message. Discriminates
 * purely on `metadata.type === "model_changed"` so the FE stays tolerant of
 * the exact role the daemon persists (non-user/non-assistant by contract).
 */
export function getModelChangeNotice(
  message: MessageLike | null | undefined,
): ModelChangeNoticeInfo | null {
  const metadata = message?.metadata;
  if (!metadata || metadata['type'] !== 'model_changed') return null;
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    from: asString(metadata['from']) ?? null,
    to: asString(metadata['to']) ?? null,
    fromProvider: asString(metadata['fromProvider']),
    toProvider: asString(metadata['toProvider']),
  };
}

function describeSide(providerId: string | undefined, model: string | null): string {
  const providerName = providerId
    ? selectProviderDisplayName.select(appStore.state, providerId)
    : undefined;
  if (providerId && providerName && model) {
    // Pretty name from the model catalog by (provider, model id); a lookup
    // miss (catalog not loaded / unknown model) falls back to the raw id.
    const prettyName = selectModelDisplayName.select(appStore.state, providerId, model) ?? model;
    return m.chat_modelChangeNotice_model_label({
      name: prettyName,
      providerId,
      modelId: model,
    });
  }
  if (providerId && providerName) {
    return m.chat_modelChangeNotice_defaultModel_label({ provider: providerName, providerId });
  }
  return model ?? '';
}

/**
 * Format the notice's display label ("Switched from <pretty name>
 * (<providerId> / <modelId>) to <pretty name> (<providerId> / <modelId>)"),
 * or return `fallbackText` when either side of the switch cannot be
 * described from the metadata.
 */
export function formatModelChangeLabel(
  notice: ModelChangeNoticeInfo,
  fallbackText: string,
): string {
  const fromLabel = describeSide(notice.fromProvider, notice.from);
  const toLabel = describeSide(notice.toProvider, notice.to);
  return fromLabel && toLabel
    ? m.chat_modelChangeNotice_switched_label({ from: fromLabel, to: toLabel })
    : fallbackText;
}
