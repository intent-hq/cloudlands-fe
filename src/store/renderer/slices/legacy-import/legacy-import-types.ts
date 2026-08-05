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