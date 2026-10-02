import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export interface QuestionWizardDraftAnswer {
  sel: number[];
  text: string;
  skipped: boolean;
}

export interface QuestionWizardDraft {
  idx: number;
  answers: QuestionWizardDraftAnswer[];
}

export interface QuestionUiConsumer {
  id: string;
  requestId: string;
  storageKey: string | null;
  status: 'loading' | 'ready';
  draft: QuestionWizardDraft;
  collapsed: boolean;
  draftRevision: number;
  collapsedRevision: number;
  draftDirty: boolean;
  collapsedDirty: boolean;
  resolved: boolean;
}

export interface QuestionUiState {
  consumers: Collection<QuestionUiConsumer, 'id'>;
}
