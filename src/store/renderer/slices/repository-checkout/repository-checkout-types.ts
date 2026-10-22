import type { Collection } from '@themislib/themis/utils/collections/collection-utils';
import type {
  CheckoutBranch,
  CheckoutCapture,
  CheckoutProject,
  CheckoutProjectQuery,
  CheckoutSelection,
  CheckoutUnavailable,
} from '$shared/types/repository-checkout';

/** Saved intent only: never a lease, revision, authority or asserted commit SHA. */
export interface RepositoryCheckoutDraft {
  instanceBaseUrl: string;
  projectPath?: string;
  branch?: string;
  mode?: CheckoutSelection['mode'];
  contextUrl?: string;
}

export interface RepositoryCheckoutForm {
  formId: string;
  scopeKey: string | null;
  admission: string | null;
  status: 'capturing' | 'ready' | 'unavailable';
  capture: CheckoutCapture | null;
  unavailable: CheckoutUnavailable | null;
  draft: RepositoryCheckoutDraft | null;
  mode: CheckoutSelection['mode'];
  projectQuery: string;
  projects: Collection<CheckoutProject, 'projectPath'>;
  projectsRevision: number;
  projectsStatus: 'idle' | 'loading' | 'ready';
  projectsCursor: string | null;
  projectRequest: CheckoutProjectQuery | null;
  projectRevision: number;
  project: CheckoutProject | null;
  contextUrl: string | null;
  branchQuery: string;
  branches: Collection<CheckoutBranch, 'name'>;
  branchesRevision: number;
  branchesStatus: 'idle' | 'loading' | 'ready';
  branchesCursor: string | null;
  branch: CheckoutBranch | null;
  explicitBranch: boolean;
  resolvingBranch: boolean;
  branchByProject: Collection<{ projectPath: string; branch: string }, 'projectPath'>;
  warmStatus: 'idle' | 'warming' | 'ready';
}

export interface RepositoryCheckoutState {
  authorityGeneration: number;
  forms: Collection<RepositoryCheckoutForm, 'formId'>;
}
