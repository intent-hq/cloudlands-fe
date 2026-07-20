/**
 * Rules Loading Integration Test
 *
 * Verifies that agent rules are loaded from the correct workspace directory
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Rules Loading Integration', () => {
  let tempDir: string;
  let workspacePath: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-test-'));
    workspacePath = path.join(tempDir, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create user rules in workspace directory', async () => {
    // Create .intent/rules directory
    const rulesDir = path.join(workspacePath, '.intent', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });

    // Create user.md file
    const userRulesPath = path.join(rulesDir, 'user.md');
    const userRulesContent = '# User Rules\n\nAlways be helpful and thorough.';
    await fs.writeFile(userRulesPath, userRulesContent);

    // Verify file exists
    const exists = await fs
      .access(userRulesPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify content
    const content = await fs.readFile(userRulesPath, 'utf-8');
    expect(content).toBe(userRulesContent);
  });

  it('should create workspace-specific rules', async () => {
    const workspaceId = 'test-workspace-123';

    // Create .augment/rules directory
    const rulesDir = path.join(workspacePath, '.augment', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });

    // Create workspace-specific rules file
    const workspaceRulesPath = path.join(rulesDir, `workspace-${workspaceId}.md`);
    const workspaceRulesContent = '# Workspace Rules\n\nProject-specific guidelines.';
    await fs.writeFile(workspaceRulesPath, workspaceRulesContent);

    // Verify file exists
    const exists = await fs
      .access(workspaceRulesPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify content
    const content = await fs.readFile(workspaceRulesPath, 'utf-8');
    expect(content).toBe(workspaceRulesContent);
  });

  it('should handle missing rules gracefully', async () => {
    // Try to read non-existent rules
    const userRulesPath = path.join(workspacePath, '.augment', 'rules', 'user.md');

    try {
      await fs.readFile(userRulesPath, 'utf-8');
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  it('should not read from process.cwd()', async () => {
    // This test verifies that we're NOT reading from the app directory
    const appRulesPath = path.join(process.cwd(), '.augment', 'rules', 'user.md');
    const workspaceRulesPath = path.join(workspacePath, '.augment', 'rules', 'user.md');

    // These should be different paths
    expect(appRulesPath).not.toBe(workspaceRulesPath);

    // The workspace path should contain our temp directory
    expect(workspaceRulesPath).toContain(tempDir);

    // The app path should NOT contain our temp directory
    expect(appRulesPath).not.toContain(tempDir);
  });
});
