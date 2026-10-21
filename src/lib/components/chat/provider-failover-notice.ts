/**
 * Daemon-persisted quota failover transcript notice (§5.54 named profiles,
 * backup failover). When a turn fails with a quota error and a backup
 * profile of the same base provider exists, intentd moves the agent onto the
 * first untried backup and persists ONE informational `role: "system"` row
 * per switch with metadata
 * `{ type: "provider_failover", fromProvider: string, toProvider: string,
 *    model: string | null, reason: "quota-exceeded" }`.
 * The row is transcript-only (never replayed to providers); the FE renders
 * it as a centered inline notice naming both configurations by label.
 */
import {
  selectProviderCatalogLoaded,
  selectProviderCatalogProfiles,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { providerRefBaseId, providerRefLabelParts } from '$shared/provider-profiles';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

interface MessageLike {
  role?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderFailoverNoticeInfo {
  /** Reference (bare provider id or `<base>@<profile>`) that hit its quota. */
  fromProvider?: string;
  /** Backup reference now running the turn. */
  toProvider?: string;
  /** Unchanged model id; null = provider default model. */
  model: string | null;
  reason?: string;
}

/**
 * Returns the failover info when the message is a daemon-persisted
 * `provider_failover` row, or null for every other message. Discriminates
 * purely on `metadata.type` so the FE stays tolerant of the persisted role.
 */
export function getProviderFailoverNotice(
  message: MessageLike | null | undefined,
): ProviderFailoverNoticeInfo | null {
  const metadata = message?.metadata;
  if (!metadata || metadata['type'] !== 'provider_failover') return null;
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    fromProvider: asString(metadata['fromProvider']),
    toProvider: asString(metadata['toProvider']),
    model: asString(metadata['model']) ?? null,
    reason: asString(metadata['reason']),
  };
}

/**
 * Short label for one side: a profile's own name, `<Provider> · Default` for
 * the bare configuration, and `Removed profile` for a reference whose
 * profile is gone — said only once the (workspace) catalog has loaded;
 * before that the base provider name stands in.
 */
function describeRef(providerRef: string, workspaceId?: string): string {
  const state = appStore.state;
  const baseId = providerRefBaseId(providerRef);
  const loaded = workspaceId
    ? state.providerCatalog?.byWorkspaceId?.[workspaceId] !== undefined
    : selectProviderCatalogLoaded.select(state);
  const baseName =
    selectProviderDisplayName.select(state, baseId, loaded ? workspaceId : undefined) || baseId;
  const parts = providerRefLabelParts(
    providerRef,
    selectProviderCatalogProfiles.select(state, workspaceId),
    baseId,
  );
  switch (parts.kind) {
    case 'profile':
      return parts.name;
    case 'missing':
      return loaded ? m.chat_modelPicker_missingProfile_name() : baseName;
    default:
      return m.chat_modelPicker_profileGroup_label({
        provider: baseName,
        profile: m.chat_modelPicker_defaultProfile_name(),
      });
  }
}

/**
 * Format the notice's display label ("<From> ran out of quota — continuing
 * on <To> (backup)"), or return `fallbackText` (the daemon's own text) when
 * the reason is not a quota failure or either side is missing.
 */
export function formatProviderFailoverLabel(
  notice: ProviderFailoverNoticeInfo,
  fallbackText: string,
  workspaceId?: string,
): string {
  if (notice.reason !== 'quota-exceeded' || !notice.fromProvider || !notice.toProvider) {
    return fallbackText;
  }
  return m.chat_providerFailoverNotice_quota_label({
    from: describeRef(notice.fromProvider, workspaceId),
    to: describeRef(notice.toProvider, workspaceId),
  });
}
