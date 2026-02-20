/**
 * Tests for Configuration Parser
 */

const { ConfigParser } = require('../lib/parser/config-parser');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('ConfigParser', () => {
  let parser;
  let tempDir;

  beforeEach(async () => {
    parser = new ConfigParser();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parser-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parse', () => {
    it('should parse a simple configuration', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, `
title: "Test Wave"
description: "Test description"
packages:
  - id: "task1"
    name: "Task One"
    description: "First task"
`);

      const config = await parser.parse(configPath);

      expect(config.title).toBe('Test Wave');
      expect(config.description).toBe('Test description');
      expect(config.packages).toHaveLength(1);
      expect(config.packages[0].id).toBe('task1');
    });

    it('should apply default values', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, `
title: "Test"
description: "Test"
packages:
  - id: "task1"
`);

      const config = await parser.parse(configPath);

      expect(config.config.maxParallel).toBe(4);
      expect(config.config.timeoutMinutes).toBe(30);
      expect(config.config.autoRetry).toBe(true);
      expect(config.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should handle dependencies', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, `
title: "Test"
description: "Test"
packages:
  - id: "task1"
    name: "Task One"
  - id: "task2"
    name: "Task Two"
    dependencies: ["task1"]
`);

      const config = await parser.parse(configPath);

      expect(config.packages[1].dependencies).toEqual(['task1']);
    });

    it('should resolve variables', async () => {
      const configPath = path.join(tempDir, 'config.yaml');
      await fs.writeFile(configPath, `
title: "Test {date}"
description: "Test"
variables:
  myvar: "hello"
packages:
  - id: "task1"
    description: "Say {myvar}"
`);

      const config = await parser.parse(configPath);

      expect(config.packages[0].description).toBe('Say hello');
      expect(config.title).toContain('Test 20'); // Should have date
    });
  });

  describe('validate', () => {
    it('should validate required fields', () => {
      const result = parser.validate({});

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required field: title');
      expect(result.errors).toContain('No packages defined');
    });

    it('should detect duplicate package IDs', () => {
      const result = parser.validate({
        title: 'Test',
        packages: [
          { id: 'task1' },
          { id: 'task1' }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate package ID: task1');
    });

    it('should detect invalid dependencies', () => {
      const result = parser.validate({
        title: 'Test',
        packages: [
          { id: 'task1', dependencies: ['task2'] }
        ]
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Package task1 has unknown dependency: task2');
    });

    it('should validate config values', () => {
      const result = parser.validate({
        title: 'Test',
        packages: [{ id: 'task1' }],
        config: {
          maxParallel: 0,
          timeoutMinutes: -1
        }
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('maxParallel must be at least 1');
      expect(result.errors).toContain('timeoutMinutes must be at least 1');
    });
  });
});
