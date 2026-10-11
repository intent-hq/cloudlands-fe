/**
 * Compatibility entry for the Svelte tooltip until renderer cutover.
 * The shared service owns request/resource behavior; this facade preserves the
 * lazy AppClient boundary and all existing public imports and injection options.
 */
import { captureIntegrationContext } from '$features/integrations-request-context';
import { createLinkPreviewService } from '$lib/client/live/link-preview-service';

export {
  classifyGitHubLinkPreviewError,
  createPreviewRequest,
  type GitHubLinkPreview,
  type GitHubLinkPreviewClient,
  type GitHubLinkPreviewFailure,
  type GitLabPreviewUpdate,
  type LoadGitHubLinkPreviewOptions,
  type PreviewRequestTicket,
} from '$lib/client/live/link-preview-service';

export const { loadGitHubLinkPreview, observeGitLabLinkPreview, clearGitHubLinkPreviewCache } =
  createLinkPreviewService({
    getClient: async () => (await import('$lib/client')).appClient.integrations,
    captureContext: captureIntegrationContext,
  });
