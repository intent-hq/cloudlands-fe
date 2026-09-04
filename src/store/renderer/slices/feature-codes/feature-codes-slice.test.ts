import { describe, it, expect } from 'vitest';
import {
  featureCodesReducer,
  initialState,
  setActiveFeatures,
  toggleFeatureCodeDialog,
} from './feature-codes-slice';
import {
  selectActiveFeatures,
  selectFeatureCodeDialogOpen,
  selectHasActiveFeatures,
  selectIsFeatureEnabled,
} from './feature-codes-selectors';

describe('featureCodesReducer', () => {
  it('should return initial state', () => {
    const state = featureCodesReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('setActiveFeatures', () => {
    it('stores the features and marks the store initialized', () => {
      const state = featureCodesReducer(initialState, setActiveFeatures(['feature-a']));
      expect(state.activeFeatures).toEqual(['feature-a']);
      expect(state.initialized).toBe(true);
    });
  });

  describe('toggleFeatureCodeDialog', () => {
    it('should open the dialog when closed', () => {
      const state = featureCodesReducer(initialState, toggleFeatureCodeDialog());
      expect(state.dialogOpen).toBe(true);
    });

    it('should close the dialog when open', () => {
      const state = featureCodesReducer(
        { ...initialState, dialogOpen: true },
        toggleFeatureCodeDialog(),
      );
      expect(state.dialogOpen).toBe(false);
    });
  });

  describe('selectors', () => {
    const state = {
      featureCodes: {
        activeFeatures: ['feature-a', 'feature-b'],
        dialogOpen: true,
        initialized: true,
      },
    } as any;

    it('selects active feature data', () => {
      expect(selectActiveFeatures.select(state)).toEqual(['feature-a', 'feature-b']);
      expect(selectHasActiveFeatures.select(state)).toBe(true);
      expect(selectIsFeatureEnabled.select(state, 'feature-a')).toBe(true);
      expect(selectIsFeatureEnabled.select(state, 'feature-c')).toBe(false);
    });

    it('selects the feature dialog state', () => {
      expect(selectFeatureCodeDialogOpen.select(state)).toBe(true);
    });
  });
});
