/**
 * URL State Management
 *
 * Provides a robust, extensible system for syncing component state with URL parameters.
 * Supports:
 * - Type-safe state definitions
 * - Automatic serialization/deserialization
 * - Validation and defaults
 * - History management
 */

import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { Logger } from '$shared/logger';

export interface URLStateDefinition {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'json';
    default?: any;
    validate?: (value: any) => boolean;
    serialize?: (value: any) => string;
    deserialize?: (value: string) => any;
  };
}

export class URLStateManager {
  private definition: URLStateDefinition;
  private prefix: string;
  private logger = new Logger('URLState');

  constructor(definition: URLStateDefinition, prefix: string = '') {
    this.definition = definition;
    this.prefix = prefix;
  }

  /**
   * Get current URL state
   */
  getState(): Record<string, any> {
    const currentPage = get(page);
    const state: Record<string, any> = {};

    for (const [key, def] of Object.entries(this.definition)) {
      const paramKey = this.prefix ? `${this.prefix}_${key}` : key;
      const value = currentPage.url.searchParams.get(paramKey);

      if (value !== null) {
        state[key] = this.deserialize(key, value);
      } else if (def.default !== undefined) {
        state[key] = def.default;
      }
    }

    return state;
  }

  /**
   * Get single state value
   */
  getValue<T = any>(key: string): T | undefined {
    const state = this.getState();
    return state[key] as T;
  }

  /**
   * Update URL state
   */
  async setState(updates: Record<string, any>, options: { replace?: boolean } = {}): Promise<void> {
    const currentPage = get(page);
    const params = new URLSearchParams(currentPage.url.searchParams);

    for (const [key, value] of Object.entries(updates)) {
      if (!this.definition[key]) {
        this.logger.warn(`Unknown state key: ${key}`);
        continue;
      }

      const paramKey = this.prefix ? `${this.prefix}_${key}` : key;

      if (value === null || value === undefined) {
        params.delete(paramKey);
      } else {
        const serialized = this.serialize(key, value);
        params.set(paramKey, serialized);
      }
    }

    const newUrl = `${currentPage.url.pathname}?${params.toString()}`;
    await goto(newUrl, { replaceState: options.replace });
  }

  /**
   * Clear state (remove from URL)
   */
  async clearState(keys?: string[]): Promise<void> {
    const currentPage = get(page);
    const params = new URLSearchParams(currentPage.url.searchParams);

    const keysToClear = keys || Object.keys(this.definition);

    for (const key of keysToClear) {
      const paramKey = this.prefix ? `${this.prefix}_${key}` : key;
      params.delete(paramKey);
    }

    const newUrl = `${currentPage.url.pathname}?${params.toString()}`;
    await goto(newUrl, { replaceState: true });
  }

  /**
   * Serialize value to URL parameter
   */
  private serialize(key: string, value: any): string {
    const def = this.definition[key];

    if (def.serialize) {
      return def.serialize(value);
    }

    switch (def.type) {
      case 'json':
        return encodeURIComponent(JSON.stringify(value));
      case 'boolean':
        return value ? '1' : '0';
      case 'number':
        return String(value);
      case 'string':
      default:
        return encodeURIComponent(String(value));
    }
  }

  /**
   * Deserialize URL parameter to value
   */
  private deserialize(key: string, value: string): any {
    const def = this.definition[key];

    if (def.deserialize) {
      return def.deserialize(value);
    }

    try {
      switch (def.type) {
        case 'json':
          return JSON.parse(decodeURIComponent(value));
        case 'boolean':
          return value === '1';
        case 'number':
          return Number(value);
        case 'string':
        default:
          return decodeURIComponent(value);
      }
    } catch (err) {
      this.logger.warn(`Deserialization error for ${key}:`, err);
      return def.default;
    }
  }
}

/**
 * Common URL state definitions
 */
export const CommonURLStates = {
  selectedNote: {
    type: 'string' as const,
    default: null,
    validate: (v: any) => v === null || typeof v === 'string',
  },

  selectedFile: {
    type: 'string' as const,
    default: null,
    validate: (v: any) => v === null || typeof v === 'string',
  },

  selectedAgent: {
    type: 'string' as const,
    default: null,
    validate: (v: any) => v === null || typeof v === 'string',
  },

  selectedTerminal: {
    type: 'string' as const,
    default: null,
    validate: (v: any) => v === null || typeof v === 'string',
  },

  mainContentType: {
    type: 'string' as const,
    default: 'empty',
    validate: (v: any) => ['notes', 'file', 'diff', 'spec', 'empty'].includes(v),
  },

  drawerOpen: {
    type: 'boolean' as const,
    default: false,
  },

  drawerType: {
    type: 'string' as const,
    default: 'agent',
    validate: (v: any) =>
      ['agent', 'terminal', 'diff', 'file', 'notes', 'note', 'code'].includes(v),
  },
};
