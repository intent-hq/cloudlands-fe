/**
 * End User Rules Manager
 *
 * Manages user-defined rules stored in electron-store.
 * This is the CRUD interface for user preferences.
 *
 * IMPORTANT: This service should ONLY be accessed by:
 * 1. CachedRulesService (for rules resolution)
 * 2. UI components (for display and editing)
 *
 * Agent factory and other services should use CachedRulesService instead.
 */

import { ConfigManager } from '../../shared/services/config-manager';
import { Logger } from '../../shared/logger';

/**
 * Configuration for a specific rule type
 */
export interface RuleTypeConfig {
  enabled: boolean;
  content: string;
  updatedAt: string;
}

/**
 * All user-defined rules organized by type
 */
export interface EndUserRulesConfig {
  // Layer 1: Base system prompt (applies to ALL agents)
  'base-system-prompt'?: RuleTypeConfig;

  // Layer 2: Specialization rules (per agent type)
  debug?: RuleTypeConfig;
  chat?: RuleTypeConfig;
  'commit-message'?: RuleTypeConfig;
  'task-focused'?: RuleTypeConfig;
  'task-loop'?: RuleTypeConfig;
  'task-breakdown'?: RuleTypeConfig;
  'task-debug'?: RuleTypeConfig;
  workspace?: RuleTypeConfig;
  'workspace-agent'?: RuleTypeConfig;
  'notes-system-guide'?: RuleTypeConfig;
  'code-review'?: RuleTypeConfig;
  'pr-description'?: RuleTypeConfig;

  // Legacy: 'system' type (deprecated, use 'base-system-prompt' instead)
  system?: RuleTypeConfig;

  [key: string]: RuleTypeConfig | undefined; // Allow dynamic rule types
}

export class EndUserRulesManager {
  private static instance: EndUserRulesManager;
  private configManager: ConfigManager | null = null;
  private logger: Logger;
  private initialized = false;

  private constructor() {
    this.logger = new Logger('EndUserRulesManager');
  }

  static getInstance(): EndUserRulesManager {
    if (!EndUserRulesManager.instance) {
      EndUserRulesManager.instance = new EndUserRulesManager();
    }
    return EndUserRulesManager.instance;
  }

