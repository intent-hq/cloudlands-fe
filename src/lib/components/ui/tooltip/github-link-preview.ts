/**
 * Compatibility entry for the Svelte tooltip until renderer cutover.
 * The shared service owns request/resource behavior; this facade preserves the
 * lazy AppClient boundary and all existing public imports and injection options.
 */
import { captureIntegrationContext } from '$features/integrations-request-context';
import {
  createLinkPreviewService,
  createPreviewRequest as createSharedPreviewRequest,
  type GitHubLinkPreview,
  type LoadGitHubLinkPreviewOptions as SharedLoadOptions,
  type PreviewRequestTicket as SharedPreviewTicket,
} from '$lib/client/live/link-preview-service';

export {
  classifyGitHubLinkPreviewError,
  type GitHubLinkPreview,
  type GitHubLinkPreviewClient,
  type GitHubLinkPreviewFailure,
  type GitLabPreviewUpdate,
} from '$lib/client/live/link-preview-service';

export type LoadGitHubLinkPreviewOptions = SharedLoadOptions;
export type PreviewRequestTicket = SharedPreviewTicket;

const service = createLinkPreviewService({
  getClient: async () => (await import('$lib/client')).appClient.integrations,
  captureContext: captureIntegrationContext,
});

export const loadGitHubLinkPreview: (
  url: string,
  options?: LoadGitHubLinkPreviewOptions,
) => Promise<GitHubLinkPreview | null> = service.loadGitHubLinkPreview;
export const { observeGitLabLinkPreview, clearGitHubLinkPreviewCache } = service;
export const createPreviewRequest: () => {
  next(): PreviewRequestTicket;
  invalidate(): void;
} = createSharedPreviewRequest;
