import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import type {
  CheckoutBranch,
  CheckoutBranches,
  CheckoutCapture,
  CheckoutProjectDetail,
  CheckoutProjects,
  CheckoutSelection,
  CheckoutUnavailable,
} from '$shared/types/repository-checkout';
import {
  connectGitLabWithToken,
  gitlabAuthChanged,
  gitlabAuthCompleted,
  gitlabLogoutCompleted,
  logoutGitLab,
  resetGitLabAdmission,
  setGitLabHost,
  startGitLabDeviceAuth,
} from '../gitlab-auth/gitlab-auth-slice';
import type {
  RepositoryCheckoutDraft,
  RepositoryCheckoutForm,
  RepositoryCheckoutState,
} from './repository-checkout-types';

export const opened = createAction<[formId: string, draft?: RepositoryCheckoutDraft]>(
  'repositoryCheckout/opened',
);
export const closed = createAction<[formId: string]>('repositoryCheckout/closed');
export const invalidDraftOpened = createAction<[formId: string]>(
  'repositoryCheckout/invalidDraftOpened',
);
export const projectQueryChanged = createAction<[formId: string, scopeKey: string, query: string]>(
  'repositoryCheckout/projectQueryChanged',
);
export const projectsMoreRequested = createAction<[formId: string, scopeKey: string]>(
  'repositoryCheckout/projectsMoreRequested',
);
export const projectSelected = createAction<
  [formId: string, scopeKey: string, projectPath: string]
>('repositoryCheckout/projectSelected');
export const urlSubmitted = createAction<[formId: string, scopeKey: string, url: string]>(
  'repositoryCheckout/urlSubmitted',
);
export const branchQueryChanged = createAction<[formId: string, scopeKey: string, query: string]>(
  'repositoryCheckout/branchQueryChanged',
);
export const branchesMoreRequested = createAction<[formId: string, scopeKey: string]>(
  'repositoryCheckout/branchesMoreRequested',
);
export const branchSelected = createAction<
  [formId: string, scopeKey: string, branch: Pick<CheckoutBranch, 'name' | 'commitSha'>]
>('repositoryCheckout/branchSelected');
export const modeChanged = createAction<
  [formId: string, scopeKey: string, mode: CheckoutSelection['mode']]
>('repositoryCheckout/modeChanged');
export const recoveryRequested = createAction<[formId: string, scopeKey: string]>(
  'repositoryCheckout/recoveryRequested',
);

export const checkoutBound = createAction<
  [formId: string, scopeKey: string, admission: string, capture: CheckoutCapture]
>('repositoryCheckout/bound');
export const checkoutUnavailable = createAction<
  [formId: string, scopeKey: string | null, failure: CheckoutUnavailable]
>('repositoryCheckout/unavailable');
export const checkoutProjectsReceived = createAction<
  [formId: string, scopeKey: string, revision: number, page: CheckoutProjects, append: boolean]
>('repositoryCheckout/projectsReceived');
export const checkoutProjectReceived = createAction<
  [formId: string, scopeKey: string, revision: number, detail: CheckoutProjectDetail]
>('repositoryCheckout/projectReceived');
export const checkoutBranchesReceived = createAction<
  [
    formId: string,
    scopeKey: string,
    revision: number,
    projectRevision: number,
    page: CheckoutBranches,
    append: boolean,
  ]
>('repositoryCheckout/branchesReceived');
export const checkoutBranchRestored = createAction<
  [formId: string, scopeKey: string, projectRevision: number, branch: CheckoutBranch]
>('repositoryCheckout/branchRestored');
export const checkoutWarmChanged = createAction<
  [
    formId: string,
    scopeKey: string,
    selection: CheckoutSelection,
    status: RepositoryCheckoutForm['warmStatus'],
  ]
>('repositoryCheckout/warmChanged');

function emptyForm(formId: string, draft?: RepositoryCheckoutDraft): RepositoryCheckoutForm {
  return {
    formId,
    scopeKey: null,
    admission: null,
    status: 'capturing',
    capture: null,
    unavailable: null,
    draft: draft ?? null,
    mode: draft?.mode ?? 'cached',
    projectQuery: '',
    projects: createCollection('projectPath'),
    projectsRevision: 0,
    projectsStatus: 'idle',
    projectsCursor: null,
    projectRequest: null,
    projectRevision: 0,
    project: null,
    contextUrl: null,
    branchQuery: '',
    branches: createCollection('name'),
    branchesRevision: 0,
    branchesStatus: 'idle',
    branchesCursor: null,
    branch: null,
    explicitBranch: false,
    branchByProject: createCollection('projectPath'),
    warmStatus: 'idle',
  };
}
const initialState: RepositoryCheckoutState = {
  authorityGeneration: 0,
  forms: createCollection('formId'),
};
export const repositoryCheckoutReducer = createReducer(initialState);

