#!/usr/bin/env node
/**
 * macOS Notarization Script for Electron Builder
 *
 * This script is called by electron-builder after signing.
 * It submits the app to Apple for notarization using Apple ID credentials.
 *
 * Required environment variables (CLOUDLANDS_* preferred, legacy APPLE_* also supported):
 * - CLOUDLANDS_APPLE_ID (or APPLE_ID): Your Apple ID email
 * - CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD (or APPLE_APP_SPECIFIC_PASSWORD): App-specific password from appleid.apple.com
 * - CLOUDLANDS_APPLE_TEAM_ID (or APPLE_TEAM_ID): Your 10-character Team ID
 *
 * To create an app-specific password:
 * 1. Go to https://appleid.apple.com/account/manage
 * 2. Sign in with your Apple ID
 * 3. Go to "App-Specific Passwords"
 * 4. Click "Generate an app-specific password"
 * 5. Use this password for CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD
 */

import { notarize } from '@electron/notarize';
import path from 'path';
import { runStaplerWithBackoff } from './apple-ticket-retry.mjs';

// @electron/notarize staples once, only after notarization succeeds (its promise-retry
// wrapper never retries: stapleApp does not call the retry callback). Apple's ticket
// service drops that connection (stapler exit 68, intent-hq/intent#7614), so that
// one failure continues with backoff, counting the library's try as attempt 1.
const STAPLE_CONNECTION_LOST = /^Failed to staple your application with code: 68(?!\d)/;

async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== 'darwin') {
    console.log('Skipping notarization - not a macOS build');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);

  // Get credentials from environment variables
  // Prefer CLOUDLANDS_* naming; fall back to legacy APPLE_* for backward compatibility
  const appleId = process.env.CLOUDLANDS_APPLE_ID || process.env.APPLE_ID;
  const appleIdPassword =
    process.env.CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.CLOUDLANDS_APPLE_TEAM_ID || process.env.APPLE_TEAM_ID;

  // Validate we have what we need
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization - missing credentials');
    console.log('');
    console.log('To enable notarization, set these environment variables:');
    console.log('  export CLOUDLANDS_APPLE_ID="your-apple-id@example.com"');
    console.log('  export CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD=""');
    console.log('  export CLOUDLANDS_APPLE_TEAM_ID=""');
    console.log('');
    console.log('(Legacy APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID are also supported)');
    console.log('');
    console.log('Get app-specific password at: https://appleid.apple.com/account/manage');
    return;
  }

  try {
    console.log(`Notarizing with Apple ID: ${appleId}...`);
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
  } catch (error) {
    if (!STAPLE_CONNECTION_LOST.test(error?.message ?? '')) {
      console.error('Notarization failed:', error);
      throw error;
    }
    console.warn('Notarized, but stapling lost its connection to Apple; retrying with backoff.');
    try {
      await runStaplerWithBackoff('staple', appPath, { afterFailure: true });
    } catch (stapleError) {
      console.error('Notarization failed:', stapleError);
      throw stapleError;
    }
  }
  console.log('Notarization complete!');
}

// Default export for electron-builder afterSign hook
export default notarizing;
