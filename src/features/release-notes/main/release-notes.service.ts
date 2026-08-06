/**
 * Release Notes Service (main process)
 *
 * Fetches the GitHub release notes for the running app version and decides
 * whether the first launch after an update should surface them.
 *
 * The release notes live on the public `intent-hq/cloudlands-releases` repo,
 * tagged `vX.Y.Z` (the same tag serves beta and stable — stable is a promotion
 * of the same release), so an unauthenticated GitHub API call is enough.
 *
 * Startup detection compares `app.getVersion()` with the
 * `lastSeenReleaseNotesVersion` FE-local pref:
 *   - pref missing (fresh install) → record the version, show nothing;
 *   - pref equals the current version → nothing to do;
 *   - pref differs → fetch and show, and only then record the version, so an
 *     offline/404 startup retries on a later launch.
 */

import { app } from 'electron';
import { Logger } from '../../../shared/logger';
import { getLocalPref, hasLocalPref, setLocalPref } from '../../../main/local-prefs';
import {
  LAST_SEEN_RELEASE_NOTES_VERSION_KEY,
  RELEASE_NOTES_REPO,
  type ReleaseNotesContent,
} from '../types';

const logger = new Logger('ReleaseNotesService');

/** Abort the GitHub call quickly — startup must never wait on the network. */
const FETCH_TIMEOUT_MS = 5000;

/** Minimal shape of the GitHub "get release by tag" response we consume. */
interface GitHubRelease {
  body?: unknown;
  html_url?: unknown;
}

function releaseApiUrl(version: string): string {
  return `https://api.github.com/repos/${RELEASE_NOTES_REPO}/releases/tags/v${version}`;
}

function releasePageUrl(version: string): string {
  return `https://github.com/${RELEASE_NOTES_REPO}/releases/tag/v${version}`;
}

/**
 * Fetch the release notes for `version`. Fail-soft: any network error, non-OK
 * status (a 404 for an unpublished/dev version is expected), or empty body
 * resolves to `null` rather than throwing.
 */
export async function fetchReleaseNotes(version: string): Promise<ReleaseNotesContent | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(releaseApiUrl(version), {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.info('No release notes published for version', {
        version,
        status: response.status,
      });
      return null;
    }
    const release = (await response.json()) as GitHubRelease;
    const notes = typeof release.body === 'string' ? release.body.trim() : '';
    if (!notes) {
      logger.info('Release exists but carries an empty body', { version });
      return null;
    }
    return {
      version,
      notes,
      url: typeof release.html_url === 'string' ? release.html_url : releasePageUrl(version),
    };
  } catch (error) {
    logger.warn('Failed to fetch release notes', {
      version,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch the release notes for the currently running app version. */
export async function getCurrentReleaseNotes(): Promise<ReleaseNotesContent | null> {
  return fetchReleaseNotes(app.getVersion());
}

/**
 * Run the startup version-change check.
 *
 * Returns the notes to display, or `null` when nothing should be shown (fresh
 * install, unchanged version, or a failed fetch). `show` is invoked with the
 * notes before the pref advances, so the pref only moves once the renderer has
 * actually been handed something to display.
 */
export async function checkForReleaseNotesOnStartup(
  show: (notes: ReleaseNotesContent) => void,
): Promise<ReleaseNotesContent | null> {
  const currentVersion = app.getVersion();

  if (!(await hasLocalPref(LAST_SEEN_RELEASE_NOTES_VERSION_KEY))) {
    // Fresh install — record silently so the next update is the first showing.
    await setLocalPref(LAST_SEEN_RELEASE_NOTES_VERSION_KEY, currentVersion);
    logger.info('Fresh install — recorded release-notes version', { currentVersion });
    return null;
  }

  const lastSeen = await getLocalPref<string>(LAST_SEEN_RELEASE_NOTES_VERSION_KEY);
  if (lastSeen === currentVersion) return null;

  const notes = await fetchReleaseNotes(currentVersion);
  if (!notes) {
    // Fail-soft: leave the pref untouched so a later startup retries.
    logger.info('Release notes unavailable — will retry on a later startup', {
      currentVersion,
    });
    return null;
  }

  show(notes);
  await setLocalPref(LAST_SEEN_RELEASE_NOTES_VERSION_KEY, currentVersion);
  logger.info('Showed release notes after update', { lastSeen, currentVersion });
  return notes;
}
