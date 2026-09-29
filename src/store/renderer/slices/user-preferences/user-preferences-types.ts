import type { UserPreferencesState } from './user-preferences-slice';

/** Draft, opening baseline and last acknowledged value have distinct lifetimes. */
export type AgentRulesEditorState = {
  active: boolean;
  generation: number;
  content: string;
  originalContent: string;
  persistedContent: string;
  loading: boolean;
  errorMessage: string | null;
  saveStatus: 'idle' | 'saving' | 'saved';
};

/** Editor state is renderer-only, not part of the persisted preferences contract. */
export type UserPreferencesStoreState = UserPreferencesState & {
  agentRulesEditor: AgentRulesEditorState;
};
