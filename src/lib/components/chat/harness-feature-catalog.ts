/**
 * Harness feature catalog for the read-only "Harness vX.Y" modal
 * (PROTOCOL §5.5 `harnessFeatures`; monorepo#2459).
 *
 * Known feature keys derive from the settings page's shared
 * agent-feature definitions (labels + descriptions in curated settings
 * order), so the modal and the settings feature list stay in lockstep —
 * a toggle added to the shared module shows up here automatically. The
 * rendered rows are the union of this catalog and the session's
 * `harnessFeatures` snapshot: the snapshot value wins, catalog keys
 * absent from the snapshot render OFF (an old harness never had the
 * newer features), and snapshot keys unknown to the catalog render with
 * a humanized key and no description.
 */
import { FEATURES } from '$lib/components/settings/agent-feature-definitions';

/**
 * Snapshot keys are the `agentFeatures.*` settings-path basenames, in the
 * settings page's curated order.
 */
export const HARNESS_FEATURE_CATALOG: ReadonlyArray<{
  key: string;
  label: () => string;
  description: () => string;
}> = FEATURES.map((feature) => ({
  key: feature.path.replace(/^agentFeatures\./, ''),
  label: feature.label,
  description: feature.description,
}));

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

/**
 * Union of catalog + snapshot. Snapshot value wins. Catalog rows keep the
 * settings page's curated order (lockstep presentation across surfaces);
 * snapshot-only keys unknown to the catalog are appended at the end,
 * sorted by label.
 */
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
  const unknownRows: HarnessFeatureRow[] = [];
  for (const [key, enabled] of Object.entries(snap)) {
    if (!knownKeys.has(key)) {
      unknownRows.push({
        key,
        label: humanizeHarnessFeatureKey(key),
        description: null,
        enabled: enabled === true,
        known: false,
      });
    }
  }
  unknownRows.sort((a, b) => a.label.localeCompare(b.label));
  return rows.concat(unknownRows);
}
