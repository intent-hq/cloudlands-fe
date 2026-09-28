/**
 * Playwright 1.63's install-deps --dry-run simulates apt installation and reports
 * missing packages (exit 1), or an installed system (exit 0). Parse that contract
 * strictly before filtering fonts: CT uses its bundled Inter font, and fetching
 * system fonts exhausted the CI install budget (intent-hq/intent#4723).
 */
const DEBIAN_PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]+$/;
const FONT_PACKAGE = /^x?fonts-/;

export function parseInstallDepsDryRun(output, exitCode) {
  const text = String(output).trim();
  if (exitCode === 0 && text === 'All system dependencies are installed.') return [];
  const [header, ...lines] = text.split(/\r?\n/);
  const count = header.match(/^Missing system dependencies \(([1-9][0-9]*)\):$/)?.[1];
  const packages = lines.map((line) => line.trim());
  if (
    exitCode !== 1 ||
    !count ||
    Number(count) !== packages.length ||
    new Set(packages).size !== packages.length ||
    packages.some((pkg) => !DEBIAN_PACKAGE_NAME.test(pkg))
  ) {
    throw new Error(`Unexpected install-deps --dry-run result (exit ${exitCode}): ${text}`);
  }
  return packages;
}

export function withoutFontPackages(packages) {
  return [...new Set(packages.filter((pkg) => !FONT_PACKAGE.test(pkg)))].sort();
}

export function nonFontPackagesFromDryRun(output, exitCode) {
  return withoutFontPackages(parseInstallDepsDryRun(output, exitCode));
}
