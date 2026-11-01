/**
 * Clone-tab visibility for create surfaces. Reads raw state only, so a surface
 * rendered without the full store (or with forge selector modules mocked)
 * treats forge status as pending and keeps Clone visible.
 */
import { resolveCloneSourceVisible } from '$lib/components/workspace/initializer/clone-source-visibility';
import { store } from '../../store';

export const selectCloneSourceVisible = store.createSelector((state) => {
  const gitlabFailed = state.gitlabAuth?.statusFailed === true;
  return resolveCloneSourceVisible({
    githubConnected: state.githubAuth?.isAuthenticated === true,
    githubSettled: state.githubAuth?.statusSettled === true,
    githubFailed: state.githubAuth?.statusFailed === true,
    gitlabConnected: state.gitlabAuth?.isConfigured === true,
    gitlabSettled: state.gitlabAuth?.statusReady === true || gitlabFailed,
    gitlabFailed,
  });
});
