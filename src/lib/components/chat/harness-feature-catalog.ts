/**
 * Harness feature catalog for the read-only "Harness vX.Y" modal
 * (PROTOCOL §5.5 `harnessFeatures`; monorepo#2459).
 *
 * Known feature keys reuse the settings page's existing labels and
 * descriptions (`settings_agentFeatures_*`) so the modal and the settings
 * feature list stay in lockstep. The rendered rows are the union of this
 * catalog and the session's `harnessFeatures` snapshot: the snapshot value
 * wins, catalog keys absent from the snapshot render OFF (an old harness
 * never had the newer features), and snapshot keys unknown to the catalog
 * render with a humanized key and no description.
 */
import { m } from '$shared/paraglide/messages.js';

export const HARNESS_FEATURE_CATALOG: ReadonlyArray<{
  key: string;
  label: () => string;
  description: () => string;
}> = [
  {
    key: 'attentionRequests',
    label: () => m.settings_agentFeatures_attentionRequests_label(),
    description: () => m.settings_agentFeatures_attentionRequests_description(),
  },
  {
    key: 'backgroundHooks',
    label: () => m.settings_agentFeatures_backgroundHooks_label(),
    description: () => m.settings_agentFeatures_backgroundHooks_description(),
  },
  {
    key: 'browserAutomation',
    label: () => m.settings_agentFeatures_browserAutomation_label(),
    description: () => m.settings_agentFeatures_browserAutomation_description(),
  },
  {
    key: 'hostExec',
    label: () => m.settings_agentFeatures_hostExec_label(),
    description: () => m.settings_agentFeatures_hostExec_description(),
  },
  {
    key: 'prMonitor',
    label: () => m.settings_agentFeatures_prMonitor_label(),
    description: () => m.settings_agentFeatures_prMonitor_description(),
  },
  {
    key: 'richChatBlocks',
    label: () => m.settings_agentFeatures_richChatBlocks_label(),
    description: () => m.settings_agentFeatures_richChatBlocks_description(),
  },
  {
    key: 'scripts',
    label: () => m.settings_agentFeatures_scripts_label(),
    description: () => m.settings_agentFeatures_scripts_description(),
  },
  {
    key: 'stateSnapshot',
    label: () => m.settings_agentFeatures_stateSnapshot_label(),
    description: () => m.settings_agentFeatures_stateSnapshot_description(),
  },
  {
    key: 'structuredQuestions',
    label: () => m.settings_agentFeatures_structuredQuestions_label(),
    description: () => m.settings_agentFeatures_structuredQuestions_description(),
  },
  {
    key: 'taskGraph',
    label: () => m.settings_agentFeatures_taskGraph_label(),
    description: () => m.settings_agentFeatures_taskGraph_description(),
  },
  {
    key: 'terminalAccess',
    label: () => m.settings_agentFeatures_terminalAccess_label(),
    description: () => m.settings_agentFeatures_terminalAccess_description(),
  },
];

export interface HarnessFeatureRow {
  key: string;
  label: string;
  /** Null for snapshot-only keys unknown to the catalog. */
  description: string | null;
  enabled: boolean;
  /** Whether the key is in the catalog (has a curated label + description). */
  known: boolean;
}

/**
 * Fallback display label for a snapshot key with no catalog entry:
 * "agentActions" → "Agent actions". The key is a daemon-provided wire
 * identifier, so this stays a mechanical transform, not a translation.
 */
export function humanizeHarnessFeatureKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Union of catalog + snapshot, sorted by display label. Snapshot value wins. */
export function buildHarnessFeatureRows(
  snapshot: Record<string, boolean> | null | undefined,
): HarnessFeatureRow[] {
  const snap = snapshot ?? {};
  const rows: HarnessFeatureRow[] = HARNESS_FEATURE_CATALOG.map((feature) => ({
    key: feature.key,
    label: feature.label(),
    description: feature.description(),
    enabled: snap[feature.key] === true,
    known: true,
  }));
  const knownKeys = new Set(HARNESS_FEATURE_CATALOG.map((feature) => feature.key));
  for (const [key, enabled] of Object.entries(snap)) {
    if (!knownKeys.has(key)) {
      rows.push({
        key,
        label: humanizeHarnessFeatureKey(key),
        description: null,
        enabled: enabled === true,
        known: false,
      });
    }
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}
