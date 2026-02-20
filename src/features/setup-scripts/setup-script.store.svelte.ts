/**
 * Setup Script Store
 *
 * Manages storage and retrieval of setup scripts.
 * Scripts are persisted to localStorage with per-repo prioritization.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SetupScript, ProjectType } from './types';
import { SETUP_SCRIPT_TEMPLATES, SETUP_SCRIPT_VARIABLES } from './types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('SetupScriptStore');
const STORAGE_KEY = 'setup-scripts';
const MAX_SCRIPTS = 50;

class SetupScriptStore {
  #scripts: SetupScript[] = $state([]);
  #pendingDeletions = new Set<string>();

  constructor() {
    this.load();
  }

  get scripts() {
    // Filter out scripts pending deletion for UI consistency
    return this.#scripts.filter((s) => !this.#pendingDeletions.has(s.id));
  }

  /**
   * Get scripts sorted by relevance to the given repo
   * Priority: same repo > similar project type > recent > all
   */
  getScriptsForRepo(repoPath?: string, projectType?: ProjectType): SetupScript[] {
    // Use this.scripts getter to ensure reactivity and filter pending deletions
    const scripts = [...this.scripts];

    // Sort by relevance
    scripts.sort((a, b) => {
      // Same repo gets highest priority
      const aRepoMatch = repoPath && a.repoPath === repoPath;
      const bRepoMatch = repoPath && b.repoPath === repoPath;
      if (aRepoMatch && !bRepoMatch) return -1;
      if (!aRepoMatch && bRepoMatch) return 1;

      // Same project type gets second priority
      const aTypeMatch = projectType && a.projectType === projectType;
      const bTypeMatch = projectType && b.projectType === projectType;
      if (aTypeMatch && !bTypeMatch) return -1;
      if (!aTypeMatch && bTypeMatch) return 1;

      // Otherwise sort by usage count, then by last used
      if (b.usageCount !== a.usageCount) {
        return b.usageCount - a.usageCount;
      }
      return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
    });

    return scripts;
  }

  /**
   * Get the last used script for a specific repo
   */
  getLastUsedForRepo(repoPath: string): SetupScript | undefined {
    return this.#scripts
      .filter((s) => s.repoPath === repoPath)
      .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())[0];
  }

  /**
   * Save a script (create or update)
   */
  save(script: Partial<SetupScript> & { content: string; repoPath?: string }): SetupScript {
    const now = new Date().toISOString();

    // Check if we have an existing script with same content for this repo
    const existing = this.#scripts.find(
      (s) => s.content === script.content && s.repoPath === script.repoPath,
    );

    if (existing) {
      // Update existing
      existing.lastUsedAt = now;
      existing.usageCount += 1;
      if (script.name) existing.name = script.name;
      if (script.projectType) existing.projectType = script.projectType;
      this.persist();
      return existing;
    }

    // Create new
    const newScript: SetupScript = {
      id: uuidv4(),
      name: script.name || 'Custom Script',
      content: script.content,
      repoPath: script.repoPath,
      projectType: script.projectType,
      lastUsedAt: now,
      usageCount: 1,
      createdAt: now,
    };

    this.#scripts.unshift(newScript);

    // Trim to max
    if (this.#scripts.length > MAX_SCRIPTS) {
      this.#scripts = this.#scripts.slice(0, MAX_SCRIPTS);
    }

    this.persist();
    return newScript;
  }

  /**
   * Record usage of a script (call when workspace is created)
   */
  recordUsage(scriptId: string, repoPath?: string): void {
    const script = this.#scripts.find((s) => s.id === scriptId);
    if (script) {
      script.lastUsedAt = new Date().toISOString();
      script.usageCount += 1;
      if (repoPath && !script.repoPath) {
        script.repoPath = repoPath;
      }
      this.persist();
    }
  }

  /**
   * Rename a script
   */
  rename(scriptId: string, newName: string): boolean {
    const script = this.#scripts.find((s) => s.id === scriptId);
    if (script) {
      script.name = newName.trim() || 'Custom Script';
      this.persist();
      return true;
    }
    return false;
  }

  /**
   * Update a script's content
   */
  updateContent(scriptId: string, content: string): boolean {
    const script = this.#scripts.find((s) => s.id === scriptId);
    if (script) {
      script.content = content;
      script.lastUsedAt = new Date().toISOString();
      this.persist();
      return true;
    }
    return false;
  }

  /**
   * Get a script by ID
   */
  getById(scriptId: string): SetupScript | undefined {
    return this.#scripts.find((s) => s.id === scriptId);
  }

  // --- Optimistic deletion with undo support ---

  /**
   * Remove script from UI only (optimistic deletion)
   * Does not permanently delete. Adds to pending deletions to prevent UI from showing it.
   */
  removeFromUI(scriptId: string): SetupScript | undefined {
    const script = this.#scripts.find((s) => s.id === scriptId);
    if (script) {
      this.#pendingDeletions.add(scriptId);
      // Trigger reactivity by reassigning (the getter will filter out pending deletions)
      this.#scripts = [...this.#scripts];
    }
    return script;
  }

  /**
   * Restore script to UI (undo deletion)
   * Clears the pending deletion flag
   */
  restoreToUI(scriptId: string): void {
    this.#pendingDeletions.delete(scriptId);
    // Trigger reactivity
    this.#scripts = [...this.#scripts];
  }

  /**
   * Permanently delete a script
   */
  delete(scriptId: string, skipUIRemoval = false): void {
    if (!skipUIRemoval) {
      this.#pendingDeletions.add(scriptId);
    }
    this.#scripts = this.#scripts.filter((s) => s.id !== scriptId);
    this.#pendingDeletions.delete(scriptId);
    this.persist();
  }

  /**
   * Check if a script is pending deletion
   */
  isPendingDeletion(scriptId: string): boolean {
    return this.#pendingDeletions.has(scriptId);
  }

  private load(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.#scripts = Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      logger.error('Failed to load setup scripts', { error: e });
      this.#scripts = [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#scripts));
    } catch (e) {
      logger.error('Failed to save setup scripts', { error: e });
    }
  }
}

export const setupScriptStore = new SetupScriptStore();

// Re-export for convenience
export { SETUP_SCRIPT_TEMPLATES, SETUP_SCRIPT_VARIABLES };
