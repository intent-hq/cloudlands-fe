import { describe, expect, it } from 'vitest';
import {
  initialState,
  legacyImportFailed,
  legacyImportReducer,
  legacyImportRequested,
  legacyImportSucceeded,
} from './legacy-import-slice';
import type { LegacyImportReport } from './legacy-import-types';

const report: LegacyImportReport = {
  imported: 2,
  updated: 1,
  skipped: 3,
  notes: 4,
  comments: 5,
  agents: 6,
  assets: 7,
  skipSummary: [],
  compatibilityFailures: false,
  markerWritten: true,
};

describe('legacyImportReducer', () => {
  it('returns the initial state', () => {
    expect(legacyImportReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('starts loading and clears previous output when requested', () => {
    const previous = { loading: false, report, error: 'stale' };

    expect(legacyImportReducer(previous, legacyImportRequested(true))).toEqual({
      loading: true,
      report: null,
      error: null,
    });
  });

  it('stores a successful report', () => {
    expect(legacyImportReducer(initialState, legacyImportSucceeded(report))).toEqual({
      loading: false,
      report,
      error: null,
    });
  });

  it('stores a failure and clears the report', () => {
    expect(
      legacyImportReducer(
        { loading: true, report, error: null },
        legacyImportFailed('Local connection required'),
      ),
    ).toEqual({
      loading: false,
      report: null,
      error: 'Local connection required',
    });
  });
});