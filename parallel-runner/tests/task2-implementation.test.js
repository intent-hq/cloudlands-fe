/**
 * Tests for Task 2 Implementation
 */

const { Task2Implementation } = require('../examples/task2-implementation');
const fs = require('fs').promises;
const path = require('path');

describe('Task2Implementation', () => {
  let task;
  const testLogDir = path.join(__dirname, 'test-logs');

  beforeEach(() => {
    task = new Task2Implementation({
      logDir: testLogDir,
      verbose: false
    });
  });

  afterEach(async () => {
    // Clean up test logs
    try {
      await fs.rm(testLogDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with correct properties', () => {
      expect(task.name).toBe('Second Task');
      expect(task.description).toBe('Do the second thing');
      expect(task.logDir).toBe(testLogDir);
      expect(task.verbose).toBe(false);
    });

    it('should use default values when no options provided', () => {
      const defaultTask = new Task2Implementation();
      expect(defaultTask.logDir).toBe('logs');
      expect(defaultTask.verbose).toBe(false);
    });
  });

  describe('validateEnvironment', () => {
    it('should create log directory if it does not exist', async () => {
      await task.validateEnvironment();

      const dirExists = await fs.access(testLogDir)
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it('should not throw error for missing optional files', async () => {
      await expect(task.validateEnvironment()).resolves.not.toThrow();
    });
  });

  describe('processData', () => {
    it('should return results with correct structure', async () => {
      const result = await task.processData();

      expect(result).toHaveProperty('operations');
      expect(result).toHaveProperty('summary');
      expect(Array.isArray(result.operations)).toBe(true);
      expect(result.operations).toHaveLength(4);
    });

    it('should complete all operations successfully', async () => {
      const result = await task.processData();

      result.operations.forEach(op => {
        expect(op.status).toBe('success');
        expect(op).toHaveProperty('operation');
        expect(op).toHaveProperty('timestamp');
      });
    });
  });

  describe('generateOutput', () => {
    it('should create output file with correct content', async () => {
      await fs.mkdir(testLogDir, { recursive: true });

      const testResult = {
        operations: [{ operation: 'test', status: 'success' }],
        summary: 'Test summary'
      };

      await task.generateOutput(testResult);

      const outputPath = path.join(testLogDir, 'task2-output.json');
      const content = await fs.readFile(outputPath, 'utf-8');
      const output = JSON.parse(content);

      expect(output.task).toBe('Second Task');
      expect(output.description).toBe('Do the second thing');
      expect(output.result).toEqual(testResult);
      expect(output).toHaveProperty('timestamp');
    });
  });

  describe('logCompletion', () => {
    it('should append to completion log', async () => {
      await fs.mkdir(testLogDir, { recursive: true });

      const result = { summary: 'Test completion' };
      await task.logCompletion(result);

      const logPath = path.join(testLogDir, 'task2-completion.log');
      const content = await fs.readFile(logPath, 'utf-8');

      expect(content).toContain('Task 2 completed: Test completion');
    });
  });

  describe('execute', () => {
    it('should complete successfully and return correct status', async () => {
      const result = await task.execute();

      expect(result.status).toBe('completed');
      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('timestamp');
    });

    it('should create all expected output files', async () => {
      await task.execute();

      const outputFile = path.join(testLogDir, 'task2-output.json');
      const logFile = path.join(testLogDir, 'task2-completion.log');

      const outputExists = await fs.access(outputFile)
        .then(() => true)
        .catch(() => false);
      const logExists = await fs.access(logFile)
        .then(() => true)
        .catch(() => false);

      expect(outputExists).toBe(true);
      expect(logExists).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      // Override processData to throw an error
      task.processData = async () => {
        throw new Error('Test error');
      };

      await expect(task.execute()).rejects.toThrow('Test error');
    });
  });
});
