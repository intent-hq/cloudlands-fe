/**
 * Rules Service
 *
 * Manages workspace rules and guidelines
 */

import { Logger } from '$shared/logger';
import { m } from '$shared/paraglide/messages.js';
import type { Result } from '$shared/types';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('RulesService');

export interface Rule {
  id: string;
  title: string;
  content: string;
  category?: string;
  priority?: 'high' | 'medium' | 'low';
  workspaceId?: string;
  filePath?: string;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory storage
const rulesStore = new Map<string, Rule>();

export class RulesService {
  /**
   * List all rules for a workspace
   */
  async listRules(workspaceId?: string): Promise<Result<Rule[], string>> {
    try {
      const rules = Array.from(rulesStore.values());

      // Filter by workspace if provided
      const filtered = workspaceId ? rules.filter((r) => r.workspaceId === workspaceId) : rules;

      // Sort by priority then by title
      filtered.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const aPriority = priorityOrder[a.priority || 'low'];
        const bPriority = priorityOrder[b.priority || 'low'];
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        return a.title.localeCompare(b.title);
      });

      return {
        ok: true,
        data: filtered,
      };
    } catch (error) {
      logger.error('Failed to list rules', error as Error);
      return {
        ok: false,
        error: (error as Error).message || m.rules_service_listFailed_error(),
      };
    }
  }

  /**
   * Load rules from project files
   */
  async loadProjectRules(projectPath: string): Promise<Result<Rule[], string>> {
    try {
      const rules: Rule[] = [];

      // Common rule file names to look for
      const ruleFiles = [
        '.intent/rules.md',
        '.intent/guidelines.md',
        '.augment/rules.md',
        '.augment/guidelines.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        '.github/CONTRIBUTING.md',
        'docs/guidelines.md',
        'README.md',
      ];

      for (const ruleFile of ruleFiles) {
        const filePath = path.join(projectPath, ruleFile);
        try {
          const content = await fs.readFile(filePath, 'utf-8');

          // Extract title from file name or first heading
          let title = path.basename(ruleFile, path.extname(ruleFile));
          const headingMatch = content.match(/^#\s+(.+)$/m);
          if (headingMatch) {
            title = headingMatch[1];
          }

          // Determine category based on file location
          let category = 'General';
          if (ruleFile.includes('CONTRIBUTING')) {
            category = 'Contributing';
          } else if (ruleFile.includes('CODE_OF_CONDUCT')) {
            // i18n-ignore (agent-facing rules content)
            category = 'Code of Conduct';
          } else if (ruleFile.includes('.intent')) {
            // i18n-ignore (agent-facing rules content)
            category = 'Intent Rules';
          } else if (ruleFile.includes('.augment')) {
            // i18n-ignore (agent-facing rules content)
            category = 'Augment Rules';
          } else if (ruleFile.includes('guidelines')) {
            category = 'Guidelines';
          }

          const rule: Rule = {
            id: `rule-${path.basename(ruleFile)}-${Date.now()}`,
            title,
            content,
            category,
            priority:
              ruleFile.includes('.intent') || ruleFile.includes('.augment') ? 'high' : 'medium',
            workspaceId: projectPath,
            filePath,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          rules.push(rule);
          rulesStore.set(rule.id, rule);
        } catch {
          // File doesn't exist or can't be read, skip it
          logger.debug(`Rule file not found: ${filePath}`);
        }
      }

      // Also check for .intent/config.json for additional rules
      try {
        const configPath = path.join(projectPath, '.intent', 'config.json');
        const configContent = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        if (config.rules) {
          for (const [key, value] of Object.entries(config.rules)) {
            const rule: Rule = {
              id: `rule-config-${key}-${Date.now()}`,
              title: key,
              content: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
              category: 'Configuration',
              priority: 'high',
              workspaceId: projectPath,
              filePath: configPath,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            rules.push(rule);
            rulesStore.set(rule.id, rule);
          }
        }
      } catch {
        logger.debug('No .intent/config.json found');
      }

      return {
        ok: true,
        data: rules,
      };
    } catch (error) {
      logger.error('Failed to load project rules', error as Error);
      return {
        ok: false,
        error: (error as Error).message || m.rules_service_loadProjectFailed_error(),
      };
    }
  }

  /**
   * Get rules as context items for chat
   */
  async getRulesAsContext(workspaceId?: string): Promise<Result<any[], string>> {
    try {
      const result = await this.listRules(workspaceId);
      if (!result.ok) {
        return result;
      }

      const contextItems = result.data.map((rule) => ({
        id: `rule-${rule.id}`,
        type: 'rule',
        label: rule.title,
        content: rule.content,
        description: `${rule.category}${rule.priority ? ` (${rule.priority} priority)` : ''}`,
        path: rule.filePath,
        metadata: {
          ruleId: rule.id,
          category: rule.category,
          priority: rule.priority,
        },
      }));

      return {
        ok: true,
        data: contextItems,
      };
    } catch (error) {
      logger.error('Failed to get rules as context', error as Error);
      return {
        ok: false,
        error: (error as Error).message || m.rules_service_contextFailed_error(),
      };
    }
  }

  /**
   * Initialize with default rules
   */
  async initializeDefaults(): Promise<void> {
    // Add some default rules
    const defaults = [
      {
        id: 'default-1',
        // i18n-ignore (agent-facing rules content)
        title: 'Code Quality Standards',
        // i18n-ignore (agent-facing rules content)
        content: `# Code Quality Standards

- Write clean, readable, and maintainable code
- Follow the existing code style and patterns
- Add comments for complex logic
- Write tests for new features
- Keep functions small and focused
- Use meaningful variable and function names`,
        // i18n-ignore (agent-facing rules content)
        category: 'Best Practices',
        priority: 'high' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'default-2',
        // i18n-ignore (agent-facing rules content)
        title: 'Git Commit Guidelines',
        // i18n-ignore (agent-facing rules content)
        content: `# Git Commit Guidelines

- Use conventional commit format: type(scope): description
- Types: feat, fix, docs, style, refactor, test, chore
- Keep commit messages concise but descriptive
- Reference issue numbers when applicable`,
        // i18n-ignore (agent-facing rules content)
        category: 'Version Control',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'default-3',
        // i18n-ignore (agent-facing rules content)
        title: 'Documentation Requirements',
        // i18n-ignore (agent-facing rules content)
        content: `# Documentation Requirements

- Document all public APIs
- Include examples in documentation
- Keep README files up to date
- Document breaking changes
- Add JSDoc/TSDoc comments for functions`,
        category: 'Documentation',
        priority: 'medium' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    for (const rule of defaults) {
      rulesStore.set(rule.id, rule);
    }
  }
}

// Singleton instance
export const rulesService = new RulesService();

// Initialize with defaults
rulesService.initializeDefaults().catch((error) => {
  logger.error('Failed to initialize default rules', error);
});
