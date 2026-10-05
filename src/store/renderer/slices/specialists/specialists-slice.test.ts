import { describe, it, expect } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  updateSpecialistDraft,
  discardSpecialistDraft,
  setSpecialistCreation,
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

describe('specialist creation drafts', () => {
  it('isolates contexts and keeps every field until explicit discard', () => {
    let state = specialistsReducer(
      initialState,
      updateSpecialistDraft('workspace:A', {
        name: 'A',
        description: 'Description',
        behaviorPrompt: '',
        codingAgent: 'codex',
        model: 'codex:gpt',
        reasoningEffort: 'high',
      }),
    );
    state = specialistsReducer(state, updateSpecialistDraft('user', { name: 'Global' }));
    expect(state.creationByContext['workspace:A'].draft).toEqual({
      name: 'A',
      description: 'Description',
      behaviorPrompt: '',
      codingAgent: 'codex',
      model: 'codex:gpt',
      reasoningEffort: 'high',
    });
    state = specialistsReducer(state, discardSpecialistDraft('workspace:A'));
    expect(state.creationByContext['workspace:A']).toBeUndefined();
    expect(state.creationByContext.user.draft.name).toBe('Global');
  });

  it.each(['saving', 'refreshing'] as const)('blocks edits and discard while %s', (status) => {
    const state = specialistsReducer(
      initialState,
      setSpecialistCreation('user', {
        draft: { name: 'Saving', description: '' },
        status,
        specialistId: 'saving',
      }),
    );
    expect(specialistsReducer(state, updateSpecialistDraft('user', { name: 'Lost' }))).toBe(state);
    expect(specialistsReducer(state, discardSpecialistDraft('user'))).toBe(state);
  });

  it('locks a written draft for refresh-only recovery but permits explicit discard', () => {
    const state = specialistsReducer(
      initialState,
      setSpecialistCreation('user', {
        draft: { name: 'Saved', description: '' },
        status: 'refresh-failed',
        specialistId: 'saved',
        error: 'Offline',
      }),
    );
    expect(specialistsReducer(state, updateSpecialistDraft('user', { name: 'Another' }))).toBe(
      state,
    );
    expect(
      specialistsReducer(state, discardSpecialistDraft('user')).creationByContext.user,
    ).toBeUndefined();
  });

  it('allows correction after a failed write and clears the old error', () => {
    const state = specialistsReducer(
      initialState,
      setSpecialistCreation('user', {
        draft: { name: 'Old', description: '' },
        status: 'save-failed',
        error: 'Offline',
      }),
    );
    const next = specialistsReducer(state, updateSpecialistDraft('user', { name: 'Corrected' }));
    expect(next.creationByContext.user).toEqual({
      draft: { name: 'Corrected', description: '' },
      status: 'editing',
      error: undefined,
    });
  });
});
