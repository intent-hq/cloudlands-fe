/**
 * Feature Codes Service (Main Process)
 *
 * Validates hashed feature codes and persists activated features in electron-store.
 * No plaintext codes appear in this source — only SHA-256 hashes.
 */

import { createHash } from 'crypto';
import { Logger } from '../../../shared/logger';

const logger = new Logger('FeatureCodesService');

/**
 * Registry mapping SHA-256(code) → featureId.
 * To add a new feature code, compute: node -e "console.log(require('crypto').createHash('sha256').update('your-code').digest('hex'))"
 * and add the hash here.
 */
const CODE_REGISTRY: ReadonlyMap<string, string> = new Map([
  // SHA-256 of the cortex activation code
  ['4c408969f8eddd59bad9e52c7680e7f787738d7cf368edb93048b21d86c83b70', 'cortex'],
  // SHA-256 of the remote-workspaces activation code
  ['ab86e93de0fec19bf005cbdcc44f55f8ae844bc173dd323b42c6e16de7b58e2d', 'remote-workspaces'],
  // SHA-256 of the ralph-agent activation code
  ['d6c49d67c698a30b76d2018c02c7a9df9b6a75d16b7be9209a14c7141cafe8a5', 'ralph-agent'],
  // SHA-256 of the enable_figma_mcp activation code
  ['6156f1c9c227f56ee98669b41a6a674a20f53ccb65b6fd9c55f2dc599a9733a1', 'enable_figma_mcp'],
]);

const STORE_KEY = 'featureCodes';

 
let settingsStore: any = null;
let initPromise: Promise<void> | null = null;

/** Set of currently activated feature IDs */
let activeFeatures: Set<string> = new Set();

/**
 * Initialize the feature codes service.
 * Loads persisted feature IDs from electron-store.
 */
async function init(): Promise<void> {
  if (settingsStore) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const ElectronStore = (await import('electron-store')).default;
      settingsStore = new ElectronStore({ name: 'settings' });

      const stored = settingsStore.get(STORE_KEY) as string[] | undefined;
      if (Array.isArray(stored)) {
        activeFeatures = new Set(stored);
      }
      logger.info('Feature codes service initialized', {
        activeFeatures: Array.from(activeFeatures),
      });
    } catch (error) {
      logger.error('Failed to initialize feature codes service', error as Error);
    }
  })();

  return initPromise;
}

/**
 * Persist the current set of active features to electron-store.
 */
function persist(): void {
  if (!settingsStore) {
    logger.warn('Settings store not initialized, cannot persist feature codes');
    return;
  }
  settingsStore.set(STORE_KEY, Array.from(activeFeatures));
}

/**
 * Hash a plaintext code with SHA-256 and return the hex digest.
 */
function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Check whether a feature is currently enabled.
 */
function isFeatureEnabled(featureId: string): boolean {
  return activeFeatures.has(featureId);
}

/**
 * Attempt to activate a feature code.
 * Hashes the input, looks it up in the registry, and persists if valid.
 */
function activateCode(code: string): {
  success: boolean;
  featureId?: string;
  alreadyActive?: boolean;
} {
  const hash = hashCode(code);
  const featureId = CODE_REGISTRY.get(hash);

  if (!featureId) {
    logger.debug('Invalid feature code attempted');
    return { success: false };
  }

  if (activeFeatures.has(featureId)) {
    logger.debug('Feature code already active', { featureId });
    return { success: true, featureId, alreadyActive: true };
  }

  activeFeatures.add(featureId);
  persist();
  logger.info('Feature activated', { featureId });
  return { success: true, featureId };
}

/**
 * Deactivate a single feature by its ID.
 * Returns true if the feature was active and has been removed, false otherwise.
 */
function deactivateFeature(featureId: string): boolean {
  if (!activeFeatures.has(featureId)) {
    return false;
  }
  activeFeatures.delete(featureId);
  persist();
  logger.info('Feature deactivated', { featureId });
  return true;
}

/**
 * Clear all activated feature codes and persist the empty state.
 */
function clearAllCodes(): void {
  activeFeatures.clear();
  persist();
  logger.info('All feature codes cleared');
}

/**
 * Get the list of currently active feature IDs.
 */
function getActiveFeatures(): string[] {
  return Array.from(activeFeatures);
}

/** Singleton feature codes service */
export const featureCodesService = {
  init,
  isFeatureEnabled,
  activateCode,
  deactivateFeature,
  clearAllCodes,
  getActiveFeatures,
};

