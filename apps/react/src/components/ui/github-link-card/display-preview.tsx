// Static card frame from github-link-card.preview.svelte / LinkTooltip.svelte.
// This intentionally mounts no singleton, link actions or request controller.
import { m } from '$shared/paraglide/messages.js';
import { GitHubLinkCard } from './index';
import { githubLinkCardDisplayStates, type GitHubLinkCardDisplayState } from './display-states';
import './display-preview.css';

export function GitHubLinkCardDisplayPreview({
  state = 'pr-open',
}: {
  state?: GitHubLinkCardDisplayState;
}) {
  const props = githubLinkCardDisplayStates[state];
  return (
    <div className="github-link-card-display-preview" data-display-state={state}>
      <GitHubLinkCard {...props} />
      <div className="link-tooltip-hint">
        {state.startsWith('gitlab-')
          ? m.ui_linkTooltip_inAppHint_tooltip({ key: '⌘' })
          : m.ui_linkTooltip_gitHubActionsHint_tooltip({ key: '⌘' })}
      </div>
    </div>
  );
}
