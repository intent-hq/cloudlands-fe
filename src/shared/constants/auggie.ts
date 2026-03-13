/**
 * Auggie CLI Constants
 *
 * Shared constants for the Auggie CLI integration.
 * These are used by both the main process and the renderer.
 */

/**
 * Minimum required version of the auggie CLI.
 * Update this when new required features are added to auggie.
 *
 * The version check ignores prerelease suffixes, so 0.13.0-beta.1
 * is treated as meeting the 0.13.0 requirement.
 */
export const MINIMUM_AUGGIE_VERSION = '0.13.0';

/**
 * Minimum required version of Node.js.
 * Node.js 22+ is required for auggie CLI installation and operation.
 */
export const MINIMUM_NODE_VERSION = '22.0.0';

/**
 * Base URL for downloading pre-built auggie CLI binaries.
 * Binary assets are expected at: ${AUGGIE_BINARY_BASE_URL}/${assetName}
 */
export const AUGGIE_BINARY_BASE_URL = 'https://github.com/augmentcode/auggie/releases/latest/download';

/** Apple Team ID for verifying code-signed auggie binaries on macOS */
export const AUGGIE_APPLE_TEAM_ID = process.env.INTENT_APPLE_TEAM_ID || '';

/** Error types returned by the auggie install handler */
export type InstallErrorType = 'permission' | 'missing_npm' | 'node_too_old' | 'binary_download_failed' | 'unknown';
