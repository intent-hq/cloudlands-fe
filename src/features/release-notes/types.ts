/**
 * Release Notes Types
 *
 * Shared between the main process (fetch + startup detection) and the
 * renderer (modal). Safe to import from any process.
 */

/** Release notes for one published version, as served by the GitHub release. */
export interface ReleaseNotesContent {
  /** App version the notes belong to (without the `v` tag prefix). */
  version: string;
  /** Raw markdown body of the GitHub release. */
  notes: string;
  /** Public GitHub release page, opened externally from the modal. */
  url: string;
}

/**
 * Payload of the main → renderer "show release notes" push.
 *
 * The startup flow has already fetched, so it pushes the notes directly. The
 * Help-menu flow pushes `notes: null`, which tells the renderer to open the
 * modal in its loading state and fetch on demand over `release-notes:get`.
 */
export interface ShowReleaseNotesPayload {
  notes: ReleaseNotesContent | null;
}

/** FE-local pref key holding the last version whose notes were shown. */
export const LAST_SEEN_RELEASE_NOTES_VERSION_KEY = 'lastSeenReleaseNotesVersion';

/** Public repo whose GitHub releases carry the desktop app release notes. */
export const RELEASE_NOTES_REPO = 'intent-hq/cloudlands-releases';

/**
 * IPC channels for release notes.
 */
export const RELEASE_NOTES_CHANNELS = {
  // Invoke channel (renderer → main)
  GET: 'release-notes:get',
  // Event channel (main → renderer)
  SHOW: 'release-notes:show',
} as const;
