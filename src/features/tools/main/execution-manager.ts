/**
 * Tool Execution Manager
 * Manages the execution of tools and tracks their status
 */

import { EventEmitter } from 'events';
import { ToolExecutionStatus, type Tool, type ToolExecution, type ToolResult } from './types';

export class ExecutionManager extends EventEmitter {
  private executions: Map<string, ToolExecution> = new Map();
  private activeExecutions: Set<string> = new Set();
  private maxRetries = 3;
  private retryDelay = 1000;

  async execute(tool: Tool, input: any): Promise<ToolResult> {
    const executionId = this.generateExecutionId();

    const execution: ToolExecution = {
      toolId: tool.id,
      input,
      startTime: new Date(),
      status: ToolExecutionStatus.PENDING,
    };

    this.executions.set(executionId, execution);
    this.activeExecutions.add(executionId);

    try {
      execution.status = ToolExecutionStatus.RUNNING;
      this.emit('execution:started', { executionId, execution });

      // Placeholder for actual tool execution
      // In a real implementation, this would delegate to specific tool handlers
      const result = await this.executeToolInternal(tool, input);

      execution.output = result.data;
      execution.status = ToolExecutionStatus.SUCCESS;
      execution.endTime = new Date();

      this.emit('execution:completed', { executionId, execution });

      return result;
    } catch (error) {
      execution.error = error instanceof Error ? error.message : String(error);
      execution.status = ToolExecutionStatus.FAILED;
      execution.endTime = new Date();

      this.emit('execution:failed', { executionId, execution, error });

      return {
        success: false,
        error: execution.error,
      };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async executeToolInternal(tool: Tool, input: any): Promise<ToolResult> {
    // Placeholder implementation
    return {
      success: true,
      data: { message: `Executed tool ${tool.name}` },
      metadata: {
        duration: 0,
      },
    };
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  getExecution(executionId: string): ToolExecution | undefined {
    return this.executions.get(executionId);
  }

  getActiveExecutions(): ToolExecution[] {
    return Array.from(this.activeExecutions)
      .map((id) => this.executions.get(id))
      .filter(Boolean) as ToolExecution[];
  }

  cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || !this.activeExecutions.has(executionId)) {
      return false;
    }

    execution.status = ToolExecutionStatus.CANCELLED;
    execution.endTime = new Date();
    this.activeExecutions.delete(executionId);

    this.emit('execution:cancelled', { executionId, execution });

    return true;
  }

  clearHistory(): void {
    // Only clear completed executions
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [id, execution] of this.executions) {
      if (!this.activeExecutions.has(id)) {
        this.executions.delete(id);
      }
    }
  }

  async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on certain errors
        if (error instanceof Error && error.message.includes('ENOENT')) {
          throw error;
        }

        // Wait before retrying
        if (attempt < this.maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error('Execution failed after retries');
  }
}

export const executionManager = new ExecutionManager();
