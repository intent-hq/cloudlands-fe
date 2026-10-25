'use strict';

// Manual Signed Build preflight for sign=true Windows requests. Runs on a small Linux
// job before the Windows runner is allocated, so absent Azure settings fail in seconds
// instead of after the sidecar and Vite builds (run 40143109068 spent ~11 min first).
// Only setting names are printed; secrets arrive as <NAME>_PRESENT=true|false.

const { appendFileSync } = require('node:fs');
const { WINDOWS_SIGNING_SECRETS, windowsSigningPreflight } = require('./windows-signing.cjs');

const FALLBACK =
  'Re-run with sign=false for an unsigned Windows build, or ask a repository admin to ' +
  'configure Azure Artifact Signing (see docs/fe/DEPLOYING.md, Manual Signed Build).';

function main(env = process.env, log = console.log) {
  const secretsPresent = Object.fromEntries(
    WINDOWS_SIGNING_SECRETS.map((name) => [name, env[`${name}_PRESENT`] === 'true']),
  );
  const { missing, invalid } = windowsSigningPreflight(env, { secretsPresent });
  const repo = env.GITHUB_REPOSITORY || 'this repository';
  if (!missing.length && !invalid) {
    log(
      `Azure signing settings are configured for ${repo}; continuing with a signed Windows build.`,
    );
    return 0;
  }
  const problems = missing.length
    ? missing.map((setting) => `Missing or blank ${setting}`)
    : [`${invalid}`];
  for (const problem of problems) log(`::error title=Windows signing not configured::${problem}`);
  log(
    `::error title=Windows signing not configured::Signed Windows builds are unavailable for ${repo}. ${FALLBACK}`,
  );
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      [
        '## Windows signing preflight',
        '',
        `❌ Signed Windows builds are unavailable for ${repo}:`,
        '',
        ...problems.map((problem) => `- ${problem}`),
        '',
        FALLBACK,
        '',
      ].join('\n'),
    );
  }
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
