#!/usr/bin/env node
/**
 * macOS Notarization Script for Electron Builder
 *
 * This script is called by electron-builder after signing.
 * It submits the app to Apple for notarization using Apple ID credentials.
 *
 * Required environment variables:
 * - CLOUDLANDS_APPLE_ID: Your Apple ID email
 * - CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD: App-specific password from appleid.apple.com
 * - CLOUDLANDS_APPLE_TEAM_ID: Your 10-character Team ID
 *
 * (Legacy APPLE_* names without CLOUDLANDS_ prefix are also supported for backward compatibility)
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

export async function notarizing(context) {
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
  // Support both CLOUDLANDS_* (new) and bare APPLE_* (legacy) for compatibility
  const appleId = process.env.CLOUDLANDS_APPLE_ID || process.env.APPLE_ID;
  const appleIdPassword = process.env.CLOUDLANDS_APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
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
    console.log('Notarization complete!');
  } catch (error) {
    console.error('Notarization failed:', error);
    throw error;
  }
}

// Default export for electron-builder afterSign hook
export default notarizing;
