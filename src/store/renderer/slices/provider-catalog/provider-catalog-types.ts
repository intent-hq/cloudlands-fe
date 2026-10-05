/**
 * Provider Catalog Types
 *
 * Renderer-side view of the daemon's static provider registry
 * (`providers.catalog`, PROTOCOL §5.38). The daemon owns the registry —
 * including the env-var / feature-code `visible` verdict — and the data is
 * compiled into the daemon binary; this state only mirrors the wire rows.
 *
 * Rows are stored as a `Collection` (id-keyed map + ordered id list in the
 * daemon's registry order — informational per §5.38, consumers must key rows
 * by `id`, never by array position).
 */
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { ProviderCatalogEntry } from '$shared/provider-catalog';

export type { ProviderCatalogEntry } from '$shared/provider-catalog';

export interface ProviderCatalogState {
  byWorkspaceId?: Record<string, WorkspaceCatalogSnapshot>;
  workspaceEpoch?: number;
  /** Accepted snapshot generation; cached display can outlive its freshness. */
  workspaceSnapshotEpochs?: Record<string, number>;
  /** Event identity only; retained during refresh, cleared on connection/lifetime changes. */
  mcpServerNamesByWorkspaceId?: Record<string, Record<string, string>>;
  /** Wire rows, id-keyed with `ids` preserving the registry order. */
  providers: Collection<ProviderCatalogEntry, 'id'>;
  /** Flips true once the first `providers.catalog` hydration lands. */
  loaded: boolean;
}

export interface WorkspaceCatalogSnapshot {
  importDiagnostics?: import('$lib/client/app-client').SpecialistImportDiagnostic[];
  mcpServers?: import('../mcp-settings/mcp-settings-types').McpServerConfig[];
  mcpStatuses?: import('../mcp-settings/mcp-settings-types').McpServerRuntimeStatus[];
  readiness: Record<string, import('$shared/types/provider-availability').ProviderStatus>;
  catalog: import('$shared/provider-catalog').ProviderCatalogResult;
  settings: import('$lib/client/app-client').SettingDefinitionWithValue[];
  specialists: import('$lib/client/app-client').SpecialistDef[];
}
