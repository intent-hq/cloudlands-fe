/**
 * Instruction Service (BACKEND ONLY)
 *
 * THE ONLY SERVICE for loading agent instruction content.
 * Runs ONLY in the main process (Node.js).
 *
 * Responsibilities:
 * - Load base system prompt
 * - Load workspace rules (CLAUDE.md, AGENTS.md, .augment/guidelines.md)
 * - Load specialization rules with 3-tier fallback
 * - Assemble complete system prompts
 * - Caching with TTL and LRU eviction
 * - File watching for auto-invalidation
 *
 * System prompt layers:
 * 1. Base system prompt (identity and tools)
 * 2. Specialization rules (common → workspace → agent-specific instructions)
 * 3. User rules (CLAUDE.md, AGENTS.md, .augment/guidelines.md, .augment/rules/)
 * 4. Skills catalog (.agents/skills, .augment/skills, ~/.claude/skills)
 * 5. Agent behavior instructions (specialist role)
 * 6. Parent-only orchestration layers (3.5a-3.8: team context, knobs, specialists, branch naming)
 * 7. Workspace context (open panels + linked references)
 * 8. Runtime context (contextReferences)
 * 9. Mandatory actions footer (includes specialist role reminder for recency)
 *
 * The role reminder remains at the end for recency reinforcement.
 * Modes (ask, plan, agent) are only used for tool filtering.
 *
 * 3-tier fallback for specialization rules:
 * 1. EndUserRulesManager (electron-store) - User customizations
 * 2. Workspace files (.augment/agent-rules/{type}.md) - Workspace overrides
 * 3. Bundled defaults (TypeScript constants) - Built-in instructions
 */

import * as fs from 'fs/promises';
import {
  watch,
  type FSWatcher,
} from 'fs';
import os from 'os';
import path from 'path';
import { Logger } from '$shared/logger';
import { isWorkspaceSlug } from '$shared/services/workspace-slug';
import { createCache } from '../../../main/utils/cache';
import { EndUserRulesManager } from '../../rules/user-rules.service';
import {
  getInstructionWithCommon,
  NON_INTERACTIVE_BACKGROUND_AGENTS,
} from '../instructions';
import { getBaseInstruction } from '../instructions/base-system-prompt';
import {
  loadUserRules,
  formatUserRulesForContext,
} from './rules-loader';
import { formatSkillsCatalogForPrompt } from './skills-loader';
import {
  formatSpecialistsForPrompt,
  initSpecialistsService,
} from './specialists.service';
import {
  formatActiveTeamForPrompt,
  formatGlobalKnobsForPrompt,
  initAgentTeamsService,
} from './agent-teams.service';
import { getBranchPrefix } from '../../workspace/main/app-settings.service';
import { getRepoBranchPrefix } from '../../workspace/main/repo-config.service';

const logger = new Logger('InstructionService');

// System prompt length limits
// These should match the validator limits in agent-validator.ts
const MAX_SYSTEM_PROMPT_LENGTH = 200000; // 200k chars (~50k tokens)
const WARNING_THRESHOLD = 150000; // Warn when approaching 75% of limit

interface CacheEntry {
  content: string;
  hits: number;
}

interface PromptLayer {
  name: string;
  content: string;
  priority: number; // Lower = more important, less likely to be truncated
  canTruncate: boolean;
}

export class InstructionService {
  private static instance: InstructionService;

  // Caching for specialization rules (TTL 5 minutes, LRU eviction at 100 entries)
  private cache = createCache<string, CacheEntry>({
    name: 'instruction-specialization-rules',
    ttlMs: 5 * 60 * 1000,
    maxSize: 100,
  });

  // Caching for full system prompts (performance optimization for bulk task delegation)
  // Shorter TTL for full prompts; small max size since these are large strings
  private systemPromptCache = createCache<string, CacheEntry>({
    name: 'instruction-system-prompts',
    ttlMs: 30 * 1000,
    maxSize: 20,
  });

  // File watching
  private watchers = new Map<string, FSWatcher>();

  // Dependencies
  private endUserRulesManager: EndUserRulesManager;

  private constructor() {
    this.endUserRulesManager = EndUserRulesManager.getInstance();
    // Initialize specialists service for dynamic specialist config in prompts
    initSpecialistsService().catch((error) => {
      logger.warn('Failed to initialize specialists service', { error });
    });
    // Initialize agent teams service for team context in prompts
    initAgentTeamsService().catch((error) => {
      logger.warn('Failed to initialize agent teams service', { error });
    });
    logger.info('InstructionService initialized');
  }

  static getInstance(): InstructionService {
    if (!InstructionService.instance) {
      InstructionService.instance = new InstructionService();
    }
    return InstructionService.instance;
  }

