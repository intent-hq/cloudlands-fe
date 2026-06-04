import type { AppSettingApplyPlan, AppSettingChange } from '../app-settings-schema';
import type { SpecialistFileScope } from '../specialist-file-types';

export const PROPOSAL_KINDS = [
  'workspace-create',
  'settings-change',
  'specialist-edit',
  'bulk-op',
] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export interface ProposalEditableField {
  key: string;
  label: string;
  value?: unknown;
  before?: unknown;
  after?: unknown;
  editable?: boolean;
  multiline?: boolean;
}

export interface ProposalDiffPreview {
  fileName?: string;
  language?: string;
  oldContent?: string;
  newContent?: string;
  patch?: string;
}

export interface BulkProposalItem {
  id: string;
  title: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  selected?: boolean;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
}

export type WorkspaceCreateRepoType = 'local' | 'github' | 'remote';

export interface WorkspaceCreateProposalFields {
  initialPrompt?: string;
  repoPath?: string;
  repoType?: WorkspaceCreateRepoType;
  githubUrl?: string;
  prNumber?: number;
  clonePath?: string;
  branch?: string;
  isNewRepo?: boolean;
  isValidPath?: boolean;
  scope?: string;
  specialist?: string | null;
}

export interface ProposalPreview {
  title: string;
  summary?: string;
  /** Verb-first action label for non-workspace-create proposal apply buttons. */
  applyLabel?: string;
  fields?: ProposalEditableField[];
  workspaceCreate?: WorkspaceCreateProposalFields;
  diff?: ProposalDiffPreview;
  bulkItems?: BulkProposalItem[];
  warnings?: string[];
}

interface BaseProposal<K extends ProposalKind, P extends Record<string, unknown>> {
  kind: K;
  payload: P;
  preview: ProposalPreview;
  applyToolCallId?: string;
}

export type SettingsProposalChange = AppSettingChange & { apply?: AppSettingApplyPlan };

export type SettingsChangeProposal = BaseProposal<
  'settings-change',
  { changes: SettingsProposalChange[] }
>;

export type WorkspaceCreateProposal = BaseProposal<
  'workspace-create',
  { operation: 'workspace.create'; params?: Record<string, unknown> }
>;

export type SpecialistProposalOperation = 'create' | 'edit' | 'delete';

export type SpecialistEditProposal = BaseProposal<
  'specialist-edit',
  {
    operation?: SpecialistProposalOperation;
    action?: SpecialistProposalOperation;
    id?: string;
    name?: string;
    description?: string;
    model?: string;
    prompt?: string;
    behaviorPrompt?: string;
    codingAgent?: string;
    roleReminder?: string;
    scope?: SpecialistFileScope;
  }
>;

export type BulkOperationProposal = BaseProposal<
  'bulk-op',
  {
    operation: 'workspace.bulkArchive' | 'workspace.bulkDelete';
    ids: string[];
  }
>;

export type Proposal =
  | WorkspaceCreateProposal
  | SettingsChangeProposal
  | SpecialistEditProposal
  | BulkOperationProposal;

export interface ProposalActionDetail {
  proposal: Proposal;
  editedFields: Record<string, unknown>;
  selectedBulkItemIds: string[];
}

export function isProposalKind(kind: unknown): kind is ProposalKind {
  return typeof kind === 'string' && PROPOSAL_KINDS.includes(kind as ProposalKind);
}

export function isSettingsChangeProposal(proposal: Proposal): proposal is SettingsChangeProposal {
  return proposal.kind === 'settings-change';
}

export function isSpecialistEditProposal(proposal: Proposal): proposal is SpecialistEditProposal {
  return proposal.kind === 'specialist-edit';
}

export function isWorkspaceCreateProposal(proposal: Proposal): proposal is WorkspaceCreateProposal {
  return proposal.kind === 'workspace-create';
}

export function isProposal(value: unknown): value is Proposal {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Proposal>;
  return (
    isProposalKind(candidate.kind) &&
    !!candidate.preview &&
    typeof candidate.preview === 'object' &&
    typeof candidate.preview.title === 'string' &&
    !!candidate.payload &&
    typeof candidate.payload === 'object'
  );
}
