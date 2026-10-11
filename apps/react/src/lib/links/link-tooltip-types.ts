// Canonical preview contracts are shared; this module only composes the UI union.
import type {
  GitHubLinkPreview,
  GitHubLinkPreviewFailure,
  GitLabPreviewUpdate,
} from '$lib/client/live/link-preview-service';

export type {
  GitHubLinkPreview,
  GitHubLinkPreviewFailure,
  GitLabPreviewUpdate,
} from '$lib/client/live/link-preview-service';

export type GitLabLinkPreview = Extract<GitLabPreviewUpdate, { status: 'ready' }>['data'];

export type LinkTooltipPreview =
  | GitLabPreviewUpdate
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: GitHubLinkPreview }
  | { status: 'error'; reason: GitHubLinkPreviewFailure };
