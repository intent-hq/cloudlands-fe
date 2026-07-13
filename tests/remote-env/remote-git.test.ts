/**
 * Remote Git Operations Test Suite
 *
 * Tests git operations over SSH against remote environments.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'ssh2';
import { RemoteEnvProfile, getProfileOrThrow } from './remote-env-config';

const PROFILE_NAME = process.env.REMOTE_ENV_PROFILE || 'standard';
const profile = getProfileOrThrow(PROFILE_NAME);

async function execCommand(
  client: Client,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => (stdout += data.toString()));
      stream.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
      stream.on('close', (code: number) => resolve({ stdout, stderr, code }));
    });
  });
}

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

describe(`Remote Git Tests - ${profile.name}`, () => {
  let client: Client;
  const testRepoPath = profile.testRepoPath;
  const testBranch = `test-branch-${Date.now()}`;

  beforeAll(async () => {
    client = await connect(profile);
  }, 30000);

  afterAll(async () => {
    // Cleanup test branch
    await execCommand(client, `cd ${testRepoPath} && git checkout main 2>/dev/null || true`);
    await execCommand(client, `cd ${testRepoPath} && git branch -D ${testBranch} 2>/dev/null || true`);
    client?.end();
  });

  describe('Repository Status', () => {
    it('should access test repository', async () => {
      const result = await execCommand(client, `cd ${testRepoPath} && pwd`);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(testRepoPath);
    });

    it('should get git status', async () => {
      const result = await execCommand(client, `cd ${testRepoPath} && git status --porcelain`);
      expect(result.code).toBe(0);
    });

    it('should get current branch', async () => {
      const result = await execCommand(client, `cd ${testRepoPath} && git branch --show-current`);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('main');
    });

    it('should get git log', async () => {
      const result = await execCommand(
        client,
        `cd ${testRepoPath} && git log --oneline -n 5`,
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Initial commit');
    });
  });

  describe('Branch Operations', () => {
    it('should create a new branch', async () => {
      const result = await execCommand(
        client,
        `cd ${testRepoPath} && git checkout -b ${testBranch}`,
      );
      expect(result.code).toBe(0);
    });

    it('should list branches', async () => {
      const result = await execCommand(client, `cd ${testRepoPath} && git branch`);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(testBranch);
    });

    it('should switch branches', async () => {
      await execCommand(client, `cd ${testRepoPath} && git checkout main`);
      const result = await execCommand(client, `cd ${testRepoPath} && git branch --show-current`);
      expect(result.stdout.trim()).toBe('main');

      await execCommand(client, `cd ${testRepoPath} && git checkout ${testBranch}`);
      const result2 = await execCommand(client, `cd ${testRepoPath} && git branch --show-current`);
      expect(result2.stdout.trim()).toBe(testBranch);
    });
  });

  describe('File Changes', () => {
    const testFile = 'test-file.txt';

    it('should stage new files', async () => {
      await execCommand(client, `cd ${testRepoPath} && echo "test content" > ${testFile}`);
      const result = await execCommand(client, `cd ${testRepoPath} && git add ${testFile}`);
      expect(result.code).toBe(0);

      const status = await execCommand(client, `cd ${testRepoPath} && git status --porcelain`);
      expect(status.stdout).toContain(`A  ${testFile}`);
    });

    it('should commit changes', async () => {
      const result = await execCommand(
        client,
        `cd ${testRepoPath} && git commit -m "Test commit from remote tests"`,
      );
      expect(result.code).toBe(0);

      const log = await execCommand(client, `cd ${testRepoPath} && git log --oneline -n 1`);
      expect(log.stdout).toContain('Test commit');
    });

    it('should show diff', async () => {
      await execCommand(client, `cd ${testRepoPath} && echo "modified" >> ${testFile}`);
      const result = await execCommand(client, `cd ${testRepoPath} && git diff`);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('modified');

      // Reset for next tests
      await execCommand(client, `cd ${testRepoPath} && git checkout -- ${testFile}`);
    });
  });
});
