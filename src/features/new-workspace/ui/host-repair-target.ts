import { m } from '$shared/paraglide/messages.js';
import type { DaemonHostRepairTarget } from '$store/renderer/slices/daemon-health/daemon-health-types';

export function formatDaemonHostRepairTarget(host?: DaemonHostRepairTarget): string {
  if (!host) return m.newWorkspace_capabilities_defaultHost_label();

  const isArm = host.arch === 'aarch64' || host.arch === 'arm64';
  const isX64 = host.arch === 'x86_64' || host.arch === 'x64';
  if (host.os === 'macos' && isArm) return m.newWorkspace_capabilities_hostMacAppleSilicon_label();
  if (host.os === 'macos' && isX64) return m.newWorkspace_capabilities_hostMacIntel_label();
  if (host.os === 'windows' && isArm) return m.newWorkspace_capabilities_hostWindowsArm64_label();
  if (host.os === 'windows' && isX64) return m.newWorkspace_capabilities_hostWindowsX64_label();
  if (host.os === 'linux' && isArm) return m.newWorkspace_capabilities_hostLinuxArm64_label();
  if (host.os === 'linux' && isX64) return m.newWorkspace_capabilities_hostLinuxX64_label();
  return m.newWorkspace_capabilities_hostGeneric_label({ os: host.os, arch: host.arch });
}
