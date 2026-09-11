/**
 * Parse `playwright install-deps --dry-run` output into a package list.
 *
 * Playwright has no flag to skip fonts in `install-deps`, but its dry run
 * prints the exact apt command it would execute, e.g.
 *
 *   sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libnss3 ... fonts-liberation"
 *
 * CI derives the Chromium OS dependency list from that line and drops the
 * font packages: the CT harness uses the repo-bundled Inter Variable font,
 * and fetching the fonts-… / xfonts-… packages alone blew the install step's
 * budget on gh-linux-8x (intent-hq/intent#4723). The parse is deliberately strict —
 * exactly one `apt-get install` command, no other output, only valid Debian
 * package names — so a future output-format change fails loudly instead of
 * silently yielding a partial list.
 */

const APT_INSTALL = /\bapt-get install\b/;
// Debian policy §5.6.1: lowercase alphanumerics, plus, minus, period; ≥2 chars.
const DEBIAN_PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]+$/;
const FONT_PACKAGE = /^x?fonts-/;

export function parseInstallDepsDryRun(output) {
  const lines = String(output)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const installLines = lines.filter((line) => APT_INSTALL.test(line));
  if (installLines.length !== 1) {
    throw new Error(
      `expected exactly one apt-get install command in install-deps --dry-run output, found ${installLines.length}`,
    );
  }
  if (lines.length !== 1) {
    const extra = lines.filter((line) => line !== installLines[0]);
    throw new Error(`unexpected extra install-deps --dry-run output: ${JSON.stringify(extra)}`);
  }

  const [line] = installLines;
  const tail = line
    .slice(line.search(APT_INSTALL) + 'apt-get install'.length)
    .trim()
    .replace(/"$/, '');
  const packages = tail.split(/\s+/).filter((token) => token !== '' && !token.startsWith('-'));
  if (packages.length === 0) {
    throw new Error('no packages found after apt-get install in install-deps --dry-run output');
  }
  const invalid = packages.filter((pkg) => !DEBIAN_PACKAGE_NAME.test(pkg));
  if (invalid.length > 0) {
    throw new Error(
      `unexpected tokens in install-deps --dry-run package list: ${JSON.stringify(invalid)}`,
    );
  }
  return packages;
}

export function withoutFontPackages(packages) {
  return [...new Set(packages.filter((pkg) => !FONT_PACKAGE.test(pkg)))].sort();
}

export function nonFontPackagesFromDryRun(output) {
  return withoutFontPackages(parseInstallDepsDryRun(output));
}
