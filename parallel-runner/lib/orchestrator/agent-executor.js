/**
 * Agent Executor
 *
 * Handles the execution of individual agents with retry logic,
 * session management, and output capture.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');

class AgentExecutor {
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
    this.logger = new Logger('AgentExecutor', { verbose: options.verbose });
    this.auggiePath = this.findAuggiePath();
  }

  /**
   * Find auggie executable path
   */
  findAuggiePath() {
    // Check for test mode
    if (process.env.TEST_MODE === 'true' || this.config.testMode) {
      return 'echo';
    }

    // Try common locations
    const paths = [
      'auggie',
      '/usr/local/bin/auggie',
      path.join(process.env.HOME, '.nvm/versions/node/v23.8.0/bin/auggie'),
      path.join(process.env.HOME, '.local/bin/auggie')
    ];

    // For now, return the first one (will be resolved by shell)
    return 'auggie';
  }

  /**
   * Execute an agent for a package
   */
  async execute(pkg, options) {
    const { logDir, waveNumber, maxAttempts = 3 } = options;

    let attempt = 0;
    let lastError;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        this.logger.info(`Executing ${pkg.name} (attempt ${attempt}/${maxAttempts})`);

        const result = await this.runAgent(pkg, {
          logDir,
          waveNumber,
          attempt
        });

        return result;

      } catch (error) {
        lastError = error;
        this.logger.warning(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxAttempts) {
          // Wait before retry
          await this.sleep(5000 * attempt);
        }
      }
    }

    throw lastError || new Error(`Failed after ${maxAttempts} attempts`);
  }

  /**
   * Run the agent
   */
  async runAgent(pkg, options) {
    const { logDir, waveNumber, attempt } = options;

    // Prepare log file
    const logFile = path.join(logDir, `wave${waveNumber}-${pkg.id}-attempt${attempt}.log`);
    const logStream = await fs.open(logFile, 'w');

    // Build agent message
    const message = this.buildMessage(pkg);

    // Build command based on mode
    let args;
    let command;

    if (this.auggiePath === 'echo') {
      // Test mode: just echo the package name
      args = [`Simulating execution of ${pkg.name}`];
      command = 'echo';
    } else {
      // Real mode: use auggie with --print flag for piped input
      // Message comes via stdin, not as a positional argument
      args = [
        '--print',
        '-m', this.config.model || 'claude-3-5-sonnet-20241022'
      ];
      command = this.auggiePath;
    }

    return new Promise((resolve, reject) => {
      let processEnded = false;
      let timeoutHandle;

      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: false  // Don't use shell to avoid argument parsing issues
      });

      let output = '';
      let error = '';

      // Handle stdin errors
      proc.stdin.on('error', (err) => {
        this.logger.warning(`stdin error: ${err.message}`);
      });

      // Send message to auggie
      try {
        if (command !== 'echo') {
          proc.stdin.write(message);
        }
        proc.stdin.end();
      } catch (err) {
        this.logger.warning(`Failed to write to stdin: ${err.message}`);
      }

      // Capture output
      proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        logStream.write(text).catch(err => {
          this.logger.warning(`Failed to write to log: ${err.message}`);
        });
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        error += text;
        logStream.write(`[ERROR] ${text}`).catch(err => {
          this.logger.warning(`Failed to write error to log: ${err.message}`);
        });
      });

      proc.on('close', async (code) => {
        processEnded = true;
        clearTimeout(timeoutHandle);

        try {
          await logStream.close();
        } catch (err) {
          this.logger.warning(`Failed to close log stream: ${err.message}`);
        }

        if (code === 0) {
          resolve({
            success: true,
            output,
            logFile
          });
        } else {
          // Truncate error message if too long
          const errorMsg = error.length > 500 ? error.substring(0, 500) + '...' : error;
          reject(new Error(`Agent exited with code ${code}: ${errorMsg}`));
        }
      });

      proc.on('error', (err) => {
        processEnded = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to spawn agent process: ${err.message}`));
      });

      // Timeout handling
      const timeoutMinutes = this.config.timeoutMinutes || 30;
      const timeout = timeoutMinutes * 60 * 1000;
      timeoutHandle = setTimeout(() => {
        if (!processEnded) {
          processEnded = true;
          proc.kill('SIGTERM');
          reject(new Error(`Agent timed out after ${timeoutMinutes} minutes`));
        }
      }, timeout);
    });
  }

  /**
   * Build message for agent
   */
  buildMessage(pkg) {
    let message = '';

    // Add context
    message += `We're working on the experimental/amelia/workspaces app.\n`;
    message += `Don't make changes outside that folder.\n\n`;

    // Add title and description
    message += `Title: ${this.config.title}\n`;
    message += `Package: ${pkg.name}\n\n`;

    if (pkg.description) {
      message += `${pkg.description}\n\n`;
    }

    // Add prompts if available
    if (pkg.prompts && pkg.prompts.length > 0) {
      for (const prompt of pkg.prompts) {
        message += `${prompt.prompt}\n\n`;
      }
    }

    return message;
  }

  /**
   * Get session file path
   */
  getSessionFile(pkg, logDir) {
    return path.join(logDir, `${pkg.id}.session`);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { AgentExecutor };
