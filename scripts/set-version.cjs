/**
 * Sets the package version to an exact version number.
 * Usage: node scripts/set-version.cjs <version>
 * Example: node scripts/set-version.cjs 1.2.3
 */

const fs = require('fs');
const path = require('path');

// Filter out '--' separator that some package managers pass
const args = process.argv.slice(2).filter(arg => arg !== '--');
const version = args[0];

if (!version) {
  console.error('Error: Version argument is required');
  console.error('Usage: node scripts/set-version.cjs <version>');
  console.error('Example: node scripts/set-version.cjs 1.2.3');
  process.exit(1);
}

// Validate semver format (basic validation)
const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
if (!semverRegex.test(version)) {
  console.error(`Error: Invalid version format "${version}"`);
  console.error('Version must be in semver format: MAJOR.MINOR.PATCH[-prerelease][+build]');
  console.error('Examples: 1.2.3, 1.2.3-beta.1, 1.2.3-alpha+build.123');
  process.exit(1);
}

const packageJsonPath = path.join(__dirname, '..', 'package.json');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const oldVersion = packageJson.version;

// Update version
packageJson.version = version;

// Write package.json with proper formatting
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`Version updated: ${oldVersion} → ${version}`);

// Run sync-sentry-release.cjs
const syncSentryPath = path.join(__dirname, 'sync-sentry-release.cjs');
if (fs.existsSync(syncSentryPath)) {
  require(syncSentryPath);
}
