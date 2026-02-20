/**
 * Installed Editors Store
 *
 * Fetches and caches the list of installed editors/IDEs on the system.
 * This enables dynamic "Open in..." menus based on what's actually installed.
 */

import { invoke } from '$lib/electron-bridge';
import type { EditorCategory } from '$shared/editors/editor-registry';

/** Detected editor from the main process */
export interface InstalledEditor {
  id: string;
  name: string;
  shortLabel: string;
  appName: string;
  category: EditorCategory;
  handlerType: 'generic' | 'vscode' | 'jetbrains' | 'xcode' | 'finder';
  bundleId?: string;
  shortcut?: string;
  priority: number;
  installed: boolean;
  /** Base64-encoded PNG icon extracted from the app bundle */
  iconBase64?: string;
}

const STORAGE_KEY = 'installed-editors-cache';
const CACHE_TTL_MS = 60000; // 1 minute cache

function createInstalledEditorsStore() {
  let editors = $state<InstalledEditor[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let lastFetched = $state(0);

  // Load from localStorage cache on init
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.editors && parsed.timestamp) {
          editors = parsed.editors;
          lastFetched = parsed.timestamp;
        }
      }
    } catch {
      // Ignore cache errors
    }
  }

  async function fetchEditors(forceRefresh = false): Promise<InstalledEditor[]> {
    const now = Date.now();

    // Return cached if still valid
    if (!forceRefresh && editors.length > 0 && now - lastFetched < CACHE_TTL_MS) {
      return editors;
    }

    loading = true;
    error = null;

    try {
      const result = await invoke<{ success: boolean; data?: InstalledEditor[]; error?: string }>(
        'external-editors:detect-installed',
        { forceRefresh },
      );

      if (result?.success && result.data) {
        editors = result.data;
        lastFetched = now;

        // Persist to localStorage
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ editors, timestamp: now }));
          } catch {
            // Ignore storage errors
          }
        }
      } else if (result?.error) {
        error = result.error;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to detect editors';
    } finally {
      loading = false;
    }

    return editors;
  }

  return {
    get editors() {
      return editors;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get lastFetched() {
      return lastFetched;
    },

    /** Get editors by category */
    byCategory(category: EditorCategory): InstalledEditor[] {
      return editors.filter((e) => e.category === category);
    },

    /** Get IDEs only */
    get ides(): InstalledEditor[] {
      return editors.filter((e) => e.category === 'ide');
    },

    /** Get terminals only */
    get terminals(): InstalledEditor[] {
      return editors.filter((e) => e.category === 'terminal');
    },

    /** Fetch/refresh editors */
    fetch: fetchEditors,

    /** Force refresh */
    refresh() {
      return fetchEditors(true);
    },
  };
}

export const installedEditorsStore = createInstalledEditorsStore();
