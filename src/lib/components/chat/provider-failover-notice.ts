/**
 * Daemon-persisted quota failover transcript notice (§5.54 named profiles,
 * backup failover). When a turn fails with a quota error and a backup
 * profile of the same base provider exists, intentd moves the agent onto the
 * first untried backup and persists ONE informational `role: "system"` row
 * per switch with metadata
 * `{ type: "provider_failover", fromProvider: string, toProvider: string,
 *    model: string | null, reason: "quota-exceeded" }`.
 * When the quota on the conversation's home provider has reset, the daemon
 * moves it back and persists one
 * `{ type: "provider_returned", fromProvider, toProvider, model,
 *    reason: "quota-reset" }` row (`toProvider` = home).
 * Both rows are transcript-only (never replayed to providers); the FE renders
 * them as centered inline notices naming configurations by label, in turn
 * order (between the attempt they interrupt and the output that follows).
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
  /** `failover` (quota exceeded → backup) when omitted; `returned` (quota reset → home). */
  kind?: 'failover' | 'returned';
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
  return parseSwitchRow(message, 'provider_failover', 'failover');
}

/** The returned-home info for a daemon-persisted `provider_returned` row, else null. */
export function getProviderReturnedNotice(
  message: MessageLike | null | undefined,
): ProviderFailoverNoticeInfo | null {
  return parseSwitchRow(message, 'provider_returned', 'returned');
}

/** Either automatic provider switch row (failover or return home), else null. */
export function getProviderSwitchNotice(
  message: MessageLike | null | undefined,
): ProviderFailoverNoticeInfo | null {
  return getProviderFailoverNotice(message) ?? getProviderReturnedNotice(message);
}

function parseSwitchRow(
  message: MessageLike | null | undefined,
  type: string,
  kind: 'failover' | 'returned',
): ProviderFailoverNoticeInfo | null {
  const metadata = message?.metadata;
  if (!metadata || metadata['type'] !== type) return null;
  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    kind,
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
 * Format the notice's display label — failover: "<From> ran out of quota —
 * continuing on <To> (backup)"; return home: "<Home> quota reset — back on
 * <Home>" — or return `fallbackText` (the daemon's own text) when the reason
 * does not match the row kind or a needed side is missing.
 */
export function formatProviderFailoverLabel(
  notice: ProviderFailoverNoticeInfo,
  fallbackText: string,
  workspaceId?: string,
): string {
  if (notice.kind === 'returned') {
    if (notice.reason !== 'quota-reset' || !notice.toProvider) return fallbackText;
    return m.chat_providerFailoverNotice_returned_label({
      to: describeRef(notice.toProvider, workspaceId),
    });
  }
  if (notice.reason !== 'quota-exceeded' || !notice.fromProvider || !notice.toProvider) {
    return fallbackText;
  }
  return m.chat_providerFailoverNotice_quota_label({
    from: describeRef(notice.fromProvider, workspaceId),
    to: describeRef(notice.toProvider, workspaceId),
  });
}
