/**
 * SSH Test Manager
 *
 * Provides utilities for testing SSH connections and remote machine setup.
 */

import { SSHManager, SSHConnectionConfig } from '../main/ssh-manager';
import { Logger } from '../../lib/utils/logger';
import * as path from 'path';

export interface SSHTestResult {
  success: boolean;
  message: string;
  details?: any;
  duration?: number;
  error?: string;
}

export interface SSHTestSuite {
  name: string;
  tests: SSHTest[];
}

export interface SSHTest {
  name: string;
  description: string;
  run: (connectionId: string, sshManager: SSHManager) => Promise<SSHTestResult>;
}

export class SSHTestManager {
  private logger: Logger;
  private sshManager: SSHManager;

  constructor(sshManager: SSHManager) {
    this.logger = new Logger({ category: 'SSHTestManager' });
    this.sshManager = sshManager;
  }

  /**
   * Test basic SSH connection
   */
  async testConnection(config: SSHConnectionConfig): Promise<SSHTestResult> {
    const startTime = Date.now();
    const testId = `test-${Date.now()}`;

    try {
      this.logger.info('Testing SSH connection', {
        host: config.host,
        username: config.username,
      });

      await this.sshManager.connect(testId, config);

      const duration = Date.now() - startTime;

      await this.sshManager.disconnect(testId);

      return {
        success: true,
        message: 'Successfully connected to SSH server',
        duration,
        details: {
          host: config.host,
          port: config.port,
          username: config.username,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('SSH connection test failed', error as Error, {
        host: config.host,
      });

      return {
        success: false,
        message: 'Failed to connect to SSH server',
        error: (error as Error).message,
        duration,
      };
    }
  }

  /**
   * Test command execution
   */
  async testCommandExecution(connectionId: string): Promise<SSHTestResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Testing command execution', { connectionId });

      const result = await this.sshManager.executeCommand(connectionId, 'echo "Hello from SSH"');

      const duration = Date.now() - startTime;

      if (result.exitCode === 0 && result.stdout.includes('Hello from SSH')) {
        return {
          success: true,
          message: 'Command execution successful',
          duration,
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          },
        };
      } else {
        return {
          success: false,
          message: 'Command execution failed',
          duration,
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          },
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Command execution test failed', error as Error);

      return {
        success: false,
        message: 'Failed to execute command',
        error: (error as Error).message,
        duration,
      };
    }
  }

  /**
   * Test system information retrieval
   */
  async testSystemInfo(connectionId: string): Promise<SSHTestResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Testing system info retrieval', { connectionId });

      const commands = [
        { name: 'OS', cmd: 'uname -a' },
        { name: 'Hostname', cmd: 'hostname' },
        { name: 'User', cmd: 'whoami' },
        { name: 'Home', cmd: 'echo $HOME' },
        { name: 'Shell', cmd: 'echo $SHELL' },
        { name: 'CPU', cmd: 'nproc' },
        { name: 'Memory', cmd: 'free -h | grep Mem' },
      ];

      const results: Record<string, string> = {};

      for (const { name, cmd } of commands) {
        try {
          const result = await this.sshManager.executeCommand(connectionId, cmd);
          results[name] = result.stdout.trim();
        } catch (error) {
          results[name] = `Error: ${error}`;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        message: 'System information retrieved',
        duration,
        details: results,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('System info test failed', error as Error);

      return {
        success: false,
        message: 'Failed to retrieve system information',
        error: (error as Error).message,
        duration,
      };
    }
  }

