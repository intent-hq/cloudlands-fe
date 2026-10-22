import { IPC_CHANNELS } from '$shared/ipc-registry';

/**
 * Provider-generic forge-auth IPC channels — the renderer→daemon seam for the
 * `sourceControl.*` auth methods (GitHub and GitLab). One source of truth in
 * the registry so the preload allowlist and these constants cannot drift.
 */
export const FORGE_AUTH_CHANNELS = IPC_CHANNELS.FORGE_AUTH;

/** Default GitLab host when the user leaves the instance URL blank. */
export const DEFAULT_GITLAB_HOST = 'gitlab.com';
