/**
 * Remote Environment Test Configuration
 *
 * Defines profiles and configurations for testing against various
 * SSH-based remote development environments.
 */

export interface RemoteEnvProfile {
  name: string;
  description: string;
  host: string;
  port: number;
  username: string;
  password: string;
  /** Expected characteristics of this environment */
  characteristics: {
    hasNodejs: boolean;
    hasPython: boolean;
    hasGit: boolean;
    /** Non-standard SSH port (like DevPod's 22022) */
    nonStandardPort: boolean;
    /** Home directory persists across reboots */
    persistentHome: boolean;
    /** System changes persist across reboots */
    persistentSystem: boolean;
    /** Has pod-init.d style boot scripts */
    hasBootScripts: boolean;
    /** Shared user (not per-user like DevPod's 'augment') */
    sharedUser: boolean;
  };
  /** Path to test repository on remote */
  testRepoPath: string;
}

/** Standard SSH environment - typical setup */
export const STANDARD_PROFILE: RemoteEnvProfile = {
  name: 'standard',
  description: 'Standard SSH environment with typical configuration',
  host: 'localhost',
  port: 2222,
  username: 'testuser',
  password: 'testuser', // pragma: allowlist secret
  characteristics: {
    hasNodejs: true,
    hasPython: true,
    hasGit: true,
    nonStandardPort: false, // 2222 is just port mapping, actual is 22
    persistentHome: true,
    persistentSystem: true,
    hasBootScripts: false,
    sharedUser: false,
  },
  testRepoPath: '/home/testuser/repos/test-repo',
};

/** DevPod-like environment - simulates Augment's DevPod setup */
export const DEVPOD_PROFILE: RemoteEnvProfile = {
  name: 'devpod',
  description: 'DevPod-like environment (non-standard port, shared user, ephemeral system)',
  host: 'localhost',
  port: 22022,
  username: 'augment',
  password: 'augment', // pragma: allowlist secret
  characteristics: {
    hasNodejs: true,
    hasPython: true,
    hasGit: true,
    nonStandardPort: true,
    persistentHome: true,
    persistentSystem: false, // System resets on reboot
    hasBootScripts: true, // pod-init.d
    sharedUser: true, // All users share 'augment'
  },
  testRepoPath: '/home/augment/repos/test-repo',
};

/** Minimal environment - tests graceful degradation */
export const MINIMAL_PROFILE: RemoteEnvProfile = {
  name: 'minimal',
  description: 'Minimal environment without common dev tools',
  host: 'localhost',
  port: 2223,
  username: 'minuser',
  password: 'minuser', // pragma: allowlist secret
  characteristics: {
    hasNodejs: false,
    hasPython: false,
    hasGit: true, // Git is always needed
    nonStandardPort: false,
    persistentHome: true,
    persistentSystem: true,
    hasBootScripts: false,
    sharedUser: false,
  },
  testRepoPath: '/home/minuser/repos/test-repo',
};

export const ALL_PROFILES: RemoteEnvProfile[] = [
  STANDARD_PROFILE,
  DEVPOD_PROFILE,
  MINIMAL_PROFILE,
];

export function getProfile(name: string): RemoteEnvProfile | undefined {
  return ALL_PROFILES.find((p) => p.name === name);
}

export function getProfileOrThrow(name: string): RemoteEnvProfile {
  const profile = getProfile(name);
  if (!profile) {
    throw new Error(`Unknown profile: ${name}. Available: ${ALL_PROFILES.map((p) => p.name).join(', ')}`);
  }
  return profile;
}
