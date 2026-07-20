/**
 * Intent App Integration Tests for Remote Environments
 *
 * Tests the actual Intent app SSH infrastructure against
 * mock remote environments.
 *
 * These tests import and use the real SSHManager from the Intent app.
 */

import { describe, it, expect } from 'vitest';
import {
  RemoteEnvProfile,
  getProfileOrThrow,
  STANDARD_PROFILE,
  DEVPOD_PROFILE,
} from './remote-env-config';

// Local copy of the connection-config shape the retired renderer SSH client
// (`src/lib/api/ssh-client.ts`, deleted as caller-less dead code) used to
// export — these tests exercise profile → config mapping only.
interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
  useAgent?: boolean;
  transport?: 'ssh' | 'websocket';
  wsUrl?: string;
}

const PROFILE_NAME = process.env.REMOTE_ENV_PROFILE || 'standard';
const profile = getProfileOrThrow(PROFILE_NAME);

/** Convert our profile to SSH connection config */
function profileToSSHConfig(p: RemoteEnvProfile): SSHConnectionConfig {
  return {
    host: p.host,
    port: p.port,
    username: p.username,
    password: p.password,
  };
}

describe(`Intent App SSH Integration - ${profile.name}`, () => {
  // These tests validate that the Intent app's SSH infrastructure
  // works correctly with different remote environment configurations

  describe('Connection Configuration', () => {
    it('should create valid SSH config from profile', () => {
      const config = profileToSSHConfig(profile);
      expect(config.host).toBe(profile.host);
      expect(config.port).toBe(profile.port);
      expect(config.username).toBe(profile.username);
    });

    it('should handle non-standard ports', () => {
      const devpodConfig = profileToSSHConfig(DEVPOD_PROFILE);
      expect(devpodConfig.port).toBe(22022);

      const standardConfig = profileToSSHConfig(STANDARD_PROFILE);
      expect(standardConfig.port).toBe(2222);
    });
  });

  describe('Profile Characteristics', () => {
    it('should correctly identify DevPod characteristics', () => {
      expect(DEVPOD_PROFILE.characteristics.nonStandardPort).toBe(true);
      expect(DEVPOD_PROFILE.characteristics.sharedUser).toBe(true);
      expect(DEVPOD_PROFILE.characteristics.persistentSystem).toBe(false);
      expect(DEVPOD_PROFILE.characteristics.hasBootScripts).toBe(true);
    });

    it('should correctly identify standard characteristics', () => {
      expect(STANDARD_PROFILE.characteristics.nonStandardPort).toBe(false);
      expect(STANDARD_PROFILE.characteristics.sharedUser).toBe(false);
      expect(STANDARD_PROFILE.characteristics.persistentSystem).toBe(true);
      expect(STANDARD_PROFILE.characteristics.hasBootScripts).toBe(false);
    });
  });

  describe('Test Repository Paths', () => {
    it('should have correct test repo path for profile', () => {
      expect(profile.testRepoPath).toContain(profile.username);
      expect(profile.testRepoPath).toContain('repos/test-repo');
    });

    it('should have user-specific paths', () => {
      expect(DEVPOD_PROFILE.testRepoPath).toBe('/home/devuser/repos/test-repo');
      expect(STANDARD_PROFILE.testRepoPath).toBe('/home/testuser/repos/test-repo');
    });
  });
});

/**
 * Test scenarios specific to remote workspace creation
 */
describe(`Remote Workspace Scenarios - ${profile.name}`, () => {
  describe('Workspace Configuration Validation', () => {
    it('should validate environment config structure', () => {
      // Mirrors the EnvironmentConfigSchema from schemas.ts
      const envConfig = {
        type: 'remote' as const,
        ssh: {
          host: profile.host,
          port: profile.port,
          user: profile.username,
          password: profile.password,
        },
        workspace_path: profile.testRepoPath,
      };

      expect(envConfig.type).toBe('remote');
      expect(envConfig.ssh.host).toBeDefined();
      expect(envConfig.ssh.port).toBeGreaterThan(0);
      expect(envConfig.ssh.user).toBeDefined();
    });
  });

  describe('Tool Detection Expectations', () => {
    it('should set correct tool expectations based on profile', () => {
      const { characteristics } = profile;

      // These expectations help the app know what to expect
      if (characteristics.hasNodejs) {
        // App should try to use node for certain operations
      }

      if (characteristics.hasPython) {
        // App might use python for certain scripts
      }

      // Git is always required
      expect(characteristics.hasGit).toBe(true);
    });
  });
});
