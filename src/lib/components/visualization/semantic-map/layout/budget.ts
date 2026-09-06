import type { Manifest, Route } from '../core/types';

export interface LayoutFocus {
  regionIds?: string[];
  route?: Route;
}

export const FOCUS_BUDGET_SHARE = 0.7;
export const LABELED_PEBBLE_BUDGET = 0.02;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function normalize(ids: string[], weights: number[]): Record<string, number> {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(ids.map((id, index) => [id, weights[index] / total]));
}

function restBudget(manifest: Manifest): Record<string, number> {
  const ids = manifest.regions.map((region) => region.id);
  if (ids.length === 0) return {};

  const raw = manifest.regions.map((region) => Math.sqrt(Math.max(1, region.paths.length)));
  const center = median(raw);
  const weights = raw.map((weight) => Math.max(center * 0.4, Math.min(center * 2.5, weight)));
  return normalize(ids, weights);
}

function focusedRegionIds(manifest: Manifest, focus: LayoutFocus): Set<string> {
  const known = new Set(manifest.regions.map((region) => region.id));
  const requested = new Set([
    ...(focus.regionIds ?? []),
    ...(focus.route?.visits ?? []),
    ...(focus.route?.transitions.flatMap(({ from, to }) => [from, to]) ?? []),
  ]);
  return new Set([...requested].filter((id) => known.has(id)));
}

export function computeBudget(manifest: Manifest, focus: LayoutFocus = {}): Record<string, number> {
  const rest = restBudget(manifest);
  const focused = focusedRegionIds(manifest, focus);
  const background = manifest.regions.filter((region) => !focused.has(region.id));
  if (focused.size === 0 || background.length === 0) return rest;

  const focusedRest = [...focused].reduce((sum, id) => sum + rest[id], 0);
  const backgroundRest = background.reduce((sum, region) => sum + rest[region.id], 0);
  const minimum = Math.min(LABELED_PEBBLE_BUDGET, (1 - FOCUS_BUDGET_SHARE) / background.length);
  const remaining = 1 - FOCUS_BUDGET_SHARE - minimum * background.length;

  return Object.fromEntries(
    manifest.regions.map((region) => {
      if (focused.has(region.id)) {
        return [region.id, (rest[region.id] / focusedRest) * FOCUS_BUDGET_SHARE];
      }
      return [region.id, minimum + (rest[region.id] / backgroundRest) * remaining];
    }),
  );
}
