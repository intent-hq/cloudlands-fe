import { m } from '$shared/paraglide/messages.js';
import type { CheckoutUnavailable } from '$shared/types/repository-checkout';
import type { RepositoryCheckoutForm } from '$store/renderer/slices/repository-checkout/repository-checkout-types';
import type { GitLabPickerProps } from './gitlab-picker-types';

export function checkoutFailureMessage(failure: CheckoutUnavailable): string {
  switch (failure.reason) {
    case 'disabled':
      return m.gitlabCheckout_disabled_description();
    case 'not-connected':
      return m.gitlabCheckout_notConnected_description();
    case 'access-denied':
      return m.gitlabCheckout_accessDenied_description();
    case 'rate-limited':
      return m.gitlabCheckout_rateLimited_description();
    case 'unreachable':
      return m.gitlabCheckout_unreachable_description();
    case 'retired':
      return m.gitlabCheckout_retired_description();
    case 'not-found':
      return m.gitlabCheckout_notFound_description();
    case 'invalid-target':
      return m.gitlabCheckout_invalidTarget_description();
    case 'empty-repository':
      return m.gitlabCheckout_emptyRepository_description();
    case 'branch-changed':
      return m.gitlabCheckout_branchChanged_description();
  }
}

export function checkoutPickerCopy(
  kind: 'projects' | 'branches',
): GitLabPickerProps<unknown>['copy'] {
  const projects = kind === 'projects';
  const empty = projects
    ? m.gitlabCheckout_emptyProjects_description()
    : m.gitlabCheckout_emptyBranches_description();
  return {
    searchLabel: projects
      ? m.gitlabCheckout_projectSearch_label()
      : m.gitlabCheckout_branchSearch_label(),
    searchPlaceholder: projects
      ? m.gitlabCheckout_projectSearch_placeholder()
      : m.gitlabCheckout_branchSearch_placeholder(),
    listLabel: projects ? m.gitlabCheckout_projects_label() : m.gitlabCheckout_branches_label(),
    loadingLabel: m.gitlabCheckout_loading_label(),
    emptyLabel: empty,
    emptySearchLabel: empty,
    loadMoreLabel: m.gitlabCheckout_loadMore_label(),
    loadingMoreLabel: m.gitlabCheckout_loading_label(),
  };
}

export function checkoutPickerPage<T>(
  form: RepositoryCheckoutForm | null,
  items: readonly T[],
  kind: 'projects' | 'branches',
): GitLabPickerProps<T>['page'] {
  if (form?.status === 'unavailable' && form.unavailable)
    return {
      status: 'unavailable',
      message: checkoutFailureMessage(form.unavailable),
      actionLabel: m.collaboration_host_refresh_label(),
    };
  if (
    !form ||
    form.status === 'capturing' ||
    (form[kind === 'projects' ? 'projectsStatus' : 'branchesStatus'] === 'loading' && !items.length)
  )
    return { status: 'loading' };
  return {
    status: 'ready',
    items,
    hasMore: !!form[kind === 'projects' ? 'projectsCursor' : 'branchesCursor'],
    loadingMore: form[kind === 'projects' ? 'projectsStatus' : 'branchesStatus'] === 'loading',
  };
}
