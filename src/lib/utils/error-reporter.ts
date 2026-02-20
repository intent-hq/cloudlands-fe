/**
 * Enhanced Error Reporter for Agent Integration
 *
 * Provides utilities to format errors in a way that's optimal for AI agents
 * to understand and debug issues.
 */

import type { AppError } from './error-handler.svelte';
import { Logger } from '$shared/logger';

const logger = new Logger('ErrorReporter');

export interface ErrorReport {
  id: string;
  summary: string;
  details: string;
  markdown: string;
  json: object;
  agentPrompt: string;
}

export interface ErrorContext {
  // Application state
  currentRoute?: string;
  workspaceId?: string;
  agentId?: string;
  userId?: string;

  // Environment
  browser?: {
    name: string;
    version: string;
    platform: string;
  };

  // Performance metrics
  performance?: {
    memoryUsage?: number;
    cpuUsage?: number;
    uptime?: number;
  };

  // Recent actions
  recentActions?: Array<{
    action: string;
    timestamp: string;
    details?: any;
  }>;
}

export class ErrorReporter {
  private static instance: ErrorReporter;
  private recentActions: Array<{ action: string; timestamp: string; details?: any }> = [];
  private maxRecentActions = 20;

  private constructor() {
    this.setupActionTracking();
  }

  static getInstance(): ErrorReporter {
    if (!ErrorReporter.instance) {
      ErrorReporter.instance = new ErrorReporter();
    }
    return ErrorReporter.instance;
  }

  private setupActionTracking() {
    // Track navigation events
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => {
        this.trackAction('navigation', { url: window.location.href });
      });

