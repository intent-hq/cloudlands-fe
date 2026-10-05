import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { CheckoutSelection } from '$shared/types/repository-checkout';
import { store } from '../../store';
import {
  selectCanCreateWorkspace,
  selectPrincipalActionContext,
} from '../principal/principal-selectors';
import { selectLabsGitLabEnabled } from '../user-preferences/user-preferences-selectors';

/** Renderer correlation only; the main process and daemon retain real authority. */
export const selectCheckoutAdmission = store.createSelector((state) => {
  const principal = selectPrincipalActionContext.select(state);
  if (
    !principal ||
    !selectCanCreateWorkspace.select(state) ||
    !selectLabsGitLabEnabled.select(state)
  )
    return null;
  return JSON.stringify([
    principal,
    state.hostExecution.generation,
    state.repositoryCheckout.authorityGeneration,
    state.gitlabAuth.host,
    state.gitlabAuth.instanceBaseUrl,
    state.gitlabAuth.statusReady,
    state.gitlabAuth.isConfigured,
    state.gitlabAuth.user,
  ]);
});
export const selectCheckoutForm = store.createSelector(
  (state, formId: string) => getItem(state.repositoryCheckout.forms, formId) ?? null,
);
export const selectCheckoutProjects = store.createSelector((state, formId: string) => {
  const form = selectCheckoutForm.select(state, formId);
  return form?.admission === selectCheckoutAdmission.select(state) && form.status === 'ready'
    ? getItems(form.projects)
    : [];
});
export const selectCheckoutBranches = store.createSelector((state, formId: string) => {
  const form = selectCheckoutForm.select(state, formId);
  return form?.admission === selectCheckoutAdmission.select(state) && form.status === 'ready'
    ? getItems(form.branches)
    : [];
});
export const selectCheckoutSelection = store.createSelector(
  (state, formId: string): CheckoutSelection | null => {
    const form = selectCheckoutForm.select(state, formId);
    if (
      !form ||
      form.status !== 'ready' ||
      form.admission !== selectCheckoutAdmission.select(state) ||
      !form.capture ||
      !form.project ||
      !form.branch
    )
      return null;
    return {
      checkoutId: form.capture.checkoutId,
      revision: form.capture.revision,
      projectPath: form.project.projectPath,
      branch: form.branch.name,
      commitSha: form.branch.commitSha,
      mode: form.mode,
    };
  },
);
export const selectCheckoutCanCreate = store.createSelector((state, formId: string) => {
  const selection = selectCheckoutSelection.select(state, formId);
  return (
    !!selection &&
    (selection.mode === 'direct' ||
      selectCheckoutForm.select(state, formId)?.warmStatus === 'ready')
  );
});
