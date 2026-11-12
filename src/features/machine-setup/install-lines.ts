import type { MachineSetupTarget } from '$shared/types/machine-setup';

// i18n-ignore (URL)
const RELEASE_URL = 'https://github.com/intent-hq/intentd-releases/releases/download/sitter-latest';

/**
 * The one-line install for macOS and Linux: sets intentd up as a service and
 * ends by printing an intent:// link (a backend pairs; a node prints its
 * node link).
 */
export function unixInstallCommand(target: MachineSetupTarget): string {
  const mode = target === 'node' ? 'INTENTD_DAEMON_MODE=node' : 'INTENTD_PAIR=1';
  return `curl -fsSL ${RELEASE_URL}/install.sh | INTENTD_INSTALL_SERVICE=1 ${mode} sh`; // i18n-ignore (shell command)
}

/** The same install for Windows PowerShell. */
export function windowsInstallCommand(target: MachineSetupTarget): string {
  const mode = target === 'node' ? "$env:INTENTD_DAEMON_MODE='node'" : "$env:INTENTD_PAIR='1'";
  return `$env:INTENTD_INSTALL_SERVICE='1'; ${mode}; irm ${RELEASE_URL}/install.ps1 | iex`; // i18n-ignore (shell command)
}

/** Keeps a Linux user service running after logout (needs sudo). */
export function lingerCommand(user: string): string {
  return `sudo loginctl enable-linger ${user}`; // i18n-ignore (shell command)
}
