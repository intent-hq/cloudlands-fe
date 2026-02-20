/**
 * Release Notes Store
 *
 * Manages fetching and displaying release notes after an app update.
 * Detects when the app version changes and shows release notes modal.
 */

import { DEFAULTS } from '$shared/constants';

/**
 * Get the update base URL from constants
 */
function getUpdateBaseUrl(): string {
  return DEFAULTS.AUTO_UPDATE_URL;
}

export interface ReleaseNotes {
  version: string;
  date: string;
  highlights: string[];
}

const LAST_VERSION_KEY = 'lastSeenVersion';

function createReleaseNotesStore() {
  let releaseNotes = $state<ReleaseNotes | null>(null);
  let showModal = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let initialized = $state(false);

  /**
   * Get the last seen version from localStorage
   */
  function getLastSeenVersion(): string | null {
    try {
      return localStorage.getItem(LAST_VERSION_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Save the current version to localStorage
   */
  function saveLastSeenVersion(version: string): void {
    try {
      localStorage.setItem(LAST_VERSION_KEY, version);
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Fetch release notes from CloudFront
   */
  async function fetchReleaseNotes(channel: string = 'stable'): Promise<ReleaseNotes | null> {
    const baseUrl = getUpdateBaseUrl();
    const url = `${baseUrl}/${channel}/release-notes.json`;

    try {
      const response = await fetch(url, {
        cache: 'no-cache', // Always fetch fresh
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch release notes: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.warn('[ReleaseNotes] Failed to fetch release notes:', err);
      return null;
    }
  }

  return {
    // State getters
    get releaseNotes() {
      return releaseNotes;
    },
    get showModal() {
      return showModal;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },

    /**
     * Initialize and check for version change
     */
    async initialize(currentVersion: string, channel: string = 'stable'): Promise<void> {
      if (initialized) return;
      initialized = true;

      const lastSeenVersion = getLastSeenVersion();

      // If version changed (and we have a previous version), fetch and show release notes
      if (lastSeenVersion && lastSeenVersion !== currentVersion) {
        loading = true;

        try {
          const notes = await fetchReleaseNotes(channel);

          // Only show if we got notes and they match current version
          if (notes && notes.version === currentVersion) {
            releaseNotes = notes;
            showModal = true;
          }
        } catch (err) {
          error = (err as Error).message;
        } finally {
          loading = false;
        }
      }

      // Always save current version
      saveLastSeenVersion(currentVersion);
    },

    /**
     * Close the modal
     */
    closeModal(): void {
      showModal = false;
    },

    /**
     * Manually fetch and show release notes
     */
    async showReleaseNotes(channel: string = 'stable'): Promise<void> {
      loading = true;
      error = null;

      try {
        const notes = await fetchReleaseNotes(channel);
        if (notes) {
          releaseNotes = notes;
          showModal = true;
        } else {
          error = 'No release notes available';
        }
      } catch (err) {
        error = (err as Error).message;
      } finally {
        loading = false;
      }
    },
  };
}

export const releaseNotesStore = createReleaseNotesStore();