function change(
  state: RepositoryCheckoutState,
  formId: string,
  scopeKey: string | null,
  update: (form: RepositoryCheckoutForm) => RepositoryCheckoutForm,
): RepositoryCheckoutState {
  const form = getItem(state.forms, formId);
  if (!form || form.scopeKey !== scopeKey) return state;
  return { ...state, forms: upsertItem(state.forms, update(form)) };
}
function readyChange(
  state: RepositoryCheckoutState,
  formId: string,
  scopeKey: string,
  update: (form: RepositoryCheckoutForm) => RepositoryCheckoutForm,
) {
  return change(state, formId, scopeKey, (form) => (form.status === 'ready' ? update(form) : form));
}

repositoryCheckoutReducer.with(opened, (state, { payload: [id, draft] }) => ({
  ...state,
  forms: upsertItem(state.forms, emptyForm(id, draft)),
}));
repositoryCheckoutReducer.with(closed, (state, { payload: [id] }) => ({
  ...state,
  forms: removeItem(state.forms, id),
}));
repositoryCheckoutReducer.with(invalidDraftOpened, (state, { payload: [id] }) => ({
  ...state,
  forms: upsertItem(state.forms, {
    ...emptyForm(id),
    status: 'unavailable',
    unavailable: { status: 'unavailable', reason: 'invalid-target' },
  }),
}));
repositoryCheckoutReducer.with(
  checkoutBound,
  (state, { payload: [id, scope, admission, capture] }) =>
    change(state, id, null, (form) => ({
      ...form,
      scopeKey: scope,
      admission,
      capture,
      status: 'ready',
    })),
);
repositoryCheckoutReducer.with(checkoutUnavailable, (state, { payload: [id, scope, failure] }) =>
  change(state, id, scope, (form) => ({
    ...emptyForm(id, form.draft ?? undefined),
    scopeKey: form.scopeKey,
    admission: form.admission,
    status: 'unavailable',
    unavailable: failure,
    projectsRevision: form.projectsRevision + 1,
    projectRevision: form.projectRevision + 1,
    branchesRevision: form.branchesRevision + 1,
  })),
);
repositoryCheckoutReducer.with(projectQueryChanged, (state, { payload: [id, scope, query] }) =>
  readyChange(state, id, scope, (form) => ({
    ...form,
    projectQuery: query,
    projects: createCollection('projectPath'),
    projectsCursor: null,
    projectsRevision: form.projectsRevision + 1,
    projectsStatus: 'loading',
  })),
);
repositoryCheckoutReducer.with(projectsMoreRequested, (state, { payload: [id, scope] }) =>
  readyChange(state, id, scope, (form) =>
    form.projectsCursor && form.projectsStatus !== 'loading'
      ? { ...form, projectsRevision: form.projectsRevision + 1, projectsStatus: 'loading' }
      : form,
  ),
);
repositoryCheckoutReducer.with(
  checkoutProjectsReceived,
  (state, { payload: [id, scope, revision, page, append] }) =>
    readyChange(state, id, scope, (form) =>
      form.projectsRevision !== revision
        ? form
        : {
            ...form,
            projects: createCollection('projectPath', [
              ...(append ? getItems(form.projects) : []),
              ...page.items,
            ]),
            projectsCursor: page.nextCursor ?? null,
            projectsStatus: 'ready',
          },
    ),
);