  /**
   * Get base system prompt with user additions
   *
   * Always starts with the bundled default, then appends user customizations:
   * 1. Bundled default (TypeScript constant) - Always included
   * 2. EndUserRulesManager ('base-system-prompt' type) - Appended if exists
   * 3. EndUserRulesManager ('system' type) - Legacy, appended if exists
   *
   * Returns the foundational system prompt used by all agents
   */
  getBaseSystemPrompt(): string {
    const parts: string[] = [];

    // 1. Always start with bundled default (includes CDP debug tools when enabled)
    const bundledDefault = getBaseInstruction();
    parts.push(bundledDefault);
    logger.debug('Base system prompt: bundled default added', {
      contentLength: bundledDefault.length,
    });

    // 2. Append 'base-system-prompt' type if exists
    try {
      const userDefined = this.endUserRulesManager.getFormattedRulesByType('base-system-prompt');
      if (userDefined && userDefined.trim().length > 0) {
        parts.push(userDefined);
        logger.debug('Base system prompt: user customization appended (base-system-prompt type)', {
          contentLength: userDefined.length,
        });
      }
    } catch (error) {
      logger.debug('Could not load user base-system-prompt', { error });
    }

    // 3. Append 'system' type (legacy) if exists
    try {
      const legacyUserDefined = this.endUserRulesManager.getFormattedRulesByType('system');
      if (legacyUserDefined && legacyUserDefined.trim().length > 0) {
        parts.push(legacyUserDefined);
        logger.debug('Base system prompt: user customization appended (system type - legacy)', {
          contentLength: legacyUserDefined.length,
        });
      }
    } catch (error) {
      logger.debug('Could not load user system rules', { error });
    }

    const finalPrompt = parts.join('\n\n');
    logger.debug('Base system prompt assembled', {
      totalLength: finalPrompt.length,
      partsCount: parts.length,
    });

    return finalPrompt;
  }

  /**
   * Get specialization rules with 3-tier fallback
   *
   * Resolution order:
   * 1. EndUserRulesManager (user customizations in electron-store)
   * 2. Workspace file (.augment/agent-rules/{agentType}.md)
   * 3. Bundled defaults (TypeScript constants with common prepended)
   *
   * @param agentType - The agent type (debug, investigate, implement, etc.)
   * @param workspacePath - Optional workspace path for workspace-level overrides
   * @returns The specialization rules content
   */
  async getSpecializationRules(agentType: string, workspacePath?: string): Promise<string> {
    const cacheKey = `specialization:${agentType}:${workspacePath || 'default'}`;

    // Check cache (get() refreshes LRU recency)
    const cached = this.cache.get(cacheKey);
    if (cached) {
      cached.hits++;
      logger.debug('Specialization rules cache hit', { agentType, hits: cached.hits });
      return cached.content;
    }

    // 1. Check EndUserRulesManager
    try {
      const userDefined = this.endUserRulesManager.getFormattedRulesByType(agentType);
      if (userDefined && userDefined.trim().length > 0) {
        this.cache.set(cacheKey, { content: userDefined, hits: 0 });
        logger.debug('Specialization rules loaded from EndUserRulesManager', {
          agentType,
          contentLength: userDefined.length,
        });
        return userDefined;
      }
    } catch (error) {
      logger.debug('Could not load specialization rules from EndUserRulesManager', {
        agentType,
        error,
      });
    }

    // 2. Check workspace file
    if (workspacePath) {
      const workspaceFile = path.join(workspacePath, '.augment', 'agent-rules', `${agentType}.md`);
      const content = await this.readFileSafe(workspaceFile);
      if (content && content.trim().length > 0) {
        this.cache.set(cacheKey, { content, hits: 0 });
        this.watchFile(workspaceFile, () => {
          this.cache.delete(cacheKey);
          this.invalidateSystemPromptCache(agentType, workspacePath);
          logger.debug('Cache invalidated due to file change', { agentType, workspaceFile });
        });
        logger.debug('Specialization rules loaded from workspace file', {
          agentType,
          workspacePath,
          contentLength: content.length,
        });
        return content;
      }
    }

    // 3. Return TS constant (with common prepended)
    const tsConstant = getInstructionWithCommon(agentType);
    this.cache.set(cacheKey, { content: tsConstant, hits: 0 });
    logger.debug('Specialization rules loaded from bundled TS constants', {
      agentType,
      contentLength: tsConstant.length,
    });
    return tsConstant;
  }