      // Track clicks on important elements
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' || target.classList.contains('clickable')) {
          this.trackAction('click', {
            element: target.tagName,
            text: target.textContent?.substring(0, 50),
            id: target.id,
            classes: target.className,
          });
        }
      });

      // Track form submissions
      document.addEventListener('submit', (e) => {
        const form = e.target as HTMLFormElement;
        this.trackAction('form_submit', {
          formId: form.id,
          formName: form.name,
          action: form.action,
        });
      });
    }
  }

  trackAction(action: string, details?: any) {
    this.recentActions.push({
      action,
      timestamp: new Date().toISOString(),
      details,
    });

    // Keep only recent actions
    if (this.recentActions.length > this.maxRecentActions) {
      this.recentActions = this.recentActions.slice(-this.maxRecentActions);
    }
  }

  generateReport(error: AppError, context?: ErrorContext): ErrorReport {
    const enhancedContext = this.enhanceContext(context);

    const summary = this.generateSummary(error);
    const details = this.generateDetails(error, enhancedContext);
    const markdown = this.generateMarkdown(error, enhancedContext);
    const json = this.generateJSON(error, enhancedContext);
    const agentPrompt = this.generateAgentPrompt(error, enhancedContext);

    return {
      id: error.id,
      summary,
      details,
      markdown,
      json,
      agentPrompt,
    };
  }

  private enhanceContext(context?: ErrorContext): ErrorContext {
    const enhanced: ErrorContext = {
      ...context,
      currentRoute: window.location.href,
      browser: this.getBrowserInfo(),
      performance: this.getPerformanceMetrics(),
      recentActions: this.recentActions,
    };

    return enhanced;
  }

  private getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let name = 'Unknown';
    let version = 'Unknown';

    if (userAgent.includes('Chrome')) {
      name = 'Chrome';
      version = userAgent.match(/Chrome\/(\d+)/)?.[1] || 'Unknown';
    } else if (userAgent.includes('Firefox')) {
      name = 'Firefox';
      version = userAgent.match(/Firefox\/(\d+)/)?.[1] || 'Unknown';
    } else if (userAgent.includes('Safari')) {
      name = 'Safari';
      version = userAgent.match(/Version\/(\d+)/)?.[1] || 'Unknown';
    }

    return {
      name,
      version,
      platform: navigator.platform,
    };
  }

  private getPerformanceMetrics() {
    const metrics: any = {};

    if (typeof performance !== 'undefined') {
      if ((performance as any).memory) {
        metrics.memoryUsage = (performance as any).memory.usedJSHeapSize;
        metrics.memoryLimit = (performance as any).memory.jsHeapSizeLimit;
      }
      metrics.uptime = performance.now();
    }

    return metrics;
  }

  private generateSummary(error: AppError): string {
    return `${error.type.toUpperCase()}: ${error.title} - ${error.message}`;
  }

  private generateDetails(error: AppError, context: ErrorContext): string {
    const lines = [
      `Error ID: ${error.id}`,
      `Type: ${error.type}`,
      `Title: ${error.title}`,
      `Message: ${error.message}`,
      `Timestamp: ${error.timestamp.toISOString()}`,
      `Recoverable: ${error.recoverable}`,
    ];

    if (context.currentRoute) {
      lines.push(`Current Route: ${context.currentRoute}`);
    }

    if (context.browser) {
      lines.push(
        `Browser: ${context.browser.name} ${context.browser.version} on ${context.browser.platform}`,
      );
    }

    return lines.join('\n');
  }

  private generateMarkdown(error: AppError, context: ErrorContext): string {
    const lines = [
      '# Error Report',
      '',
      '## Summary',
      `- **ID:** ${error.id}`,
      `- **Type:** ${error.type}`,
      `- **Title:** ${error.title}`,
      `- **Message:** ${error.message}`,
      `- **Timestamp:** ${error.timestamp.toISOString()}`,
      `- **Recoverable:** ${error.recoverable}`,
      '',
    ];

    if (context.currentRoute) {
      lines.push('## Location');
      lines.push(`- **URL:** ${context.currentRoute}`);
      lines.push('');
    }

    if (context.browser) {
      lines.push('## Environment');
      lines.push(`- **Browser:** ${context.browser.name} ${context.browser.version}`);
      lines.push(`- **Platform:** ${context.browser.platform}`);
      lines.push('');
    }

    if (context.performance) {
      lines.push('## Performance');
      if (context.performance.memoryUsage) {
        lines.push(
          `- **Memory Usage:** ${(context.performance.memoryUsage / 1024 / 1024).toFixed(2)} MB`,
        );
      }
      if (context.performance.uptime) {
        lines.push(`- **Uptime:** ${(context.performance.uptime / 1000).toFixed(2)} seconds`);
      }
      lines.push('');
    }

    if (context.recentActions && context.recentActions.length > 0) {
      lines.push('## Recent Actions');
      context.recentActions.slice(-10).forEach((action) => {
        lines.push(`- **${action.action}** at ${action.timestamp}`);
        if (action.details) {
          lines.push(
            `  Details: ${JSON.stringify(action.details, null, 2).replace(/\n/g, '\n  ')}`,
          );
        }
      });
      lines.push('');
    }

    if (error.context && Object.keys(error.context).length > 0) {
      lines.push('## Error Context');
      lines.push('```json');
      lines.push(JSON.stringify(error.context, null, 2));
      lines.push('```');
      lines.push('');
    }

    if (error.stack) {
      lines.push('## Stack Trace');
      lines.push('```');
      lines.push(error.stack);
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  private generateJSON(error: AppError, context: ErrorContext): object {
    return {
      error: {
        id: error.id,
        type: error.type,
        title: error.title,
        message: error.message,
        timestamp: error.timestamp.toISOString(),
        recoverable: error.recoverable,
        context: error.context,
        stack: error.stack,
      },
      environment: context,
    };
  }

  private generateAgentPrompt(error: AppError, context: ErrorContext): string {
    const lines = [
      'I encountered an error in the Intent application and need help debugging it.',
      '',
      '## Error Details',
      `The application threw a ${error.type} error: "${error.message}"`,
      '',
      '## Context',
      `- This occurred at ${error.timestamp.toISOString()}`,
      `- The error ${error.recoverable ? 'is' : 'is not'} recoverable`,
      `- Current URL: ${context.currentRoute}`,
      '',
    ];

    if (context.recentActions && context.recentActions.length > 0) {
      lines.push('## What I was doing');
      lines.push('Here are my recent actions before the error:');
      context.recentActions.slice(-5).forEach((action, index) => {
        lines.push(`${index + 1}. ${action.action} at ${action.timestamp}`);
      });
      lines.push('');
    }

    if (error.stack) {
      lines.push('## Technical Details');
      lines.push('Stack trace:');
      lines.push('```');
      lines.push(error.stack.split('\n').slice(0, 10).join('\n'));
      lines.push('```');
      lines.push('');
    }

    lines.push('## Request');
    lines.push('Please help me:');
    lines.push('1. Understand what caused this error');
    lines.push('2. Identify the root cause');
    lines.push('3. Suggest a fix or workaround');
    lines.push('4. Prevent similar errors in the future');

    return lines.join('\n');
  }
}

export const errorReporter = ErrorReporter.getInstance();
