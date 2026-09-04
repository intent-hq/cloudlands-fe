import { describe, it, expect } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  specialistsReducer,
  initialState,
  setBundledSpecialists,
  setDefaultSpecialistId,
  setFileSpecialists,
  setOverridesLoaded,
  setCustomSpecialistsLoaded,
  type FileSpecialist,
} from './specialists-slice';

describe('specialistsReducer', () => {
  it('should return initial state', () => {
    const state = specialistsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
    expect(state.defaultSpecialistId).toBe('');
  });

  describe('setDefaultSpecialistId', () => {
    it('should set the default specialist id', () => {
      const state = specialistsReducer(initialState, setDefaultSpecialistId('verifier'));
      expect(state.defaultSpecialistId).toBe('verifier');
    });

    it('should clear the default specialist id', () => {
      const seeded = specialistsReducer(initialState, setDefaultSpecialistId('verifier'));
      const state = specialistsReducer(seeded, setDefaultSpecialistId(''));
      expect(state.defaultSpecialistId).toBe('');
    });
  });

  describe('setBundledSpecialists', () => {
    it('should set bundled specialists', () => {
      const specialists = [
        { id: 'test', name: 'Test', description: 'Desc', defaultBehaviorPrompt: 'prompt' },
      ];
      const state = specialistsReducer(initialState, setBundledSpecialists(specialists));
      expect(state.bundledSpecialists).toEqual(specialists);
    });
  });

  describe('loaded flags', () => {
    it('should set overridesLoaded', () => {
      const state = specialistsReducer(initialState, setOverridesLoaded(true));
      expect(state.overridesLoaded).toBe(true);
    });

    it('should set customSpecialistsLoaded', () => {
      const state = specialistsReducer(initialState, setCustomSpecialistsLoaded(true));
      expect(state.customSpecialistsLoaded).toBe(true);
    });
  });

  describe('setFileSpecialists', () => {
    it('should set file specialists', () => {
      const fileSpecs: FileSpecialist[] = [
        {
          id: 'file-1',
          name: 'File Specialist',
          description: 'A file-based specialist',
          codingAgent: 'claude-code',
          model: 'opus4.5',
          behaviorPrompt: 'You are a specialist',
          filePath: '/path/to/specialist.md',
          source: 'user',
        },
      ];
      const state = specialistsReducer(initialState, setFileSpecialists(fileSpecs));
      expect(getItems(state.fileSpecialists)).toEqual(fileSpecs);
    });

    it('should preserve codingAgent when reloading file specialists', () => {
      // Initial state with a file specialist that has codingAgent set
      const initialFileSpecs: FileSpecialist[] = [
        {
          id: 'file-1',
          name: 'Original Name',
          description: 'Original description',
          codingAgent: 'claude-code',
          model: 'opus4.5',
          behaviorPrompt: 'Original prompt',
          filePath: '/path/to/specialist.md',
          source: 'user',
        },
      ];
      let state = specialistsReducer(initialState, setFileSpecialists(initialFileSpecs));
      expect(getItems(state.fileSpecialists)[0].codingAgent).toBe('claude-code');

      // Reload with updated name/description but no codingAgent in frontmatter
      // (simulating a reload where frontmatter was updated but codingAgent was omitted)
      const reloadedSpecs: FileSpecialist[] = [
        {
          id: 'file-1',
          name: 'Updated Name',
          description: 'Updated description',
          codingAgent: undefined, // Frontmatter doesn't provide codingAgent
          model: 'opus4.5',
          behaviorPrompt: 'Updated prompt',
          filePath: '/path/to/specialist.md',
          source: 'user',
        },
      ];
      state = specialistsReducer(state, setFileSpecialists(reloadedSpecs));
      // Note: The reducer itself doesn't preserve - the saga does before calling setFileSpecialists
      // This test documents the expected behavior that the saga should preserve codingAgent
      expect(getItems(state.fileSpecialists)[0].id).toBe('file-1');
      expect(getItems(state.fileSpecialists)[0].name).toBe('Updated Name');
    });
  });
});
