import type { SpecialistFileScope } from '$shared/specialist-file-types';

export interface FileSpecialistWritePayload {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model?: string;
  roleReminder?: string;
  behaviorPrompt: string;
  scope?: SpecialistFileScope;
  workspacePath?: string;
}

export type SpecialistReverseAction =
  | { kind: 'delete'; id: string; scope: SpecialistFileScope; workspacePath?: string }
  | { kind: 'save'; specialist: FileSpecialistWritePayload };

export interface SpecialistProposalHistoryEntry {
  appliedAt: number;
  reverse: SpecialistReverseAction;
}

export interface SpecialistProposalHistoryState {
  entries: Record<string, SpecialistProposalHistoryEntry>;
}
