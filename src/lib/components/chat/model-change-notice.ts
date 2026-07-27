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
import { getProviderConfig } from '$shared/config/provider-config';

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
  const providerName = providerId ? getProviderConfig(providerId).displayName : undefined;
  if (providerName && model) return `${providerName} / ${model}`;
  if (providerName) return `${providerName} default model`;
  return model ?? '';
}

/**
 * Format the notice's display label ("Switched from <provider>/<model> to
 * <provider>/<model>"), or return `fallbackText` when either side of the
 * switch cannot be described from the metadata.
 */
export function formatModelChangeLabel(
  notice: ModelChangeNoticeInfo,
  fallbackText: string,
): string {
  const fromLabel = describeSide(notice.fromProvider, notice.from);
  const toLabel = describeSide(notice.toProvider, notice.to);
  return fromLabel && toLabel ? `Switched from ${fromLabel} to ${toLabel}` : fallbackText;
}
