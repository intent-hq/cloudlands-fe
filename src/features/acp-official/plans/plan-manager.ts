/**
 * Plan Manager for ACP
 *
 * Tracks agent execution plans with hierarchical task breakdown.
 * Provides real-time updates on task progress.
 */

import { EventEmitter } from '../utils/browser-event-emitter';
import type { AgentId } from '$shared/types/branded-ids';
import { Logger } from '../../../shared/logger';
import type { PlanEntry, SessionId } from '../types/base';

const logger = new Logger('PlanManager');

export interface EnhancedPlanEntry extends PlanEntry {
  id: string;
  title: string;
  parentId?: string;
  children?: EnhancedPlanEntry[];
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  progress?: number;
  icon?: string;
  color?: string;
}

export interface SessionPlan {
  sessionId: AgentId;
  entries: EnhancedPlanEntry[];
  createdAt: number;
  updatedAt: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  progress: number;
}

class PlanManager extends EventEmitter {
  private plans = new Map<SessionId, SessionPlan>();
  private entryCounter = 0;

  /**
   * Update plan for a session
   */
  updatePlan(sessionId: AgentId, entries: PlanEntry[]): void {
    const enhancedEntries = this.enhanceEntries(entries);
    const existingPlan = this.plans.get(sessionId);

    const plan: SessionPlan = {
      sessionId,
      entries: enhancedEntries,
      createdAt: existingPlan?.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...this.calculateStatistics(enhancedEntries),
    };

    this.plans.set(sessionId, plan);
    this.emit('plan:updated', plan);

    logger.info('Plan updated', {
      sessionId,
      totalTasks: plan.totalTasks,
      progress: plan.progress,
    });
  }

  /**
   * Get plan for a session
   */
  getPlan(sessionId: AgentId): SessionPlan | undefined {
    return this.plans.get(sessionId);
  }

  /**
   * Clear plan for a session
   */
  clearPlan(sessionId: AgentId): void {
    this.plans.delete(sessionId);
    this.emit('plan:cleared', sessionId);
  }

  /**
   * Enhance plan entries with additional metadata
   */
  private enhanceEntries(entries: PlanEntry[]): EnhancedPlanEntry[] {
    return entries.map((entry) => {
      const enhanced: EnhancedPlanEntry = {
        ...entry,
        id: entry.id || `task_${++this.entryCounter}`,
        icon: this.getTaskIcon(entry),
        color: this.getTaskColor(entry),
      };

      // Track timing for completed tasks
      if (entry.status === 'completed') {
        enhanced.completedAt = Date.now();
      } else if (entry.status === 'in_progress') {
        enhanced.startedAt = Date.now();
      }

      // Calculate progress for in-progress tasks
      if (entry.status === 'in_progress') {
        enhanced.progress = this.estimateProgress(entry);
      }

      // Process children recursively
      if (entry.children && entry.children.length > 0) {
        enhanced.children = this.enhanceEntries(entry.children);
      }

      return enhanced;
    });
  }

  /**
   * Calculate plan statistics
   */
  private calculateStatistics(entries: EnhancedPlanEntry[]): {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    progress: number;
  } {
    let totalTasks = 0;
    let completedTasks = 0;
    let failedTasks = 0;

    const countTasks = (entries: EnhancedPlanEntry[]) => {
      for (const entry of entries) {
        totalTasks++;
        if (entry.status === 'completed') completedTasks++;
        if (entry.status === 'failed') failedTasks++;

        if (entry.children) {
          countTasks(entry.children);
        }
      }
    };

    countTasks(entries);

    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return { totalTasks, completedTasks, failedTasks, progress };
  }

  /**
   * Get appropriate icon for task type
   */
  private getTaskIcon(entry: PlanEntry): string {
    // Check task name/description for patterns
    const text = `${entry.title} ${entry.description || ''}`.toLowerCase();

    if (text.includes('analyze') || text.includes('review')) return '🔍';
    if (text.includes('create') || text.includes('generate')) return '✨';
    if (text.includes('update') || text.includes('modify')) return '📝';
    if (text.includes('delete') || text.includes('remove')) return '🗑️';
    if (text.includes('test') || text.includes('verify')) return '🧪';
    if (text.includes('deploy') || text.includes('publish')) return '🚀';
    if (text.includes('fix') || text.includes('repair')) return '🔧';
    if (text.includes('optimize') || text.includes('improve')) return '⚡';
    if (text.includes('document') || text.includes('write')) return '📄';
    if (text.includes('configure') || text.includes('setup')) return '⚙️';

    // Status-based icons
    if (entry.status === 'completed') return '✅';
    if (entry.status === 'failed') return '❌';
    if (entry.status === 'in_progress') return '⏳';
    if (entry.status === 'cancelled') return '⛔';

    return '📋';
  }

  /**
   * Get color for task based on status
   */
  private getTaskColor(entry: PlanEntry): string {
    switch (entry.status) {
      case 'completed':
        return 'green';
      case 'failed':
        return 'red';
      case 'in_progress':
        return 'blue';
      case 'cancelled':
        return 'gray';
      case 'pending':
        return 'yellow';
      default:
        return 'gray';
    }
  }

  /**
   * Estimate progress for in-progress tasks
   */
  private estimateProgress(entry: PlanEntry): number {
    // If task has children, calculate based on children
    if (entry.children && entry.children.length > 0) {
      const completed = entry.children.filter((c) => c.status === 'completed').length;
      return Math.round((completed / entry.children.length) * 100);
    }

    // Otherwise, return a default in-progress value
    return 50;
  }

  /**
   * Get all active plans
   */
  getAllPlans(): SessionPlan[] {
    return Array.from(this.plans.values());
  }

  /**
   * Get statistics across all plans
   */
  getGlobalStatistics() {
    const plans = this.getAllPlans();

    return {
      activeSessions: plans.length,
      totalTasks: plans.reduce((sum, p) => sum + p.totalTasks, 0),
      completedTasks: plans.reduce((sum, p) => sum + p.completedTasks, 0),
      failedTasks: plans.reduce((sum, p) => sum + p.failedTasks, 0),
      averageProgress:
        plans.length > 0
          ? Math.round(plans.reduce((sum, p) => sum + p.progress, 0) / plans.length)
          : 0,
    };
  }

  /**
   * Export plan as markdown
   */
  exportAsMarkdown(sessionId: AgentId): string {
    const plan = this.plans.get(sessionId);
    if (!plan) return '';

    const renderEntry = (entry: EnhancedPlanEntry, indent = 0): string => {
      const prefix = '  '.repeat(indent);
      const status =
        entry.status === 'completed'
          ? '✅'
          : entry.status === 'failed'
            ? '❌'
            : entry.status === 'in_progress'
              ? '⏳'
              : entry.status === 'cancelled'
                ? '⛔'
                : '⭕';

      let line = `${prefix}- ${status} ${entry.title}`;
      if (entry.description) {
        line += `\n${prefix}  ${entry.description}`;
      }
      if (entry.progress !== undefined && entry.status === 'in_progress') {
        line += ` (${entry.progress}%)`;
      }

      if (entry.children) {
        for (const child of entry.children) {
          line += `\n${renderEntry(child, indent + 1)}`;
        }
      }

      return line;
    };

    let markdown = '# Execution Plan\n\n';
    markdown += `**Progress:** ${plan.progress}% (${plan.completedTasks}/${plan.totalTasks} tasks)\n\n`;

    for (const entry of plan.entries) {
      markdown += `${renderEntry(entry)}\n`;
    }

    return markdown;
  }
}

// Singleton instance
export const planManager = new PlanManager();
