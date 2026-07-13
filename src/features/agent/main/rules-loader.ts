/**
 * User Rules Loader
 *
 * Loads user-defined rules and guidelines for agents.
 * These are project-level rules the user has configured.
 * Follows the Auggie CLI rules system for consistency.
 *
 * Supported rules files (in order of precedence):
 * 1. Custom rules file (via --rules flag)
 * 2. CLAUDE.md - Compatible with Claude Code
 * 3. AGENTS.md - Compatible with Cursor
 * 4. .augment/guidelines.md - Legacy guidelines
 * 5. .augment/rules/ - Recursively searches .md files
 *
 * PERFORMANCE: All file operations are async to avoid blocking the event loop.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../../../shared/logger';

const logger = new Logger('UserRulesLoader');

export interface RulesConfig {
  workspacePath: string;
  customRulesPath?: string;
}

export interface LoadedRules {
  content: string;
  source: string;
  type: 'always_apply' | 'agent_requested';
}

/**
 * Check if a file/directory exists (async)
 */
async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load user rules from project following Auggie CLI conventions
 */
export async function loadUserRules(config: RulesConfig): Promise<LoadedRules | null> {
  const { workspacePath, customRulesPath } = config;

  // Check in order of precedence
  const rulePaths = [
    // Custom rules file (highest priority)
    customRulesPath,
    // Standard rules files
    path.join(workspacePath, 'CLAUDE.md'),
    path.join(workspacePath, 'AGENTS.md'),
    // Legacy workspace guidelines
    path.join(workspacePath, '.augment', 'guidelines.md'),
  ].filter(Boolean) as string[];

  // Check each path (async)
  for (const rulePath of rulePaths) {
    if (await fileExistsAsync(rulePath)) {
      try {
        const content = await fs.readFile(rulePath, 'utf-8');
        return {
          content,
          source: rulePath,
          type: 'always_apply',
        };
      } catch (error) {
        logger.error(`Failed to read rules from ${rulePath}`, error as Error);
      }
    }
  }

  // Check .augment/rules/ directory
  const rulesDir = path.join(workspacePath, '.augment', 'rules');
  if (await fileExistsAsync(rulesDir)) {
    try {
      const rules = await loadRulesFromDirectory(rulesDir);
      if (rules) {
        return rules;
      }
    } catch (error) {
      logger.error(`Failed to load rules from directory ${rulesDir}`, error as Error);
    }
  }

  return null;
}

/**
 * Load rules from .augment/rules/ directory
 * Reads all .md files in parallel for better performance
 */
async function loadRulesFromDirectory(rulesDir: string): Promise<LoadedRules | null> {
  try {
    const files = await fs.readdir(rulesDir);
    const mdFiles = files.filter((f) => f.endsWith('.md')).sort(); // Sort for consistent ordering

    if (mdFiles.length === 0) {
      return null;
    }

    // Read all files in parallel for better performance
    const fileReadPromises = mdFiles.map(async (file) => {
      const filePath = path.join(rulesDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return { file, content, error: null };
      } catch (error) {
        logger.error(`Failed to read rule file ${filePath}`, error as Error);
        return { file, content: null, error };
      }
    });

    const results = await Promise.all(fileReadPromises);

    const ruleParts: string[] = [];
    let hasAlwaysApply = false;

    for (const result of results) {
      if (result.content) {
        const parsed = parseRuleFile(result.content);
        ruleParts.push(parsed.content);
        if (parsed.type === 'always_apply') {
          hasAlwaysApply = true;
        }
      }
    }

    if (ruleParts.length === 0) {
      return null;
    }

    return {
      content: ruleParts.join('\n\n---\n\n'),
      source: rulesDir,
      type: hasAlwaysApply ? 'always_apply' : 'agent_requested',
    };
  } catch (error) {
    logger.error('Failed to load rules directory', error as Error);
    return null;
  }
}

/**
 * Parse rule file with optional frontmatter
 */
function parseRuleFile(content: string): {
  content: string;
  type: 'always_apply' | 'agent_requested';
} {
  // Check for YAML frontmatter
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = content.substring(3, endIndex);
      const body = content.substring(endIndex + 3).trim();

      // Parse frontmatter
      const type = extractFrontmatterField(frontmatter, 'type') || 'always_apply';

      return {
        content: body,
        type: type as 'always_apply' | 'agent_requested',
      };
    }
  }

  return {
    content,
    type: 'always_apply',
  };
}

/**
 * Extract a field from YAML frontmatter
 */
function extractFrontmatterField(frontmatter: string, field: string): string | null {
  const regex = new RegExp(`^${field}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Format user rules for inclusion in agent context
 */
export function formatUserRulesForContext(rules: LoadedRules): string {
  return `## User Rules & Guidelines

The following rules and guidelines have been configured for this project. Please follow these conventions and best practices:

\`\`\`
${rules.content}
\`\`\`

These rules are loaded from: ${rules.source}`;
}
