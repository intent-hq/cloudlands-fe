#!/usr/bin/env node
/**
 * Patches the Electron binary's Info.plist to show "Intent [Dev]" in the macOS dock
 * during development instead of "Electron".
 *
 * This only affects macOS and only modifies the local node_modules copy.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APP_NAME = 'Intent [Dev]';

// Find the Electron app path
function getElectronAppPath() {
  try {
    // Get the path to the electron binary
    const electronPath = join(__dirname, '../node_modules/electron/dist/Electron.app');
    if (existsSync(electronPath)) {
      return electronPath;
    }

    // Try the parent node_modules (in case of hoisting)
    const hoistedPath = join(__dirname, '../../../node_modules/electron/dist/Electron.app');
    if (existsSync(hoistedPath)) {
      return hoistedPath;
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

function patchInfoPlist() {
  if (process.platform !== 'darwin') {
    console.log('Skipping Electron name patch (not macOS)');
    return;
  }

  const electronAppPath = getElectronAppPath();
  if (!electronAppPath) {
    console.log('Could not find Electron.app, skipping name patch');
    return;
  }

  const plistPath = join(electronAppPath, 'Contents/Info.plist');
  if (!existsSync(plistPath)) {
    console.log('Could not find Info.plist, skipping name patch');
    return;
  }

  try {
    let content = readFileSync(plistPath, 'utf-8');

    // Check if already patched
    if (content.includes(APP_NAME)) {
      console.log(`Electron already patched to show "${APP_NAME}"`);
      return;
    }

    // Replace CFBundleName
    content = content.replace(
      /<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/,
      `<key>CFBundleName</key>\n\t<string>${APP_NAME}</string>`,
    );

    // Replace CFBundleDisplayName if present, otherwise add it
    if (content.includes('CFBundleDisplayName')) {
      content = content.replace(
        /<key>CFBundleDisplayName<\/key>\s*<string>[^<]+<\/string>/,
        `<key>CFBundleDisplayName</key>\n\t<string>${APP_NAME}</string>`,
      );
    }

    writeFileSync(plistPath, content);

    // Clear the launch services cache to pick up the change
    try {
      execSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user', { stdio: 'ignore' });
    } catch (e) {
      // Ignore - this is optional
    }

    console.log(`✓ Patched Electron to show "${APP_NAME}" in dock`);
  } catch (error) {
    console.error('Failed to patch Electron Info.plist:', error.message);
  }
}

patchInfoPlist();
