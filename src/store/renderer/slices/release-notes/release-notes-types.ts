/**
 * Release Notes — Type definitions
 * Safe to import from any process (renderer, main, shared, preload).
 */

export type ReleaseNotes = {
  version: string;
  date: string;
  highlights: string[];
};

export type ReleaseNotesState = {
  releaseNotes: ReleaseNotes | null;
  showModal: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
};

