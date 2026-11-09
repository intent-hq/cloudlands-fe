const VERSION_TOKEN = /^v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)$/;

/**
 * The version number in a CLI's raw `--version` line (discovery `cliVersion`),
 * e.g. `2.1.303 (Claude Code)` → `2.1.303`. Undefined when no dotted version
 * appears, so unrecognized output is never shown as a version.
 */
export function displayCliVersion(raw: string | undefined): string | undefined {
  for (const token of raw?.trim().split(/\s+/) ?? []) {
    const match = VERSION_TOKEN.exec(token.replace(/^[(,]+|[),]+$/g, ''));
    if (match) return match[1];
  }
  return undefined;
}