  /**
   * Build complete system prompt with all layers
   *
   * Combines layers in this order:
   * base → specialization → user rules → skills → behavior → parent-only layers → workspace context → runtime → footer
   *
   * The mandatory footer keeps the role reminder at the end for recency reinforcement.
   *
   * @param config - Configuration for building the system prompt
   * @returns The complete system prompt
   */
  async buildSystemPrompt(config: {
    agentType?: string;
    workspacePath?: string;
    contextReferences?: string[];
    behaviorPrompt?: string;
    specialistName?: string; // e.g., "Coordinator", "Implementor", "Verifier"
    roleReminder?: string; // Critical constraints reminder for the specialist (injected at end for recency)
    workspaceContext?: {
      openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
      linkedReferences: Array<{
        type: string;
        title: string;
        identifier?: string;
        url?: string;
      }>;
    };
    workspaceTitle?: string; // Current workspace title (empty or slug means needs renaming)
    isInitialAgent?: boolean; // True if this is the first agent in the workspace (should rename workspace)
    isSubAgent?: boolean; // True if this is a delegated/background sub-agent (gets lighter prompt)
    autoCommitEnabled?: boolean; // Whether auto-commit is enabled for this workspace
  }): Promise<string> {
    const hasBehaviorPrompt = !!config.behaviorPrompt && config.behaviorPrompt.trim().length > 0;

    // Build cache key for prompts WITHOUT context references (context references are unique per agent)
    // Only cache when there are no context references (the common case for task delegation)
    // Also don't cache if workspaceContext is provided
    const hasWorkspaceContext =
      config.workspaceContext &&
      (config.workspaceContext.openPanels.length > 0 ||
        config.workspaceContext.linkedReferences.length > 0);
    let isCacheable =
      (!config.contextReferences || config.contextReferences.length === 0) && !hasWorkspaceContext;

    let prefetchedSkillsCatalog: string | null = null;
    if (isCacheable && config.workspacePath) {
      try {
        prefetchedSkillsCatalog = await formatSkillsCatalogForPrompt(config.workspacePath);
      } catch (error) {
        logger.warn('Failed to prefetch skills catalog for system prompt cache', {
          workspacePath: config.workspacePath,
          error,
        });
        // Disable caching: the cache key would hash empty skills, but the prompt
        // may later retry and include actual skills content, creating a mismatch.
        isCacheable = false;
      }
    }

    // Include isInitialAgent and workspaceTitle in cache key since they affect the prompt
    // (initial agents get workspace rename instructions based on title)
    const initialAgentSuffix = config.isInitialAgent ? ':initial' : '';
    // Normalize workspace title for cache key: empty/whitespace = 'empty', slug = 'slug', otherwise 'titled'
    const titleStatus =
      !config.workspaceTitle || config.workspaceTitle.trim() === ''
        ? 'empty'
        : isWorkspaceSlug(config.workspaceTitle)
          ? 'slug'
          : 'titled';

    const subAgentSuffix = config.isSubAgent ? ':subagent' : '';
    const autoCommitSuffix = config.autoCommitEnabled ? ':autocommit' : '';
    const skillsCatalogSuffix =
      isCacheable && config.workspacePath
        ? `:skills:${this.hashString(prefetchedSkillsCatalog ?? '')}`
        : '';
    const behaviorPromptSuffix =
      isCacheable && hasBehaviorPrompt
        ? `:behavior:${this.hashString(config.behaviorPrompt ?? '')}`
        : '';
    const roleReminderSuffix =
      isCacheable && (config.specialistName || config.roleReminder)
        ? `:role:${this.hashString(`${config.specialistName ?? ''}\n${config.roleReminder ?? ''}`)}`
        : '';
    const cacheKey = isCacheable
      ? `prompt:${config.agentType || 'default'}:${config.workspacePath || 'default'}${initialAgentSuffix}${subAgentSuffix}${autoCommitSuffix}:${titleStatus}${skillsCatalogSuffix}${behaviorPromptSuffix}${roleReminderSuffix}`
      : null;

    // Check cache for frequently-used prompts (e.g., bulk task delegation)
    if (cacheKey) {
      const cached = this.getSystemPromptFromCache(cacheKey);
      if (cached) {
        logger.debug('System prompt cache hit', {
          cacheKey,
          agentType: config.agentType,
          length: cached.length,
        });
        return cached;
      }
    }

    logger.debug('InstructionService.buildSystemPrompt called', {
      agentType: config.agentType,
      workspacePath: config.workspacePath,
      hasContextReferences: !!config.contextReferences,
      contextReferencesCount: config.contextReferences?.length || 0,
      isCacheable,
      hasBehaviorPrompt,
    });

    // Non-interactive background agents get a minimal prompt
    // They don't need base identity, specialist config, user rules, etc.
    // Just their specific instruction - they output a result and that's it
    if (config.agentType && NON_INTERACTIVE_BACKGROUND_AGENTS.has(config.agentType)) {
      const rules = await this.getSpecializationRules(config.agentType, config.workspacePath);
      logger.info('Non-interactive background agent - using minimal prompt', {
        agentType: config.agentType,
        rulesLength: rules.length,
      });

      // Cache and return
      if (cacheKey) {
        this.setSystemPromptCache(cacheKey, rules);
      }
      return rules;
    }

    const parts: PromptLayer[] = [];
    const behaviorSection = hasBehaviorPrompt
      ? `# Your Specialist Role

<specialist_role>
${config.behaviorPrompt}
</specialist_role>

The instructions in <specialist_role> define your primary function. Prioritize them above general guidance.`
      : null;

    const formatLayerSizes = (layers: PromptLayer[]) =>
      layers.map((layer, i) => ({
        layer: i + 1,
        name: layer.name,
        length: layer.content.length,
        priority: layer.priority,
        canTruncate: layer.canTruncate,
      }));

    const addBehaviorSection = (layerLabel: string, positionLabel: string): void => {
      if (!behaviorSection) {
        logger.debug('Agent behavior instructions not added (no behavior prompt provided)', {
          hasConfig: !!config.behaviorPrompt,
          configLength: config.behaviorPrompt?.length || 0,
        });
        return;
      }

      parts.push({
        name: 'behavior-prompt',
        content: behaviorSection,
        priority: 1,
        canTruncate: false,
      });
      logger.info(`${layerLabel}: Agent behavior instructions added (${positionLabel})`, {
        length: behaviorSection.length,
        preview: config.behaviorPrompt?.substring(0, 100),
      });
    };

    const addParentOnlyLayers = async (): Promise<void> => {
      // Sub-agents (delegated/background) get a lighter prompt to reduce token consumption.
      // They skip layers 3.5-3.8 (team context, knobs, specialist listing, branch naming)
      // and layer 4.5 (workspace context) since they already have their specialist assigned
      // and don't need the full orchestration context.
      if (config.isSubAgent) {
        logger.info(
          'Sub-agent: skipping layers 3.5-3.8 (team context, knobs, specialist listing, branch naming)',
          {
            agentType: config.agentType,
          },
        );
        return;
      }

      // Layer 3.5: Agent team context (active team, philosophy, specialists)
      try {
        const teamPrompt = formatActiveTeamForPrompt();
        if (teamPrompt) {
          parts.push({
            name: 'team-context',
            content: teamPrompt,
            priority: 3,
            canTruncate: true,
          });
          logger.debug('Layer 3.5a: Agent team context added', {
            length: teamPrompt.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load agent team context', { error });
      }

      // Layer 3.6: Global knobs (diff budget, test strictness)
      try {
        const knobsPrompt = formatGlobalKnobsForPrompt();
        if (knobsPrompt) {
          parts.push({
            name: 'global-knobs',
            content: knobsPrompt,
            priority: 3,
            canTruncate: true,
          });
          logger.debug('Layer 3.6: Global knobs added', {
            length: knobsPrompt.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load global knobs', { error });
      }

      // Layer 3.7: Specialist configuration (dynamic, from user settings)
      try {
        const specialistsPrompt = await formatSpecialistsForPrompt(config.workspacePath);
        if (specialistsPrompt) {
          parts.push({
            name: 'specialists',
            content: specialistsPrompt,
            priority: 3,
            canTruncate: true,
          });
          logger.debug('Layer 3.7: Specialist configuration added', {
            length: specialistsPrompt.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load specialist configuration', { error });
      }

      // Layer 3.8: Branch naming preference
      try {
        const branchPreference = await this.getBranchPreferenceSection(config.workspacePath);
        if (branchPreference) {
          parts.push({
            name: 'branch-naming',
            content: branchPreference,
            priority: 3,
            canTruncate: true,
          });
          logger.debug('Layer 3.8: Branch naming preference added', {
            length: branchPreference.length,
          });
        }
      } catch (error) {
        logger.warn('Failed to load branch naming preference', { error });
      }
    };

    const addUserRulesLayer = async (): Promise<void> => {
      // Layer 4: User rules (CLAUDE.md, AGENTS.md, .augment/guidelines.md, .augment/rules/)
      // These come after specialization as they are project-specific conventions.
      if (!config.workspacePath) {
        logger.debug('Layer 4: Skipping user rules (no workspacePath)');
        return;
      }

      try {
        const userRules = await loadUserRules({
          workspacePath: config.workspacePath,
        });
        if (userRules && userRules.content.trim().length > 0) {
          const formattedRules = formatUserRulesForContext(userRules);
          parts.push({
            name: 'user-rules',
            content: formattedRules,
            priority: 2,
            canTruncate: true,
          });
          logger.debug('Layer 4: User rules added', {
            source: userRules.source,
            length: formattedRules.length,
            type: userRules.type,
          });
        } else {
          logger.debug('Layer 4: No user rules found', {
            workspacePath: config.workspacePath,
          });
        }
      } catch (error) {
        logger.warn('Failed to load user rules', {
          workspacePath: config.workspacePath,
          error,
        });
      }
    };

    const addSkillsLayer = async (): Promise<void> => {
      // Layer 4.7: Skills catalog (.agents/skills, .augment/skills, ~/.claude/skills)
      // Available to all agents, including sub-agents, so they can discover execution skills.
      if (!config.workspacePath) {
        logger.debug('Layer 4.7: Skipping skills catalog (no workspacePath)');
        return;
      }

      try {
        const skillsCatalog =
          prefetchedSkillsCatalog ?? (await formatSkillsCatalogForPrompt(config.workspacePath));
        if (skillsCatalog.trim().length > 0) {
          parts.push({
            name: 'skills-catalog',
            content: skillsCatalog,
            priority: 3,
            canTruncate: true,
          });
          logger.debug('Layer 4.7: Skills catalog added', {
            workspacePath: config.workspacePath,
            length: skillsCatalog.length,
          });
        } else {
          logger.debug('Layer 4.7: No skills catalog found', {
            workspacePath: config.workspacePath,
          });
        }
      } catch (error) {
        logger.warn('Failed to load skills catalog', {
          workspacePath: config.workspacePath,
          error,
        });
      }
    };

    // Layer 2: Base system prompt (identity and tools)
    const basePrompt = this.getBaseSystemPrompt();
    parts.push({
      name: 'base-system-prompt',
      content: basePrompt,
      priority: 1,
      canTruncate: false,
    });
    logger.debug('Layer 2: Base system prompt added', {
      length: basePrompt.length,
      firstLine: basePrompt.split('\n')[0],
    });

    // Layer 3: Specialization rules (agent-type specific instructions)
    // These are generic instructions for the agent type (investigate, implement, etc.)
    if (config.agentType) {
      const rules = await this.getSpecializationRules(config.agentType, config.workspacePath);
      parts.push({
        name: 'specialization-rules',
        content: rules,
        priority: 1,
        canTruncate: false,
      });
      logger.debug('Layer 3: Specialization rules added', {
        agentType: config.agentType,
        length: rules.length,
        firstLine: rules.split('\n')[0],
      });
    } else {
      logger.warn('No agentType provided, skipping specialization rules');
    }

    await addUserRulesLayer();
    await addSkillsLayer();
    addBehaviorSection('Layer 4.8', 'shared-prefix boundary');
    await addParentOnlyLayers();

    // Layer 4.4: Auto-commit setting
    // Tells agents whether auto-commit is enabled so they don't suggest manual commits
    if (config.autoCommitEnabled !== undefined) {
      const autoCommitLine = config.autoCommitEnabled
        ? 'Auto-commit is enabled for this workspace. Changes are committed automatically when tasks complete. Do not suggest committing changes.'
        : 'Auto-commit is disabled for this workspace. The user must commit changes manually or ask you to commit.';
      parts.push({
        name: 'auto-commit-setting',
        content: `## Workspace Settings\n\n${autoCommitLine}`,
        priority: 4,
        canTruncate: true,
      });
      logger.debug('Layer 4.4: Auto-commit setting added', {
        autoCommitEnabled: config.autoCommitEnabled,
      });
    }

    // Layer 4.5: Workspace context (open panels + linked references)
    // Shows what panels are open and what external references are linked to this workspace
    // Skipped for sub-agents since they don't need UI context
    if (!config.isSubAgent && hasWorkspaceContext && config.workspaceContext) {
      const workspaceSection = this.formatWorkspaceContext(config.workspaceContext);
      parts.push({
        name: 'workspace-context',
        content: workspaceSection,
        priority: 4,
        canTruncate: true,
      });
      logger.debug('Layer 4.5: Workspace context added', {
        length: workspaceSection.length,
        openPanelsCount: config.workspaceContext.openPanels.length,
        linkedReferencesCount: config.workspaceContext.linkedReferences.length,
      });
    }

    // Layer 5: Runtime context
    if (config.contextReferences && config.contextReferences.length > 0) {
      const contextSection = this.formatContextReferences(config.contextReferences);
      parts.push({
        name: 'runtime-context',
        content: contextSection,
        priority: 4,
        canTruncate: true,
      });
      logger.debug('Layer 5: Runtime context added', {
        length: contextSection.length,
        referencesCount: config.contextReferences.length,
      });
    }

    // Layer 6: Mandatory actions footer (for agents with critical first steps)
    // Also includes specialist role reminder for recency effect
    const mandatoryActions = this.getMandatoryActionsFooter(
      config.agentType,
      config.specialistName,
      config.roleReminder,
      !!config.isSubAgent,
      !!config.autoCommitEnabled,
    );
    if (mandatoryActions) {
      parts.push({
        name: 'mandatory-actions-footer',
        content: mandatoryActions,
        priority: 1,
        canTruncate: false,
      });
      logger.debug('Layer 6: Mandatory actions footer added', {
        agentType: config.agentType,
        length: mandatoryActions.length,
        hasRoleReminder: !!config.roleReminder,
      });
    }

    let finalPrompt = parts.map((part) => part.content).join('\n\n---\n\n');

    // Check prompt length and handle if too long
    const promptLength = finalPrompt.length;

    if (promptLength > MAX_SYSTEM_PROMPT_LENGTH) {
      // Log detailed breakdown for debugging
      logger.error('System prompt exceeds maximum length - attempting truncation', {
        totalLength: promptLength,
        maxLength: MAX_SYSTEM_PROMPT_LENGTH,
        excess: promptLength - MAX_SYSTEM_PROMPT_LENGTH,
        layersCount: parts.length,
        layerSizes: formatLayerSizes(parts),
        agentType: config.agentType,
      });

      finalPrompt = this.truncatePromptToFit(parts, MAX_SYSTEM_PROMPT_LENGTH);

      if (finalPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
        logger.error('System prompt still too long after truncation', {
          finalLength: finalPrompt.length,
          maxLength: MAX_SYSTEM_PROMPT_LENGTH,
          agentType: config.agentType,
        });
      } else {
        logger.warn('System prompt truncated to fit within limits', {
          originalLength: promptLength,
          truncatedLength: finalPrompt.length,
          agentType: config.agentType,
        });
      }
    } else if (promptLength > WARNING_THRESHOLD) {
      // Warn when approaching the limit
      logger.warn('System prompt approaching maximum length', {
        totalLength: promptLength,
        maxLength: MAX_SYSTEM_PROMPT_LENGTH,
        percentUsed: Math.round((promptLength / MAX_SYSTEM_PROMPT_LENGTH) * 100),
        agentType: config.agentType,
        layerSizes: formatLayerSizes(parts),
      });
    }

    logger.debug('System prompt built successfully', {
      totalLength: finalPrompt.length,
      layersCount: parts.length,
    });

    // Cache the result for subsequent agents with same config
    if (cacheKey) {
      this.setSystemPromptCache(cacheKey, finalPrompt);
      logger.debug('System prompt cached', { cacheKey, length: finalPrompt.length });
    }

    // Save prompt to file for debugging (async, don't wait)
    if (config.workspacePath) {
      this.savePromptToFile(finalPrompt, config.workspacePath, config.agentType).catch((error) => {
        logger.debug('Failed to save prompt to file', { error });
      });
    }

    return finalPrompt;
  }

  /**
   * Truncate prompt to fit within the maximum length by removing truncatable
   * layers in descending priority order while preserving the original assembly
   * order for the layers that remain.
   */
  private truncatePromptToFit(layers: PromptLayer[], maxLength: number): string {
    const separator = '\n\n---\n\n';
    const separatorLength = separator.length;
    const getTotalLength = (promptLayers: PromptLayer[]): number =>
      promptLayers.reduce((sum, layer) => sum + layer.content.length, 0) +
      Math.max(promptLayers.length - 1, 0) * separatorLength;

    if (getTotalLength(layers) <= maxLength) {
      return layers.map((layer) => layer.content).join(separator);
    }

    const remainingIndexes = new Set(layers.map((_, index) => index));
    const truncationOrder = layers
      .map((layer, index) => ({ layer, index }))
      .filter(({ layer }) => layer.canTruncate)
      .sort((left, right) => right.layer.priority - left.layer.priority);

    let remainingLayers = layers;

    for (const { layer, index } of truncationOrder) {
      if (getTotalLength(remainingLayers) <= maxLength) {
        break;
      }

      remainingIndexes.delete(index);
      remainingLayers = layers.filter((_, layerIndex) => remainingIndexes.has(layerIndex));

      logger.warn('Truncating system prompt layer to fit within limits', {
        removedLayer: layer.name,
        removedLayerLength: layer.content.length,
        remainingLayers: remainingLayers.length,
        currentLength: getTotalLength(remainingLayers),
        targetLength: maxLength,
      });
    }

    if (getTotalLength(remainingLayers) > maxLength) {
      logger.warn('System prompt still exceeds maximum length after dropping all truncatable layers', {
        currentLength: getTotalLength(remainingLayers),
        targetLength: maxLength,
        remainingLayers: remainingLayers.map((layer) => layer.name),
      });
    }

    return remainingLayers.map((layer) => layer.content).join(separator);
  }

  /**
   * Get system prompt from cache if valid
   */
  private getSystemPromptFromCache(key: string): string | null {
    const entry = this.systemPromptCache.get(key);
    if (!entry) return null;

    entry.hits++;
    return entry.content;
  }

  /**
   * Set system prompt cache entry
   */
  private setSystemPromptCache(key: string, content: string): void {
    this.systemPromptCache.set(key, { content, hits: 0 });
  }

  /**
   * Create a stable, compact hash for cache key components.
   */
  private hashString(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
  }

  /**
   * Invalidate cache for a specific agent type
   */
  invalidate(agentType: string, workspacePath?: string): void {
    const cacheKey = `specialization:${agentType}:${workspacePath || 'default'}`;
    this.cache.delete(cacheKey);
    this.invalidateSystemPromptCache(agentType, workspacePath);
    logger.debug('Cache invalidated', { agentType, workspacePath });
  }

  private invalidateSystemPromptCache(agentType: string, workspacePath?: string): void {
    const keyPrefix = `prompt:${agentType}:${workspacePath || 'default'}:`;
    for (const key of this.systemPromptCache.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.systemPromptCache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clearCache(): void {
    this.cache.clear();
    this.systemPromptCache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; totalHits: number; watcherCount: number } {
    let totalHits = 0;
    // keys() is LRU-ordered, so iterating with get() preserves relative recency
    for (const key of this.cache.keys()) {
      const entry = this.cache.get(key);
      if (entry) {
        totalHits += entry.hits;
      }
    }

    return {
      size: this.cache.size,
      totalHits,
      watcherCount: this.watchers.size,
    };
  }

  /**
   * Pre-warm the system prompt cache for a workspace.
   * Call this when a workspace is opened to avoid cold start latency
   * on the first agent creation.
   *
   * This warms the cache for common agent types WITHOUT creating actual agents.
   * The system prompt is built from rules files and can be cached independently.
   *
   * @param workspacePath - The workspace path to warm cache for
   * @param agentTypes - Optional list of agent types to warm (defaults to common types)
   */
  async warmCache(
    workspacePath: string,
    agentTypes: string[] = ['workspace', 'task-focused', 'code-review'],
  ): Promise<void> {
    const startTime = Date.now();
    logger.info('Warming system prompt cache', { workspacePath, agentTypes });

    try {
      // Warm caches in parallel for all agent types
      await Promise.all(
        agentTypes.map(async (agentType) => {
          try {
            // Build system prompt (this populates the cache)
            await this.buildSystemPrompt({
              agentType,
              workspacePath,
              // No context references - we're just warming the cache
            });
            logger.debug('Cache warmed for agent type', { agentType });
          } catch (error) {
            // Don't fail the whole warm operation if one type fails
            logger.warn('Failed to warm cache for agent type', { agentType, error });
          }
        }),
      );

      const duration = Date.now() - startTime;
      logger.info('System prompt cache warmed', {
        workspacePath,
        agentTypes,
        duration,
        cacheStats: this.getStats(),
      });
    } catch (error) {
      logger.error('Failed to warm system prompt cache', { error });
    }
  }

  // ========== PRIVATE METHODS ==========

  /**
   * Save the system prompt to a file for debugging
   * Saves to ~/intent/{workspaceId}/.workspace/prompts/{agentType}-latest.txt
   *
   * Note: workspacePath is the worktree path (e.g., ~/intent/{id}/{repo}__workspace-{shortId}/)
   * We need to save to the metadata directory (parent/.workspace/) to avoid polluting the git repo.
   */
  private async savePromptToFile(
    prompt: string,
    workspacePath: string,
    agentType?: string,
  ): Promise<void> {
    try {
      const pathModule = await import('path');
      const fs = await import('fs/promises');

      // workspacePath is the worktree (git repo) path: ~/intent/{workspaceId}/{repo}__workspace-{shortId}/
      // We need to save to the metadata directory: ~/intent/{workspaceId}/.workspace/prompts/
      // Get the workspace root by going up one directory from the worktree
      const workspaceRoot = pathModule.dirname(workspacePath);

      // Create prompts directory in the metadata folder (not in the git repo)
      const promptsDir = pathModule.join(workspaceRoot, '.workspace', 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });

      // Save to file with agentType in filename
      const filename = `${agentType || 'default'}-latest.txt`;
      const filepath = pathModule.join(promptsDir, filename);
      await fs.writeFile(filepath, prompt, 'utf-8');

      logger.debug('System prompt saved to file', {
        filepath: filepath.replace(os.homedir(), '~'),
        agentType,
        length: prompt.length,
      });
    } catch (error) {
      // Silently fail - this is just for debugging
      logger.debug('Failed to save prompt to file', { error });
    }
  }

  /**
   * Safely read a file, returning null if it doesn't exist
   */
  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Watch a file for changes and call callback on change
   */
  private watchFile(filePath: string, onInvalidate: () => void): void {
    // Don't create duplicate watchers
    if (this.watchers.has(filePath)) {
      return;
    }

    try {
      const watcher = watch(filePath, (eventType) => {
        logger.debug('File change detected', { filePath, eventType });
        onInvalidate();
      });

      this.watchers.set(filePath, watcher);
      logger.debug('File watcher created', { filePath });
    } catch (error) {
      // File watching is optional - don't fail if it doesn't work
      logger.debug('Could not watch file', { filePath, error });
    }
  }

  /**
   * Resolve the effective branch prefix and format it as a prompt section.
   * Checks repo-level config first (.intent/config.json), then falls back to global app setting.
   * Returns null if no branch prefix is configured.
   */
  private async getBranchPreferenceSection(workspacePath?: string): Promise<string | null> {
    // Check repo-level config first, then fall back to global app setting
    const repoBranchPrefix = workspacePath ? await getRepoBranchPrefix(workspacePath) : undefined;
    const branchPrefix = repoBranchPrefix ?? getBranchPrefix();

    if (!branchPrefix) {
      return null;
    }

    return `# User Preferences

## Branch Naming
All new branches must use the prefix "${branchPrefix}" (e.g. "${branchPrefix}my-feature").`;
  }

  /**
   * Format context references for inclusion in system prompt
   */
  private formatContextReferences(refs: string[]): string {
    return `# Runtime Context\n\n${refs.join('\n\n')}`;
  }

  /**
   * Format workspace context (open panels + linked references).
   * Shows what the user is currently looking at and what they've linked.
   * Agents can use existing MCP tools (Linear, Sentry, etc.) to get more details.
   */
  private formatWorkspaceContext(context: {
    openPanels: Array<{ type: string; title: string; id?: string; path?: string }>;
    linkedReferences: Array<{
      type: string;
      title: string;
      identifier?: string;
      url?: string;
    }>;
  }): string {
    const lines = ['## Workspace Context', ''];

    // Open panels section
    if (context.openPanels.length > 0) {
      lines.push('### Open Panels');
      for (const panel of context.openPanels) {
        const idOrPath = panel.path || (panel.id ? `(${panel.id})` : '');
        lines.push(
          `- ${this.capitalizeType(panel.type)}: ${panel.title}${idOrPath ? ` ${idOrPath}` : ''}`,
        );
      }
      lines.push('');
    }

    // Linked references section
    if (context.linkedReferences.length > 0) {
      lines.push('### Linked References');
      lines.push('Use the appropriate MCP tools (Linear, Sentry, GitHub) to get more details.');
      lines.push('');
      for (const item of context.linkedReferences) {
        if (item.type === 'linear-issue') {
          lines.push(`- Linear: ${item.identifier} - ${item.title}`);
        } else if (item.type === 'sentry-issue') {
          lines.push(`- Sentry: ${item.identifier} - ${item.title}`);
        } else if (item.type === 'github-issue') {
          lines.push(`- GitHub: ${item.identifier} - ${item.title}`);
        } else if (item.type === 'browser-url') {
          lines.push(`- URL: ${item.title}${item.url ? ` (${item.url})` : ''}`);
        } else {
          lines.push(`- ${item.title}${item.url ? ` (${item.url})` : ''}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Capitalize panel type for display (e.g., 'note' -> 'Note', 'browser' -> 'Browser')
   */
  private capitalizeType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /**
   * Get mandatory actions footer for specific agent types.
   * This appears at the VERY END of the prompt to leverage recency bias.
   *
   * For agents with a specialist role, adds a brief reminder to reinforce
   * the role identity at the end of the context window.
   *
   * For top-level (non-sub-agent) interactive agents, also appends a
   * "Suggested Next Steps" directive so the model reliably emits a
   * `<!-- suggested-prompts ... -->` block at the end of user-facing responses.
   * Sub-agents skip this section since they report to a parent, not the user.
   *
   * @param _agentType - The type of agent (e.g., 'workspace') - reserved for future use
   * @param specialistName - The specialist role name (e.g., 'Coordinator')
   * @param roleReminder - Critical constraints reminder for the specialist
   * @param isSubAgent - True if delegated/background sub-agent (skips suggested-prompts)
   * @param autoCommitEnabled - Whether auto-commit is enabled (affects suggested-prompts guidance)
   */
  private getMandatoryActionsFooter(
    _agentType?: string,
    specialistName?: string,
    roleReminder?: string,
    isSubAgent: boolean = false,
    autoCommitEnabled: boolean = false,
  ): string | null {
    const parts: string[] = [];

    // Specialist role reminder - use the actual roleReminder if provided
    if (specialistName) {
      let reminder = `## Role Reminder\n\nYou are a ${specialistName}.`;
      if (roleReminder) {
        // Use the actual role reminder from the specialist configuration
        reminder += ` ${roleReminder}`;
      } else {
        // Fallback to generic reminder
        reminder += ' Follow the instructions in <specialist_role> above.';
      }
      parts.push(reminder);
    }

    // Suggested Next Steps directive - only for top-level interactive agents.
    // Placed at the very end of the prompt so recency bias ensures the model
    // honors it. Sub-agents don't own a user-facing chat turn, so they skip this.
    if (!isSubAgent) {
      const exampleSecondLine = autoCommitEnabled
        ? 'Check the changes in the diff view.'
        : 'Review changes before committing.';
      const autoCommitClause = autoCommitEnabled
        ? ' Auto-commit is enabled; do not include prompts about committing or reviewing changes before committing.'
        : '';
      const suggestedPrompts = `## Suggested Next Steps\n\nAt the end of your response, offer the user clear next actions as a \`<!-- suggested-prompts ... -->\` HTML comment block:\n\n\`\`\`\n<!-- suggested-prompts\nRun the tests to verify the implementation.\n${exampleSecondLine}\n-->\n\`\`\`\n\nWrite 2–4 prompts, each a short directive sentence phrased as something the user might say next.${autoCommitClause}`;
      parts.push(suggestedPrompts);
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
  }

  /**
   * Cleanup watchers on shutdown
   */
  destroy(): void {
    this.watchers.forEach((watcher, filePath) => {
      try {
        watcher.close();
        logger.debug('File watcher closed', { filePath });
      } catch (error) {
        logger.warn('Failed to close file watcher', { filePath, error });
      }
    });
    this.watchers.clear();
    this.cache.clear();
    this.systemPromptCache.clear();
    logger.info('InstructionService destroyed');
  }
}
