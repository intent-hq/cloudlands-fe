/**
 * Remote Environment Test Suite
 *
 * Tests the Intent app functionality against mock remote environments.
 * Can be run against different profiles (standard, devpod, minimal).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'ssh2';
import {
  RemoteEnvProfile,
  getProfileOrThrow,
  STANDARD_PROFILE,
  DEVPOD_PROFILE,
  MINIMAL_PROFILE,
} from './remote-env-config';

// Get profile from environment or default to standard
const PROFILE_NAME = process.env.REMOTE_ENV_PROFILE || 'standard';
const profile = getProfileOrThrow(PROFILE_NAME);

/** Helper to execute SSH command */
async function execCommand(
  client: Client,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      stream.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on('close', (code: number) => {
        resolve({ stdout, stderr, code });
      });
    });
  });
}

/** Helper to connect to remote environment */
async function connect(p: RemoteEnvProfile): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .connect({
        host: p.host,
        port: p.port,
        username: p.username,
        password: p.password,
        readyTimeout: 10000,
      });
  });
}

describe(`Remote Environment Tests - ${profile.name}`, () => {
  let client: Client;

  beforeAll(async () => {
    client = await connect(profile);
  }, 30000);

  afterAll(async () => {
    client?.end();
  });

  describe('Connection', () => {
    it('should connect successfully', () => {
      expect(client).toBeDefined();
    });

    it('should handle the configured port', async () => {
      const result = await execCommand(client, 'echo connected');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('connected');
    });
  });

  describe('Environment Detection', () => {
    it('should detect OS', async () => {
      const result = await execCommand(client, 'uname -s');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('Linux');
    });

    it('should have correct username', async () => {
      const result = await execCommand(client, 'whoami');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(profile.username);
    });

    it('should have correct home directory', async () => {
      const result = await execCommand(client, 'echo $HOME');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(`/home/${profile.username}`);
    });

    it('should have git available', async () => {
      const result = await execCommand(client, 'git --version');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('git version');
    });

    if (profile.characteristics.hasNodejs) {
      it('should have Node.js available', async () => {
        const result = await execCommand(client, 'node --version');
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toMatch(/^v\d+/);
      });
    }

    if (profile.characteristics.hasPython) {
      it('should have Python available', async () => {
        const result = await execCommand(client, 'python3 --version');
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Python');
      });
    }
  });

  describe('File Operations', () => {
    const testFile = `/tmp/remote-test-${Date.now()}.txt`;
    const testContent = 'Hello from remote environment test';

    it('should write files', async () => {
      const result = await execCommand(client, `echo "${testContent}" > ${testFile}`);
      expect(result.code).toBe(0);
    });

    it('should read files', async () => {
      const result = await execCommand(client, `cat ${testFile}`);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(testContent);
    });

    it('should delete files', async () => {
      const result = await execCommand(client, `rm ${testFile} && echo deleted`);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('deleted');
    });
  });
});
