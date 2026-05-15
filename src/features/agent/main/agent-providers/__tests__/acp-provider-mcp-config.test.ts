/**
 * MCP Configuration Tests for ACPProvider
 *
 * These tests validate that the MCP server configuration is correct,
 * including file paths, extensions, and configuration structure.
 *
 * These tests are lightweight and don't start actual agent processes,
 * making them fast and suitable for CI/CD pipelines.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('ACPProvider MCP Configuration', () => {
  // Helper to get the project root (where package.json is)
  const getProjectRoot = () => {
    // When running tests, we're in the source directory
    // Find the project root by looking for package.json
    let currentDir = __dirname;
    while (currentDir !== path.dirname(currentDir)) {
      if (fs.existsSync(path.join(currentDir, 'package.json'))) {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
    throw new Error('Could not find project root');
  };

  describe('MCP Server File Validation', () => {
    it('should have mcp-stdio-server.cjs in dist/main after build', () => {
      // This test validates the build output
      const projectRoot = getProjectRoot();
      const mcpServerPath = path.join(projectRoot, 'dist', 'main', 'mcp-stdio-server.cjs');

      expect(fs.existsSync(mcpServerPath)).toBe(true);
    });

    it('should NOT have mcp-stdio-server.js in dist/main', () => {
      // This ensures we're not accidentally building with wrong extension
      const projectRoot = getProjectRoot();
      const wrongPath = path.join(projectRoot, 'dist', 'main', 'mcp-stdio-server.js');

      expect(fs.existsSync(wrongPath)).toBe(false);
    });

    it('should NOT have mcp-stdio-server.mjs in dist/main', () => {
      // This ensures we're not accidentally building with wrong extension
      const projectRoot = getProjectRoot();
      const wrongPath = path.join(projectRoot, 'dist', 'main', 'mcp-stdio-server.mjs');

      expect(fs.existsSync(wrongPath)).toBe(false);
    });

    it('should be a regular file, not a directory', () => {
      const projectRoot = getProjectRoot();
      const mcpServerPath = path.join(projectRoot, 'dist', 'main', 'mcp-stdio-server.cjs');

      const stat = fs.statSync(mcpServerPath);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
    });

    it('should have correct file extension (.cjs not .js or .mjs)', () => {
      const projectRoot = getProjectRoot();
      const mcpServerPath = path.join(projectRoot, 'dist', 'main', 'mcp-stdio-server.cjs');

      // Verify the path ends with .cjs
      expect(mcpServerPath).toMatch(/\.cjs$/);
      expect(mcpServerPath).not.toMatch(/\.js$/);
      expect(mcpServerPath).not.toMatch(/\.mjs$/);
    });
  });
});