  /**
   * Initialize the service with optional ConfigManager instance
   */
  async initialize(configManager?: ConfigManager): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      if (configManager) {
        // Use provided ConfigManager instance (from config.ipc.ts)
        this.configManager = configManager;
        this.logger.info('Using provided ConfigManager instance');
      } else {
        // Fallback: create own instance (for testing or standalone use)
        this.configManager = new ConfigManager();
        await this.configManager.initialize();
        this.logger.info('Created new ConfigManager instance');
      }
      this.initialized = true;
      this.logger.info('EndUserRulesManager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize EndUserRulesManager', error as Error);
      throw error;
    }
  }

  /**
   * Ensure the service is initialized
   */
  private ensureInitialized(): void {
    if (!this.configManager) {
      throw new Error('EndUserRulesManager not initialized. Call initialize() first.');
    }
  }

  /**
   * Get all user-defined rules
   */
  getAllRules(): EndUserRulesConfig {
    this.ensureInitialized();
    const config = this.configManager?.get('endUserRules');

    // PERF: Changed from INFO to DEBUG to reduce log spam
    this.logger.debug('Retrieved all user rules from ConfigManager', {
      hasConfig: !!config,
      types: config ? Object.keys(config) : [],
    });

    return config || {};
  }

  /**
   * Get rules for a specific type
   */
  getRulesByType(type: string): RuleTypeConfig | null {
    this.ensureInitialized();
    const allRules = this.getAllRules();
    const rules = allRules[type];

    this.logger.debug('Retrieved rules by type', {
      type,
      hasRules: !!rules,
      enabled: rules?.enabled,
      contentLength: rules?.content?.length || 0,
    });

    return rules || null;
  }

  /**
   * Get formatted rules for a specific type
   * Used by CachedRulesService for rules resolution
   */
  getFormattedRulesByType(type: string): string | null {
    const rules = this.getRulesByType(type);

    // PERF: Changed from INFO to DEBUG to reduce log spam
    this.logger.debug('Getting formatted rules by type', {
      type,
      hasRules: !!rules,
      enabled: rules?.enabled,
      contentLength: rules?.content?.length || 0,
    });

    if (!rules || !rules.enabled || !rules.content) {
      this.logger.debug('Rules not enabled or no content', { type });
      return null;
    }

    return rules.content;
  }

  /**
   * Update rules for a specific type
   */
  updateRulesByType(type: string, content: string): void {
    this.ensureInitialized();
    const allRules = this.getAllRules();

    allRules[type] = {
      enabled: allRules[type]?.enabled ?? true,
      content,
      updatedAt: new Date().toISOString(),
    };

    if (this.configManager) {
      this.configManager.set('endUserRules', allRules);
    }

    this.logger.info('Updated rules by type', {
      type,
      contentLength: content.length,
    });
  }

  /**
   * Enable/disable rules for a specific type
   */
  setRulesEnabledByType(type: string, enabled: boolean): void {
    this.ensureInitialized();
    const allRules = this.getAllRules();

    const existing = allRules[type];
    if (!existing) {
      allRules[type] = {
        enabled,
        content: '',
        updatedAt: new Date().toISOString(),
      };
    } else {
      existing.enabled = enabled;
      existing.updatedAt = new Date().toISOString();
    }

    if (this.configManager) {
      this.configManager.set('endUserRules', allRules);
    }

    this.logger.info(`Rules ${enabled ? 'enabled' : 'disabled'} for type`, { type });
  }

  /**
   * Delete rules for a specific type
   */
  deleteRulesByType(type: string): void {
    this.ensureInitialized();
    const allRules = this.getAllRules();

    delete allRules[type];

    if (this.configManager) {
      this.configManager.set('endUserRules', allRules);
    }

    this.logger.info('Deleted rules by type', { type });
  }

  /**
   * Export all rules as JSON
   */
  exportAllRules(): string {
    const config = this.getAllRules();
    return JSON.stringify(config, null, 2);
  }

  /**
   * Export rules for a specific type as JSON
   */
  exportRulesByType(type: string): string {
    const rules = this.getRulesByType(type);
    return JSON.stringify(rules, null, 2);
  }

  /**
   * Import rules from JSON
   * Supports both old format (single content) and new format (per-type)
   */
  importRules(jsonString: string): void {
    this.ensureInitialized();
    try {
      const imported = JSON.parse(jsonString);

      // Check if it's the new format (per-type)
      if (imported && typeof imported === 'object' && !Array.isArray(imported)) {
        // Check if it has the new structure
        const hasNewStructure = Object.values(imported).some(
          (val: any) => val && typeof val === 'object' && 'enabled' in val && 'content' in val,
        );

        if (hasNewStructure) {
          // New format - import directly
          if (this.configManager) {
            this.configManager.set('endUserRules', imported);
          }
          this.logger.info('Imported rules (new format)', {
            types: Object.keys(imported),
          });
          return;
        }

        // Old format - migrate to 'system' type
        if (imported.content !== undefined) {
          this.updateRulesByType('system', imported.content);
          this.setRulesEnabledByType('system', imported.enabled ?? true);
          this.logger.info('Imported rules (old format, migrated to system type)');
          return;
        }
      }

      // Handle array format (very old)
      if (Array.isArray(imported)) {
        const content = imported
          .filter((r: any) => r.enabled !== false)
          .map((r: any) => r.content)
          .join('\n\n---\n\n');
        this.updateRulesByType('system', content);
        this.logger.info('Imported rules (array format, migrated to system type)');
        return;
      }

      // Plain string
      if (typeof imported === 'string') {
        this.updateRulesByType('system', imported);
        this.logger.info('Imported rules (string format, migrated to system type)');
        return;
      }

      throw new Error('Invalid rules format');
    } catch (error) {
      this.logger.error('Failed to import rules', error as Error);
      throw error;
    }
  }

  /**
   * Get list of all rule types that have content
   */
  getAvailableRuleTypes(): string[] {
    const allRules = this.getAllRules();
    return Object.keys(allRules).filter((type) => {
      const rules = allRules[type];
      return rules && rules.content && rules.content.trim().length > 0;
    });
  }
}

// Export singleton instance
export const endUserRulesManager = EndUserRulesManager.getInstance();

// Export legacy aliases for backward compatibility during migration
export const workspaceRulesService = endUserRulesManager;
export const userRulesService = endUserRulesManager;

// Export class with legacy name for backward compatibility
export { EndUserRulesManager as WorkspaceRulesService };
