import { logger } from '$lib/utils/client-logger';

/**
 * Debug configuration for development
 * These flags can be toggled to test different behaviors and animations
 */

// Check if we're in development mode
const isDev = import.meta.env.DEV;

// Debug flags stored in localStorage for persistence
const DEBUG_FLAGS_KEY = 'workspace-debug-flags';

interface DebugFlags {
  // Animation controls
  enableCreationAnimation: boolean;
  animationDuration: number; // in milliseconds
  enablePageTransitions: boolean;
  enableComponentTransitions: boolean;

  // UI behavior
  showDebugInfo: boolean;
  showPerformanceMetrics: boolean;
  logStateChanges: boolean;

  // Feature flags
  enableAutofocus: boolean;
  enableBranchCaching: boolean;
  enableFormPersistence: boolean;

  // Testing helpers
  simulateSlowNetwork: boolean;
  simulateErrors: boolean;
  networkDelay: number; // in milliseconds
}

const defaultFlags: DebugFlags = {
  // Animations
  enableCreationAnimation: true,
  animationDuration: 300,
  enablePageTransitions: true,
  enableComponentTransitions: true,

  // UI behavior
  showDebugInfo: false,
  showPerformanceMetrics: false,
  logStateChanges: false,

  // Features
  enableAutofocus: true,
  enableBranchCaching: true,
  enableFormPersistence: true,

  // Testing
  simulateSlowNetwork: false,
  simulateErrors: false,
  networkDelay: 0,
};

class DebugConfig {
  private flags: DebugFlags;
  private listeners: Set<(flags: DebugFlags) => void> = new Set();

  constructor() {
    this.flags = this.loadFlags();

    // NOTE: Debug panel shortcut (Cmd+Shift+D) removed to avoid conflict with drawer toggle.
    // Use debugConfig.toggleDebugPanel() from console or DevTools instead.
  }

  private loadFlags(): DebugFlags {
    if (typeof localStorage === 'undefined') return defaultFlags;

    try {
      const stored = localStorage.getItem(DEBUG_FLAGS_KEY);
      if (stored) {
        return { ...defaultFlags, ...JSON.parse(stored) };
      }
    } catch (e) {
      logger.error('Failed to load debug flags:', e);
    }

    return defaultFlags;
  }

  private saveFlags(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(DEBUG_FLAGS_KEY, JSON.stringify(this.flags));
    } catch (e) {
      logger.error('Failed to save debug flags:', e);
    }

    // Notify listeners
    this.listeners.forEach((listener) => listener(this.flags));
  }

  get(key: keyof DebugFlags): any {
    return this.flags[key];
  }

  set<K extends keyof DebugFlags>(key: K, value: DebugFlags[K]): void {
    this.flags[key] = value;
    this.saveFlags();
  }

  toggle(key: keyof DebugFlags): void {
    if (typeof this.flags[key] === 'boolean') {
      (this.flags as any)[key] = !this.flags[key];
      this.saveFlags();
    }
  }

  reset(): void {
    this.flags = { ...defaultFlags };
    this.saveFlags();
  }

  getAll(): DebugFlags {
    return { ...this.flags };
  }

  subscribe(listener: (flags: DebugFlags) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private toggleDebugPanel(): void {
    this.toggle('showDebugInfo');
    logger.info('Debug panel:', this.flags.showDebugInfo ? 'ON' : 'OFF');
  }

  // Helper method to simulate network delay
  async simulateDelay<T>(promise: Promise<T>): Promise<T> {
    if (this.flags.simulateSlowNetwork && this.flags.networkDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.flags.networkDelay));
    }
    return promise;
  }
}

export const debugConfig = new DebugConfig();
export type { DebugFlags };
