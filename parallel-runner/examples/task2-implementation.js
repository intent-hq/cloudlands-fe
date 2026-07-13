#!/usr/bin/env node

/**
 * Task 2 Implementation for Simple Parallel Wave
 *
 * This demonstrates what "Do the second thing" could mean in practice.
 * This is an example implementation that could be called by the parallel runner.
 */

const fs = require('fs').promises;
const path = require('path');

class Task2Implementation {
  constructor(options = {}) {
    this.name = "Second Task";
    this.description = "Do the second thing";
    this.logDir = options.logDir || 'logs';
    this.verbose = options.verbose || false;
  }

  /**
   * Main execution method for Task 2
   */
  async execute() {
    console.log(`[Task 2] Starting: ${this.description}`);

    try {
      // Step 1: Validate environment
      await this.validateEnvironment();

      // Step 2: Process data (example operation)
      const result = await this.processData();

      // Step 3: Generate output
      await this.generateOutput(result);

      // Step 4: Log completion
      await this.logCompletion(result);

      console.log('[Task 2] ✅ Successfully completed the second thing');
      return {
        status: 'completed',
        result: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('[Task 2] ❌ Failed:', error.message);
      throw error;
    }
  }

  /**
   * Validate that the environment is ready for task execution
   */
  async validateEnvironment() {
    if (this.verbose) {
      console.log('[Task 2] Validating environment...');
    }

    // Check if log directory exists
    await fs.mkdir(this.logDir, { recursive: true });

    // Check for any required dependencies
    const requiredFiles = [
      'package.json',
      'examples/simple-wave.yaml'
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(process.cwd(), file);
      try {
        await fs.access(filePath);
        if (this.verbose) {
          console.log(`[Task 2] ✓ Found ${file}`);
        }
      } catch {
        console.warn(`[Task 2] ⚠ Missing ${file}, continuing anyway...`);
      }
    }
  }

  /**
   * Process data - the main work of task 2
   */
  async processData() {
    if (this.verbose) {
      console.log('[Task 2] Processing data...');
    }

    // Simulate some work being done
    const operations = [
      'Analyzing configuration',
      'Transforming data structures',
      'Optimizing performance',
      'Validating results'
    ];

    const results = [];
    for (const op of operations) {
      if (this.verbose) {
        console.log(`[Task 2]   - ${op}`);
      }
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 100));
      results.push({
        operation: op,
        status: 'success',
        timestamp: Date.now()
      });
    }

    return {
      operations: results,
      summary: `Completed ${results.length} operations successfully`
    };
  }

  /**
   * Generate output files or artifacts
   */
  async generateOutput(result) {
    if (this.verbose) {
      console.log('[Task 2] Generating output...');
    }

    const outputPath = path.join(this.logDir, 'task2-output.json');
    const output = {
      task: this.name,
      description: this.description,
      timestamp: new Date().toISOString(),
      result: result
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
    if (this.verbose) {
      console.log(`[Task 2] Output written to ${outputPath}`);
    }
  }

  /**
   * Log completion status
   */
  async logCompletion(result) {
    const logPath = path.join(this.logDir, 'task2-completion.log');
    const logEntry = `[${new Date().toISOString()}] Task 2 completed: ${result.summary}\n`;

    await fs.appendFile(logPath, logEntry);
  }
}

// If run directly, execute the task
if (require.main === module) {
  const task = new Task2Implementation({ verbose: true });
  task.execute()
    .then(result => {
      console.log('Task 2 completed successfully:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('Task 2 failed:', error);
      process.exit(1);
    });
}

module.exports = { Task2Implementation };
