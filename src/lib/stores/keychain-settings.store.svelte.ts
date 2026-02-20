/**
 * Keychain Settings Store
 *
 * Manages user preferences for macOS keychain access during git operations.
 * Persists settings via settings:get/settings:set IPC channels.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('KeychainSettingsStore');

// Storage key for persisting settings
const STORAGE_KEY = 'keychainSettings';

/**
 * User's choice for handling keychain access
 */
export type KeychainAccessChoice = 'ask' | 'allow' | 'deny';

/**
 * Keychain settings interface
 */
export interface KeychainSettings {
  /** How to handle keychain access prompts: 'ask' shows modal, 'allow' proceeds, 'deny' blocks */
  keychainAccessChoice: KeychainAccessChoice;
  /** Timestamp when the choice was made (for potential expiry) */
  choiceTimestamp: number | null;
  /** Whether user has seen the initial explanation */
  hasSeenExplanation: boolean;
}

/**
 * Default settings - always ask by default
 */
const DEFAULT_SETTINGS: KeychainSettings = {
  keychainAccessChoice: 'ask',
  choiceTimestamp: null,
  hasSeenExplanation: false,
};

class KeychainSettingsStore {
  // State
  keychainAccessChoice = $state<KeychainAccessChoice>(DEFAULT_SETTINGS.keychainAccessChoice);
  choiceTimestamp = $state<number | null>(DEFAULT_SETTINGS.choiceTimestamp);
  hasSeenExplanation = $state<boolean>(DEFAULT_SETTINGS.hasSeenExplanation);
  private initialized = $state<boolean>(false);

  constructor() {
    this.load();
  }

  /**
   * Load settings from IPC
   */
  private async load() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const result = await window.electronAPI.invoke('settings:get', { key: STORAGE_KEY });
        if (result?.success && result.data) {
          const parsed: KeychainSettings = result.data;
          this.keychainAccessChoice = parsed.keychainAccessChoice ?? DEFAULT_SETTINGS.keychainAccessChoice;
          this.choiceTimestamp = parsed.choiceTimestamp ?? DEFAULT_SETTINGS.choiceTimestamp;
          this.hasSeenExplanation = parsed.hasSeenExplanation ?? DEFAULT_SETTINGS.hasSeenExplanation;
          logger.debug('Loaded keychain settings:', {
            keychainAccessChoice: this.keychainAccessChoice,
            hasSeenExplanation: this.hasSeenExplanation,
          });
        }
        this.initialized = true;
      }
    } catch (error) {
      logger.error('Failed to load keychain settings:', error);
      this.initialized = true;
    }
  }

  /**
   * Save settings to IPC
   */
  private async save() {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const settings: KeychainSettings = {
          keychainAccessChoice: this.keychainAccessChoice,
          choiceTimestamp: this.choiceTimestamp,
          hasSeenExplanation: this.hasSeenExplanation,
        };
        await window.electronAPI.invoke('settings:set', { key: STORAGE_KEY, value: settings });
        logger.debug('Saved keychain settings');
      }
    } catch (error) {
      logger.error('Failed to save keychain settings:', error);
    }
  }

  /**
   * Check if we should show the keychain warning modal
   */
  shouldShowWarning(): boolean {
    return this.keychainAccessChoice === 'ask';
  }

  /**
   * Check if keychain access is allowed (user chose to always allow)
   */
  isKeychainAccessAllowed(): boolean {
    return this.keychainAccessChoice === 'allow';
  }

  /**
   * Check if keychain access is denied (user chose to always deny)
   */
  isKeychainAccessDenied(): boolean {
    return this.keychainAccessChoice === 'deny';
  }

  /**
   * Set the user's choice for keychain access
   */
  setKeychainAccessChoice(choice: KeychainAccessChoice, remember: boolean = false) {
    logger.debug('Setting keychain access choice:', { choice, remember });
    if (remember) {
      this.keychainAccessChoice = choice;
      this.choiceTimestamp = Date.now();
    } else {
      // If not remembering, keep the 'ask' setting but mark explanation as seen
      this.keychainAccessChoice = 'ask';
    }
    this.hasSeenExplanation = true;
    this.save();
  }

  /**
   * Mark that user has seen the explanation (without making a permanent choice)
   */
  markExplanationSeen() {
    this.hasSeenExplanation = true;
    this.save();
  }

  /**
   * Reset to always ask
   */
  resetToAsk() {
    logger.debug('Resetting keychain settings to ask');
    this.keychainAccessChoice = 'ask';
    this.choiceTimestamp = null;
    this.save();
  }

  /**
   * Reset all settings to defaults
   */
  reset() {
    logger.debug('Resetting keychain settings to defaults');
    this.keychainAccessChoice = DEFAULT_SETTINGS.keychainAccessChoice;
    this.choiceTimestamp = DEFAULT_SETTINGS.choiceTimestamp;
    this.hasSeenExplanation = DEFAULT_SETTINGS.hasSeenExplanation;
    this.save();
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInit(): Promise<void> {
    if (this.initialized) return;
    // Poll until initialized
    return new Promise((resolve) => {
      const check = () => {
        if (this.initialized) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }
}

// Create singleton instance
export const keychainSettingsStore = new KeychainSettingsStore();
