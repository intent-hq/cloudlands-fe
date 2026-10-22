/** Transient, per-Settings-context draft. Never persisted across app reloads. */
export interface SpecialistDraft {
  name: string;
  description: string;
  behaviorPrompt?: string;
  codingAgent?: string;
  /** Picker value; converted to a bare model id at the write boundary. */
  model?: string;
  reasoningEffort?: string;
}

export interface SpecialistCreation {
  draft: SpecialistDraft;
  status: 'editing' | 'saving' | 'refreshing' | 'save-failed' | 'refresh-failed';
  specialistId?: string;
  error?: string;
}

export const emptySpecialistCreation: SpecialistCreation = {
  draft: { name: '', description: '' },
  status: 'editing',
};
