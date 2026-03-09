/**
 * Skills Store
 *
 * Renderer-side store that fetches agent skills from the main process
 * and exposes them reactively for sidebar components.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('SkillsStore');

/**
 * Renderer-side skill info type.
 * Mirrors SkillMetadata from the main process with an optional scope field.
 */
export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  scope?: 'project' | 'user';
}

class SkillsStore {
  /** Current skills list */
  #skills = $state<SkillInfo[]>([]);

  /** Loading state */
  #loading = $state(false);

  /** Error message if any */
  #error = $state<string | null>(null);

  /** Current workspace ID */
  #currentWorkspaceId: string | null = null;

  /** Cache of skills by workspace ID */
  #cache: Record<string, SkillInfo[]> = {};

  // Getters
  get skills(): SkillInfo[] {
    return this.#skills;
  }

  get loading(): boolean {
    return this.#loading;
  }

  get error(): string | null {
    return this.#error;
  }

  /** Set the active workspace and auto-load skills */
  setWorkspace(workspaceId: string): void {
    this.#currentWorkspaceId = workspaceId;

    // Use cached data if available (instant switch)
    if (this.#cache[workspaceId]) {
      this.#skills = this.#cache[workspaceId];
    }

    // Always reload in the background to pick up changes
    this.loadSkills();
  }

  /** Load skills from the main process via IPC */
  async loadSkills(): Promise<void> {
    const workspaceId = this.#currentWorkspaceId;
    if (!workspaceId) return;

    this.#loading = true;
    this.#error = null;

    try {
      const result = await window.electronAPI?.invoke('skills:list', { workspaceId });

      // Guard against workspace switching during the async call
      if (this.#currentWorkspaceId !== workspaceId) return;

      if (result?.success && Array.isArray(result.data)) {
        const skills = result.data as SkillInfo[];
        this.#skills = skills;
        this.#cache[workspaceId] = skills;
        logger.info('Loaded skills', { count: skills.length, workspaceId });
      } else {
        this.#skills = [];
        this.#cache[workspaceId] = [];
        logger.debug('No skills found', { workspaceId });
      }
    } catch (error) {
      // Guard against workspace switching during the async call
      if (this.#currentWorkspaceId !== workspaceId) return;

      this.#error = error instanceof Error ? error.message : 'Failed to load skills';
      logger.error('Failed to load skills', { error });
    } finally {
      // Only clear loading if we're still on the same workspace
      if (this.#currentWorkspaceId === workspaceId) {
        this.#loading = false;
      }
    }
  }
}

export const skillsStore = new SkillsStore();

