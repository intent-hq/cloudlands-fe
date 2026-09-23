/**
 * Daemon-persisted provider re-home transcript notice (§5.5, disabled
 * providers — intent-hq/intent#5737). When a turn starts on a provider that
 * is disabled in Settings > Agents and a usable default provider exists,
 * intentd moves the agent onto it and persists ONE informational
 * `role: "system"` row with metadata
 * `{ type: "provider_rehomed", reason: "provider_disabled",
 *    from: string | null, to: string | null, fromProvider: string,
 *    toProvider: string }` —
 * `from`/`to` are bare model ids and `null` means "provider default model".
 * The row is transcript-only (never replayed to providers); the FE renders
 * it as a centered inline notice naming the old model + provider, the reason,
 * and the new provider.
 */
import { selectModelDisplayName } from '$store/renderer/slices/model/model-selectors';
import { selectProviderDisplayName } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

interface MessageLike {
  role?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderRehomedNoticeInfo {
  reason?: string;
  /** Bare model id; null = provider default model. */
  from: string | null;
  to: string | null;
  fromProvider?: string;
  toProvider?: string;
}

/**
 * Returns the re-home info when the message is a daemon-persisted
 * provider re-home notice row, or null for every other message.
 * Discriminates purely on `metadata.type === "provider_rehomed"`.
 */
export function getProviderRehomedNotice(
  message: MessageLike | null | undefined,
): ProviderRehomedNoticeInfo | null {
  const metadata = message?.metadata;
  if (!metadata || metadata['type'] !== 'provider_rehomed') return null;
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    reason: asString(metadata['reason']),
    from: asString(metadata['from']) ?? null,
    to: asString(metadata['to']) ?? null,
    fromProvider: asString(metadata['fromProvider']),
    toProvider: asString(metadata['toProvider']),
  };
}

/**
 * Format the notice's display label ("<model> (<Old Provider>) is no longer
 * available — <Old Provider> was disabled in Settings > Agents; this agent
 * now runs on <New Provider>."), or return `fallbackText` (the daemon's own
 * text) when the reason is not the disabled-provider one or either provider
 * cannot be described from the metadata.
 */
export function formatProviderRehomedLabel(
  notice: ProviderRehomedNoticeInfo,
  fallbackText: string,
): string {
  if (notice.reason !== 'provider_disabled' || !notice.fromProvider || !notice.toProvider) {
    return fallbackText;
  }
  const fromProvider = selectProviderDisplayName.select(appStore.state, notice.fromProvider);
  const toProvider = selectProviderDisplayName.select(appStore.state, notice.toProvider);
  if (!fromProvider || !toProvider) return fallbackText;
  const model = notice.from
    ? (selectModelDisplayName.select(appStore.state, notice.fromProvider, notice.from) ??
      notice.from)
    : m.chat_providerRehomedNotice_defaultModel_label();
  return m.chat_providerRehomedNotice_disabled_label({ model, fromProvider, toProvider });
}
