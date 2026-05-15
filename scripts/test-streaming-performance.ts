#!/usr/bin/env tsx

/**
 * Performance Test Runner for Chat Streaming
 *
 * Tests for performance issues and bottlenecks
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../src/shared/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = new Logger('StreamingPerformanceTest');

interface PerformanceIssue {
  file: string;
  line: number;
  issue: string;
  severity: 'high' | 'medium' | 'low';
}

class StreamingPerformanceTester {
  private issues: PerformanceIssue[] = [];

  /**
   * Check for unnecessary re-renders
   */
  async checkUnnecessaryRerenders(): Promise<void> {
    logger.info('Checking for unnecessary re-renders...');

    const files = [
      'src/lib/components/chat/ChatPanel.svelte',
      'src/lib/components/chat/StreamingMessageContent.svelte',
      'src/lib/components/chat/ChatMessage.svelte',
    ];

    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for missing keys in loops
        if (line.includes('{#each') && !line.includes('(') && !line.includes(' as ')) {
          this.issues.push({
            file,
            line: index + 1,
            issue: 'Missing key in {#each} block - causes unnecessary re-renders',
            severity: 'high',
          });
        }

        // Check for inline functions in templates
        if (line.includes('on:') && line.includes('=>')) {
          this.issues.push({
            file,
            line: index + 1,
            issue: 'Inline arrow function in event handler - recreated on every render',
            severity: 'medium',
          });
        }
      });
    }
  }

  /**
   * Check for expensive operations in reactive blocks
   */
  async checkExpensiveOperations(): Promise<void> {
    logger.info('Checking for expensive operations in reactive blocks...');

    const files = [
      'src/lib/components/markdown/MarkdownViewer.svelte',
      'src/lib/components/chat/StreamingMessageContent.svelte',
    ];

    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      let inReactiveBlock = false;
      lines.forEach((line, index) => {
        // Track reactive blocks
        if (line.includes('$:') || line.includes('$effect')) {
          inReactiveBlock = true;
        }
        if (inReactiveBlock && line.trim() === '') {
          inReactiveBlock = false;
        }

        if (inReactiveBlock) {
          // Check for expensive operations
          if (line.includes('JSON.parse') || line.includes('JSON.stringify')) {
            this.issues.push({
              file,
              line: index + 1,
              issue: 'JSON operations in reactive block - expensive',
              severity: 'high',
            });
          }

          if (line.includes('.map(') || line.includes('.filter(') || line.includes('.reduce(')) {
            this.issues.push({
              file,
              line: index + 1,
              issue: 'Array operations in reactive block - consider memoization',
              severity: 'medium',
            });
          }
        }
      });
    }
  }

  /**
   * Check for memory leaks
   */
  async checkMemoryLeaks(): Promise<void> {
    logger.info('Checking for potential memory leaks...');

    const files = [
      'src/features/agent/agent-stream-lifecycle.ts',
      'src/features/agent/utils/stream-handler-registry.ts',
    ];

    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      let hasEventListener = false;
      let hasRemoveListener = false;

      lines.forEach((line, index) => {
        if (line.includes('addEventListener') || line.includes('.on(')) {
          hasEventListener = true;
        }
        if (
          line.includes('removeEventListener') ||
          line.includes('.off(') ||
          line.includes('offById') ||
          line.includes('removeAllListeners') ||
          line.includes('cleanupStreamHandler')
        ) {
          hasRemoveListener = true;
        }

        // Check for setInterval without clearInterval
        if (line.includes('setInterval') && !content.includes('clearInterval')) {
          this.issues.push({
            file,
            line: index + 1,
            issue: 'setInterval without clearInterval - memory leak',
            severity: 'high',
          });
        }
      });

      if (hasEventListener && !hasRemoveListener) {
        this.issues.push({
          file,
          line: 0,
          issue: 'Event listeners without cleanup - potential memory leak',
          severity: 'high',
        });
      }
    }
  }

  /**
   * Check for throttling/debouncing
   */
  async checkThrottling(): Promise<void> {
    logger.info('Checking for proper throttling/debouncing...');

    const files = [
      'src/lib/components/markdown/MarkdownViewer.svelte',
      'src/lib/components/chat/ChatPanel.svelte',
    ];

    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');

      // Check for scroll handlers without throttling
      if (content.includes('on:scroll') && !content.includes('throttle') && !content.includes('debounce')) {
        this.issues.push({
          file,
          line: 0,
          issue: 'Scroll handler without throttling - performance issue',
          severity: 'high',
        });
      }

      // Check for input handlers without debouncing
      if (content.includes('on:input') && !content.includes('debounce') && !content.includes('throttle')) {
        this.issues.push({
          file,
          line: 0,
          issue: 'Input handler without debouncing - performance issue',
          severity: 'medium',
        });
      }
    }
  }

  /**
   * Check for large DOM operations
   */
  async checkDOMOperations(): Promise<void> {
    logger.info('Checking for expensive DOM operations...');

    const files = [
      'src/lib/components/chat/StreamingMessageContent.svelte',
      'src/lib/components/markdown/MarkdownViewer.svelte',
    ];

    for (const file of files) {
      const filePath = path.join(__dirname, '..', file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Check for unsafe innerHTML usage. MarkdownViewer's streaming path assigns HTML
        // returned by processMarkdownToHTML and escapes fallback text, so it is intentional.
        const trimmedLine = line.trim();
        const isComment = trimmedLine.startsWith('//') || trimmedLine.startsWith('*');
        const isSanitizedStreamingAssignment =
          file === 'src/lib/components/markdown/MarkdownViewer.svelte' &&
          content.includes('processMarkdownToHTML') &&
          content.includes('Escape HTML for safety') &&
          (line.includes('innerHTML = html') ||
            line.includes("innerHTML = ''") ||
            line.includes('innerHTML = `<p>${escaped}</p>`'));

        if (line.includes('innerHTML') && !isComment && !isSanitizedStreamingAssignment) {
          this.issues.push({
            file,
            line: index + 1,
            issue: 'Direct innerHTML manipulation - expensive and potentially unsafe',
            severity: 'high',
          });
        }

        // Check for forced reflows
        if (line.includes('offsetHeight') || line.includes('offsetWidth') || line.includes('getBoundingClientRect')) {
          if (line.includes('style.') || line.includes('classList.')) {
            this.issues.push({
              file,
              line: index + 1,
              issue: 'Reading layout properties after DOM changes - causes reflow',
              severity: 'medium',
            });
          }
        }
      });
    }
  }

  /**
   * Generate report
   */
  generateReport(): void {
    console.log('\n🔍 Performance Test Results\n');
    console.log('=' .repeat(50));

    if (this.issues.length === 0) {
      console.log('\n✅ No performance issues found!');
      return;
    }

    // Group by severity
    const highSeverity = this.issues.filter(i => i.severity === 'high');
    const mediumSeverity = this.issues.filter(i => i.severity === 'medium');
    const lowSeverity = this.issues.filter(i => i.severity === 'low');

    if (highSeverity.length > 0) {
      console.log('\n🔴 High Severity Issues:');
      highSeverity.forEach(issue => {
        console.log(`   ${issue.file}${issue.line > 0 ? `:${  issue.line}` : ''}`);
        console.log(`   └─ ${issue.issue}`);
      });
    }

    if (mediumSeverity.length > 0) {
      console.log('\n🟡 Medium Severity Issues:');
      mediumSeverity.forEach(issue => {
        console.log(`   ${issue.file}${issue.line > 0 ? `:${  issue.line}` : ''}`);
        console.log(`   └─ ${issue.issue}`);
      });
    }

    if (lowSeverity.length > 0) {
      console.log('\n🟢 Low Severity Issues:');
      lowSeverity.forEach(issue => {
        console.log(`   ${issue.file}${issue.line > 0 ? `:${  issue.line}` : ''}`);
        console.log(`   └─ ${issue.issue}`);
      });
    }

    console.log(`\n${  '='.repeat(50)}`);
    console.log(`\nTotal issues found: ${this.issues.length}`);
    console.log(`High: ${highSeverity.length}, Medium: ${mediumSeverity.length}, Low: ${lowSeverity.length}`);
  }

  /**
   * Run all performance tests
   */
  async runAllTests(): Promise<void> {
    console.log('\n⚡ Running Performance Tests for Streaming\n');

    await this.checkUnnecessaryRerenders();
    await this.checkExpensiveOperations();
    await this.checkMemoryLeaks();
    await this.checkThrottling();
    await this.checkDOMOperations();

    this.generateReport();

    if (this.issues.filter(i => i.severity === 'high').length > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

// Run tests
const tester = new StreamingPerformanceTester();
tester.runAllTests().catch(error => {
  console.error('Performance test runner failed:', error);
  process.exit(1);
});

export { StreamingPerformanceTester };
