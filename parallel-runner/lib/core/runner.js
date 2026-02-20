/**
 * Core Parallel Runner Implementation
 *
 * Handles the execution of parallel agent workflows with
 * dependency management, error recovery, and monitoring.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { Logger } = require('../utils/logger');
const { AgentExecutor } = require('../orchestrator/agent-executor');
const { DependencyResolver } = require('./dependency-resolver');
const { ReportGenerator } = require('../utils/report-generator');

class ParallelRunner {
  constructor(config, options = {}) {
    this.config = config;
    this.options = options;
    this.logger = new Logger('Runner', { verbose: options.verbose });
    this.monitor = options.monitor;

    // Initialize components
    this.executor = new AgentExecutor(config, options);
    this.resolver = new DependencyResolver(config.packages);
    this.reporter = new ReportGenerator(config);

    // State tracking
    this.state = {
      packages: {},
      startTime: null,
      endTime: null,
      errors: [],
      metrics: {}
    };

    // Log directory will be set up in run()
    this.logDir = null;
  }

  async setupLogDirectory() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logDir = this.config.logDir || path.join('logs', `run-${timestamp}`);
    await fs.mkdir(this.logDir, { recursive: true });
    this.logger.info(`Log directory: ${this.logDir}`);
  }

  /**
   * Get execution plan showing waves of packages
   */
  getExecutionPlan() {
    return this.resolver.getExecutionWaves();
  }

  /**
   * Main execution method
   */
  async run() {
    if (this.options.dryRun) {
      return this.dryRun();
    }

    // Setup log directory first
    await this.setupLogDirectory();

    this.state.startTime = Date.now();
    this.logger.info('Starting parallel execution...');

    try {
      // Execute waves in sequence
      const waves = this.getExecutionPlan();

      for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
        await this.executeWave(waves[waveIndex], waveIndex + 1);
      }

      // Run consolidation if configured
      if (this.config.consolidation) {
        await this.runConsolidation();
      }

    } catch (error) {
      this.logger.error('Execution failed:', error);
      this.state.errors.push(error);
    } finally {
      this.state.endTime = Date.now();

      // Generate report
      const report = await this.generateReport();

      // Return results
      return {
        duration: this.formatDuration(this.state.endTime - this.state.startTime),
        total: this.config.packages.length,
        completed: Object.values(this.state.packages).filter(p => p.status === 'completed').length,
        failed: Object.values(this.state.packages).filter(p => p.status === 'failed').length,
        logDir: this.logDir,
        reportFile: report
      };
    }
  }

  /**
   * Execute a wave of packages in parallel
   */
  async executeWave(wave, waveNumber) {
    this.logger.info(`\n🌊 Wave ${waveNumber}: ${wave.packages.length} packages`);
    this.logger.info(`Packages: ${wave.packages.map(p => p.id).join(', ')}`);

    // Update monitor if available
    if (this.monitor) {
      this.monitor.updateWave(waveNumber, wave);
    }

    // Execute packages in parallel with limit
    const maxParallel = this.config.maxParallel || 4;
    const results = [];

    for (let i = 0; i < wave.packages.length; i += maxParallel) {
      const batch = wave.packages.slice(i, i + maxParallel);
      const batchPromises = batch.map(pkg => this.executePackage(pkg, waveNumber));
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);
    }

    // Check for failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0 && !this.config.continueOnError) {
      throw new Error(`Wave ${waveNumber} had ${failures.length} failures`);
    }

    this.logger.success(`Wave ${waveNumber} completed`);
  }

  /**
   * Execute a single package
   */
  async executePackage(pkg, waveNumber) {
    const packageState = {
      id: pkg.id,
      name: pkg.name,
      status: 'running',
      startTime: Date.now(),
      waveNumber,
      attempts: 0,
      logs: []
    };

    this.state.packages[pkg.id] = packageState;

    // Update monitor
    if (this.monitor) {
      this.monitor.updatePackage(pkg.id, packageState);
    }

    try {
      this.logger.info(`Starting package: ${pkg.name}`);

      // Execute with retry logic
      const result = await this.executor.execute(pkg, {
        logDir: this.logDir,
        waveNumber,
        maxAttempts: this.config.retryAttempts || 3
      });

      packageState.status = 'completed';
      packageState.endTime = Date.now();
      packageState.result = result;

      this.logger.success(`Package completed: ${pkg.name}`);

    } catch (error) {
      packageState.status = 'failed';
      packageState.endTime = Date.now();
      packageState.error = error.message;

      this.logger.error(`Package failed: ${pkg.name}`, error);
      throw error;
    }
  }

  /**
   * Run consolidation phase
   */
  async runConsolidation() {
    this.logger.info('\n🔄 Running consolidation...');

    try {
      // Run TypeScript check
      const tsCheck = await this.runCommand('npm run check', this.logDir);

      // Run tests if configured
      let testResults;
      if (this.config.runTests) {
        testResults = await this.runCommand('npm test', this.logDir);
      }

      // Store results
      this.state.metrics.consolidation = {
        typescript: tsCheck,
        tests: testResults
      };

      this.logger.success('Consolidation completed');

    } catch (error) {
      this.logger.warning('Consolidation had issues:', error.message);
      this.state.metrics.consolidation = { error: error.message };
    }
  }

  /**
   * Generate final report
   */
  async generateReport() {
    const reportPath = path.join(this.logDir, 'report.md');

    const report = await this.reporter.generate({
      state: this.state,
      config: this.config,
      logDir: this.logDir
    });

    await fs.writeFile(reportPath, report);
    this.logger.info(`Report generated: ${reportPath}`);

    return reportPath;
  }

  /**
   * Run a shell command
   */
  async runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      let processEnded = false;
      let timeoutHandle;

      const child = spawn(command, [], {
        shell: true,
        cwd,
        stdio: 'pipe'
      });

      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('close', (code) => {
        if (processEnded) return; // Already handled by timeout
        processEnded = true;
        clearTimeout(timeoutHandle);

        if (code === 0) {
          resolve({ output, error, code });
        } else {
          // Truncate error if too long
          const errorMsg = error.length > 500 ? error.substring(0, 500) + '...' : error;
          reject(new Error(`Command failed with code ${code}: ${errorMsg}`));
        }
      });

      child.on('error', (err) => {
        if (processEnded) return;
        processEnded = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`Failed to spawn command: ${err.message}`));
      });

      // Timeout for consolidation commands (5 minutes)
      timeoutHandle = setTimeout(() => {
        if (!processEnded) {
          processEnded = true;
          child.kill('SIGTERM');
          reject(new Error('Command timed out after 5 minutes'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Format duration in human-readable format
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Dry run - show what would be executed
   */
  async dryRun() {
    const waves = this.getExecutionPlan();

    console.log('\nExecution Plan:\n');
    waves.forEach((wave, i) => {
      console.log(`Wave ${i + 1}:`);
      wave.packages.forEach(pkg => {
        console.log(`  - ${pkg.id}: ${pkg.name}`);
        if (pkg.dependencies?.length > 0) {
          console.log(`    Dependencies: ${pkg.dependencies.join(', ')}`);
        }
      });
    });

    return {
      duration: '0s',
      total: this.config.packages.length,
      completed: 0,
      failed: 0,
      logDir: this.logDir,
      reportFile: null
    };
  }
}

module.exports = { ParallelRunner };