function selectProject(
  form: RepositoryCheckoutForm,
  projectRequest: RepositoryCheckoutForm['projectRequest'],
): RepositoryCheckoutForm {
  const remembered =
    form.project && form.branch
      ? upsertItem(form.branchByProject, {
          projectPath: form.project.projectPath,
          branch: form.branch.name,
        })
      : form.branchByProject;
  return {
    ...form,
    projectRequest,
    projectRevision: form.projectRevision + 1,
    project: null,
    contextUrl: null,
    branchQuery: '',
    branches: createCollection('name'),
    branchesRevision: form.branchesRevision + 1,
    branchesStatus: 'idle',
    branchesCursor: null,
    branch: null,
    explicitBranch: false,
    branchByProject: remembered,
    warmStatus: 'idle',
  };
}
repositoryCheckoutReducer.with(projectSelected, (state, { payload: [id, scope, path] }) =>
  readyChange(state, id, scope, (form) => selectProject(form, { projectPath: path })),
);
repositoryCheckoutReducer.with(urlSubmitted, (state, { payload: [id, scope, url] }) =>
  readyChange(state, id, scope, (form) => selectProject(form, { url })),
);
repositoryCheckoutReducer.with(
  checkoutProjectReceived,
  (state, { payload: [id, scope, revision, detail] }) =>
    readyChange(state, id, scope, (form) =>
      form.projectRevision !== revision
        ? form
        : {
            ...form,
            project: detail.project,
            contextUrl: detail.contextUrl ?? null,
            draft: {
              instanceBaseUrl: form.capture!.instanceBaseUrl,
              projectPath: detail.project.projectPath,
              mode: form.mode,
              ...(detail.contextUrl ? { contextUrl: detail.contextUrl } : {}),
            },
          },
    ),
);
repositoryCheckoutReducer.with(branchQueryChanged, (state, { payload: [id, scope, query] }) =>
  readyChange(state, id, scope, (form) =>
    !form.project
      ? form
      : {
          ...form,
          branchQuery: query,
          branches: createCollection('name'),
          branchesCursor: null,
          branchesRevision: form.branchesRevision + 1,
          branchesStatus: 'loading',
        },
  ),
);
repositoryCheckoutReducer.with(branchesMoreRequested, (state, { payload: [id, scope] }) =>
  readyChange(state, id, scope, (form) =>
    form.project && form.branchesCursor && form.branchesStatus !== 'loading'
      ? { ...form, branchesRevision: form.branchesRevision + 1, branchesStatus: 'loading' }
      : form,
  ),
);
repositoryCheckoutReducer.with(
  checkoutBranchesReceived,
  (state, { payload: [id, scope, revision, projectRevision, page, append] }) =>
    readyChange(state, id, scope, (form) =>
      form.branchesRevision !== revision || form.projectRevision !== projectRevision
        ? form
        : {
            ...form,
            branches: createCollection('name', [
              ...(append ? getItems(form.branches) : []),
              ...page.items,
            ]),
            branchesCursor: page.nextCursor ?? null,
            branchesStatus: 'ready',
          },
    ),
);
function chooseBranch(
  form: RepositoryCheckoutForm,
  branch: CheckoutBranch,
  explicit: boolean,
): RepositoryCheckoutForm {
  return {
    ...form,
    branch,
    explicitBranch: explicit,
    warmStatus: 'idle',
    draft: form.draft ? { ...form.draft, branch: branch.name } : null,
  };
}
repositoryCheckoutReducer.with(branchSelected, (state, { payload: [id, scope, choice] }) =>
  readyChange(state, id, scope, (form) => {
    const branch = getItem(form.branches, choice.name);
    return branch?.commitSha === choice.commitSha ? chooseBranch(form, branch, true) : form;
  }),
);
repositoryCheckoutReducer.with(
  checkoutBranchRestored,
  (state, { payload: [id, scope, revision, branch] }) =>
    readyChange(state, id, scope, (form) =>
      form.projectRevision === revision && !form.explicitBranch
        ? chooseBranch(form, branch, false)
        : form,
    ),
);
repositoryCheckoutReducer.with(modeChanged, (state, { payload: [id, scope, mode] }) =>
  readyChange(state, id, scope, (form) => ({
    ...form,
    mode,
    draft: form.draft ? { ...form.draft, mode } : null,
    warmStatus: 'idle',
    branches: createCollection('name'),
    branchesCursor: null,
    branchesRevision: form.branchesRevision + 1,
    branchesStatus: form.project ? 'loading' : 'idle',
  })),
);
repositoryCheckoutReducer.with(
  checkoutWarmChanged,
  (state, { payload: [id, scope, selected, status] }) =>
    readyChange(state, id, scope, (form) =>
      form.capture?.checkoutId === selected.checkoutId &&
      form.capture.revision === selected.revision &&
      form.project?.projectPath === selected.projectPath &&
      form.branch?.name === selected.branch &&
      form.branch.commitSha === selected.commitSha &&
      form.mode === selected.mode
        ? { ...form, warmStatus: status }
        : form,
    ),
);

const invalidateAuthority = (state: RepositoryCheckoutState) => ({
  ...state,
  authorityGeneration: state.authorityGeneration + 1,
});
repositoryCheckoutReducer.with(connectGitLabWithToken, invalidateAuthority);
repositoryCheckoutReducer.with(gitlabAuthChanged, invalidateAuthority);
repositoryCheckoutReducer.with(gitlabAuthCompleted, invalidateAuthority);
repositoryCheckoutReducer.with(gitlabLogoutCompleted, invalidateAuthority);
repositoryCheckoutReducer.with(logoutGitLab, invalidateAuthority);
repositoryCheckoutReducer.with(resetGitLabAdmission, invalidateAuthority);
repositoryCheckoutReducer.with(setGitLabHost, invalidateAuthority);
repositoryCheckoutReducer.with(startGitLabDeviceAuth, invalidateAuthority);
