/**
 * Syncs the SENTRY_RELEASE in .env with the current package.json version.
 * Run this script after updating the version in package.json.
 */

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const envPath = path.join(__dirname, '..', '.env');

// Read the current version from package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const sentryRelease = `intent@${version}`;

// Read or create .env file
let envContent = '';
if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
}

// Update or add SENTRY_RELEASE
if (envContent.includes('SENTRY_RELEASE')) {
  envContent = envContent.replace(/SENTRY_RELEASE=.*/, `SENTRY_RELEASE="${sentryRelease}"`);
} else {
  envContent = envContent.trim() + `\nSENTRY_RELEASE="${sentryRelease}"\n`;
}

// Write updated .env
fs.writeFileSync(envPath, envContent);

console.log(`Updated SENTRY_RELEASE to ${sentryRelease}`);
