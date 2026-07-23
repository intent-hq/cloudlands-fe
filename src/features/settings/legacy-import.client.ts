import { backendRequest } from '$lib/client/live/backend-transport';

export interface LegacyImportReport {
  imported: number;
  updated: number;
  skipped: number;
  notes: number;
  comments: number;
  agents: number;
  assets: number;
  skipSummary: Array<{ id: string; reason: string }>;
  compatibilityFailures: boolean;
  markerWritten: boolean;
}

export function importLegacyWorkspaces(force = false): Promise<LegacyImportReport> {
  return backendRequest<LegacyImportReport>('system.importLegacy', { force });
}
