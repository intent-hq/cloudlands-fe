/**
 * Report Generator
 *
 * Generates comprehensive reports from execution results
 */

const fs = require('fs').promises;
const path = require('path');

class ReportGenerator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate a markdown report
   */
  async generate(data) {
    const { state, config, logDir } = data;

    let report = '';

    // Header
    report += `# Parallel Agent Execution Report\n\n`;
    report += `**Title:** ${config.title}\n`;
    report += `**Description:** ${config.description || 'N/A'}\n`;
    report += `**Date:** ${new Date().toISOString()}\n`;
    report += `**Duration:** ${this.formatDuration(state.endTime - state.startTime)}\n\n`;

    // Summary
    report += `## Summary\n\n`;
    const packages = Object.values(state.packages);
    const completed = packages.filter(p => p.status === 'completed').length;
    const failed = packages.filter(p => p.status === 'failed').length;
    const total = config.packages.length;

    report += `- **Total Packages:** ${total}\n`;
    report += `- **Completed:** ${completed} (${Math.round(completed/total*100)}%)\n`;
    report += `- **Failed:** ${failed} (${Math.round(failed/total*100)}%)\n`;
    report += `- **Success Rate:** ${Math.round(completed/total*100)}%\n\n`;

    // Metrics
    if (state.metrics?.consolidation) {
      report += `## Consolidation Results\n\n`;
      if (state.metrics.consolidation.typescript) {
        report += `### TypeScript Check\n\n`;
        report += `\`\`\`\n${state.metrics.consolidation.typescript.output || 'No output'}\n\`\`\`\n\n`;
      }
      if (state.metrics.consolidation.tests) {
        report += `### Test Results\n\n`;
        report += `\`\`\`\n${state.metrics.consolidation.tests.output || 'No output'}\n\`\`\`\n\n`;
      }
    }

    // Package Details
    report += `## Package Details\n\n`;

    for (const pkg of packages) {
      const emoji = pkg.status === 'completed' ? '✅' :
                    pkg.status === 'failed' ? '❌' : '⏳';

      report += `### ${emoji} ${pkg.name || pkg.id}\n\n`;
      report += `- **Status:** ${pkg.status}\n`;
      report += `- **Wave:** ${pkg.waveNumber}\n`;
      report += `- **Duration:** ${this.formatDuration(pkg.endTime - pkg.startTime)}\n`;
      report += `- **Attempts:** ${pkg.attempts || 1}\n`;

      if (pkg.error) {
        report += `- **Error:** ${pkg.error}\n`;
      }

      if (pkg.logs && pkg.logs.length > 0) {
        report += `- **Logs:** ${pkg.logs.map(l => `[${path.basename(l)}](${l})`).join(', ')}\n`;
      }

      report += '\n';
    }

    // Errors
    if (state.errors && state.errors.length > 0) {
      report += `## Errors\n\n`;
      for (const error of state.errors) {
        report += `- ${error.message || error}\n`;
      }
      report += '\n';
    }

    // Recommendations
    report += `## Recommendations\n\n`;

    if (failed > 0) {
      report += `- **Failed Packages:** ${failed} packages failed. Review the logs and consider:\n`;
      report += `  - Running failed packages individually\n`;
      report += `  - Increasing timeout limits\n`;
      report += `  - Checking for dependency issues\n\n`;
    }

    const avgDuration = packages.length > 0
      ? packages.reduce((sum, p) => sum + (p.endTime - p.startTime), 0) / packages.length
      : 0;

    if (avgDuration > 30 * 60 * 1000) {
      report += `- **Long Execution Time:** Average package duration is ${this.formatDuration(avgDuration)}. Consider:\n`;
      report += `  - Breaking packages into smaller units\n`;
      report += `  - Increasing parallel execution limit\n\n`;
    }

    // Log Files
    report += `## Log Files\n\n`;
    report += `All logs are available in: \`${logDir}\`\n\n`;

    try {
      const files = await fs.readdir(logDir);
      const logFiles = files.filter(f => f.endsWith('.log'));

      if (logFiles.length > 0) {
        report += `### Available Logs\n\n`;
        for (const file of logFiles) {
          report += `- [${file}](${path.join(logDir, file)})\n`;
        }
      }
    } catch (error) {
      // Ignore if can't read directory
    }

    return report;
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    if (!ms || ms < 0) return 'N/A';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Generate HTML report
   */
  async generateHTML(data) {
    const markdown = await this.generate(data);
    // TODO: Convert markdown to HTML
    return markdown;
  }
}

module.exports = { ReportGenerator };