  /**
   * Test file operations
   */
  async testFileOperations(connectionId: string): Promise<SSHTestResult> {
    const startTime = Date.now();
    const testDir = `/tmp/ssh-test-${Date.now()}`;
    const testFile = path.join(testDir, 'test.txt');

    try {
      this.logger.info('Testing file operations', { connectionId });

      // Create directory
      await this.sshManager.executeCommand(connectionId, `mkdir -p ${testDir}`);

      // Write file
      await this.sshManager.executeCommand(connectionId, `echo "Test content" > ${testFile}`);

      // Read file
      const readResult = await this.sshManager.executeCommand(connectionId, `cat ${testFile}`);

      // Check if content matches
      const contentMatches = readResult.stdout.includes('Test content');

      // List directory
      const lsResult = await this.sshManager.executeCommand(connectionId, `ls -la ${testDir}`);

      // Cleanup
      await this.sshManager.executeCommand(connectionId, `rm -rf ${testDir}`);

      const duration = Date.now() - startTime;

      if (contentMatches) {
        return {
          success: true,
          message: 'File operations successful',
          duration,
          details: {
            directory: testDir,
            file: testFile,
            content: readResult.stdout,
            listing: lsResult.stdout,
          },
        };
      } else {
        return {
          success: false,
          message: 'File content mismatch',
          duration,
          details: {
            expected: 'Test content',
            actual: readResult.stdout,
          },
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('File operations test failed', error as Error);

      // Try to cleanup
      try {
        await this.sshManager.executeCommand(connectionId, `rm -rf ${testDir}`);
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        message: 'Failed to perform file operations',
        error: (error as Error).message,
        duration,
      };
    }
  }

  /**
   * Test Git availability and operations
   */
  async testGit(connectionId: string): Promise<SSHTestResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Testing Git availability', { connectionId });

      // Check if git is installed
      const gitVersionResult = await this.sshManager.executeCommand(connectionId, 'git --version');

      if (gitVersionResult.exitCode !== 0) {
        return {
          success: false,
          message: 'Git is not installed',
          duration: Date.now() - startTime,
          details: {
            stderr: gitVersionResult.stderr,
          },
        };
      }

      // Test git config
      const gitConfigResult = await this.sshManager.executeCommand(
        connectionId,
        'git config --global user.name && git config --global user.email',
      );

      const duration = Date.now() - startTime;

      return {
        success: true,
        message: 'Git is available',
        duration,
        details: {
          version: gitVersionResult.stdout.trim(),
          config: gitConfigResult.stdout.trim(),
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Git test failed', error as Error);

      return {
        success: false,
        message: 'Failed to test Git',
        error: (error as Error).message,
        duration,
      };
    }
  }

  /**
   * Test Node.js availability
   */
  async testNodeJS(connectionId: string): Promise<SSHTestResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Testing Node.js availability', { connectionId });

      const nodeVersionResult = await this.sshManager.executeCommand(
        connectionId,
        'node --version',
      );
      const npmVersionResult = await this.sshManager.executeCommand(connectionId, 'npm --version');

      const duration = Date.now() - startTime;

      if (nodeVersionResult.exitCode === 0 && npmVersionResult.exitCode === 0) {
        return {
          success: true,
          message: 'Node.js is available',
          duration,
          details: {
            nodeVersion: nodeVersionResult.stdout.trim(),
            npmVersion: npmVersionResult.stdout.trim(),
          },
        };
      } else {
        return {
          success: false,
          message: 'Node.js is not properly installed',
          duration,
          details: {
            nodeError: nodeVersionResult.stderr,
            npmError: npmVersionResult.stderr,
          },
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Node.js test failed', error as Error);

      return {
        success: false,
        message: 'Failed to test Node.js',
        error: (error as Error).message,
        duration,
      };
    }
  }

  /**
   * Run full test suite
   */
  async runFullTestSuite(config: SSHConnectionConfig): Promise<{
    connectionId: string;
    results: Record<string, SSHTestResult>;
    summary: {
      total: number;
      passed: number;
      failed: number;
      duration: number;
    };
  }> {
    const startTime = Date.now();
    const connectionId = `test-suite-${Date.now()}`;
    const results: Record<string, SSHTestResult> = {};

    try {
      // Connect
      this.logger.info('Starting full test suite', { host: config.host });
      await this.sshManager.connect(connectionId, config);

      // Run tests
      results['connection'] = await this.testConnection(config);
      results['commandExecution'] = await this.testCommandExecution(connectionId);
      results['systemInfo'] = await this.testSystemInfo(connectionId);
      results['fileOperations'] = await this.testFileOperations(connectionId);
      results['git'] = await this.testGit(connectionId);
      results['nodejs'] = await this.testNodeJS(connectionId);

      // Disconnect
      await this.sshManager.disconnect(connectionId);

      // Calculate summary
      const total = Object.keys(results).length;
      const passed = Object.values(results).filter((r) => r.success).length;
      const failed = total - passed;
      const duration = Date.now() - startTime;

      this.logger.success('Test suite completed', {
        total,
        passed,
        failed,
        duration,
      });

      return {
        connectionId,
        results,
        summary: {
          total,
          passed,
          failed,
          duration,
        },
      };
    } catch (error) {
      this.logger.error('Test suite failed', error as Error);

      // Try to disconnect
      try {
        await this.sshManager.disconnect(connectionId);
      } catch {
        // Ignore
      }

      throw error;
    }
  }
}

// Export a function to create the test manager with the SSH manager
// This avoids circular dependency issues
let _sshTestManager: SSHTestManager | null = null;

export function getSSHTestManager(sshMgr: SSHManager): SSHTestManager {
  if (!_sshTestManager) {
    _sshTestManager = new SSHTestManager(sshMgr);
  }
  return _sshTestManager;
}
