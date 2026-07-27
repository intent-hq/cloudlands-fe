/**
 * Daemon-persisted model-change transcript notice (see the monorepo's
 * docs/PROTOCOL.md and the intentd "model-change transcript notice" work).
 * When a turn commits under a different model/provider than the previous
 * turn, intentd appends an informational non-user/non-assistant row with
 * metadata `{ type: "model_changed", from, to, fromProvider, toProvider }`.
 * The row is never sent to the provider; the FE renders it as a centered
 * inline notice in the transcript.
 */
import { getProviderConfig } from '$shared/config/provider-config';

interface MessageLike {
  role?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ModelChangeNoticeInfo {
  from?: string;
  to?: string;
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
    from: asString(metadata['from']),
    to: asString(metadata['to']),
    fromProvider: asString(metadata['fromProvider']),
    toProvider: asString(metadata['toProvider']),
  };
}

function describeSide(providerId: string | undefined, model: string | undefined): string {
  const providerName = providerId ? getProviderConfig(providerId).displayName : undefined;
  if (providerName && model) return `${providerName} / ${model}`;
  return providerName ?? model ?? '';
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
