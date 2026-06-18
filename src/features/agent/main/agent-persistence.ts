/**
 * Unified Agent Persistence Service
 *
 * Single, reliable persistence layer for agent data.
 * Features:
 * - Atomic writes using temp files
 * - Automatic backup strategy
 * - Corruption recovery
 * - Write queue management
 * - Proper error handling
 *
 * This is the canonical persistence service. All other persistence
 * implementations should be deprecated in favor of this one.
 */

import { promises as fs } from 'fs';
import { unifiedIdService } from '$shared/services/unified-id.service';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from '$shared/logger';
import type { AgentSession, AgentMessage } from '$shared/types';
import type { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { isValidMessageId } from '$shared/types/branded-ids';
import { validateAgentSession } from '$shared/schemas';
import { AgentStatus } from '$shared/types/agent.types';
import { WorkspaceConfig } from '$shared/main/config';
import { fsyncFile, renameWithRetry } from '$shared/main/file-sync-utils';
import type { IMetadataFS } from '../../metadata-fs/main/metadata-fs';
import { LocalMetadataFS } from '../../metadata-fs/main/local-metadata-fs';
import { truncateLargeFields } from './persistence-truncation';
import { isGenericAgentName, isRandomAgentName } from '$shared/utils/agent-name-utils';
import { deduplicateAgentMessages, normalizeAgentMessage } from '$shared/utils/message-dedup';
import { normalizeStreamingState } from '$shared/utils/agent-streaming-state';

const logger = new Logger('UnifiedPersistence');

interface PersistenceConfig {
  basePath: string;
  backupEnabled: boolean;
  maxBackups: number;
  writeTimeout: number; // ms
  healthCheckInterval?: number; // ms
  corruptionCheckEnabled?: boolean;
  compressionEnabled?: boolean;
  maxRetries?: number;
  retryDelay?: number; // ms
}

interface SaveResult {
  success: boolean;
  path?: string;
  error?: string;
  duration?: number;
  retries?: number;
  checksum?: string;
}

interface LoadResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fromBackup?: boolean;
  recoveredFromCorruption?: boolean;
  checksum?: string;
}

interface HealthCheckResult {
  healthy: boolean;
  issues: HealthIssue[];
  metrics: HealthMetrics;
  timestamp: Date;
}

interface HealthIssue {
  type: 'corruption' | 'permission' | 'disk_space' | 'performance' | 'integrity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details?: any;
}

interface HealthMetrics {
  totalFiles: number;
  corruptedFiles: number;
  totalSize: number;
  averageWriteTime: number;
  averageReadTime: number;
  failedOperations: number;
  successfulOperations: number;
  lastCheckTime?: Date;
}

interface CorruptionRecoveryResult {
  success: boolean;
  filesRecovered: number;
  filesLost: number;
  details: string[];
}

/**
 * Unified persistence service with atomic operations
 */
export class UnifiedPersistence {
  private static instance: UnifiedPersistence;
  private config: PersistenceConfig;
  private writeQueue = new Map<AgentId, Promise<SaveResult>>();
  private writeInProgress = new Map<AgentId, boolean>();
  private healthMetrics: HealthMetrics;
  private healthCheckTimer?: NodeJS.Timeout;
  private operationStats = {
    writes: [] as number[],
    reads: [] as number[],
    failures: 0,
    successes: 0,
  };

  // Track agents that are currently being created (not yet persisted)
  // This prevents redundant loadAgent calls from failing with ENOENT
  // during bulk task delegation when multiple agents are created in parallel
  private pendingAgents = new Map<string, AgentSession>();

  // OPTIMIZATION: Cache for loaded agents to prevent redundant disk reads
  // This dramatically reduces I/O when frontend components make multiple loadSession calls
  private loadCache = new Map<
    string,
    {
      data: LoadResult<AgentSession>;
      timestamp: number;
      loadPromise?: Promise<LoadResult<AgentSession>>;
    }
  >();
  private inactiveLoadCacheWorkspaces = new Set<string>();
  private readonly LOAD_CACHE_TTL_MS = 2000; // 2 second TTL - enough to dedupe rapid calls

  /**
   * Resolver that returns the correct IMetadataFS for a workspace.
   * For local workspaces: LocalMetadataFS (pass-through to fs/promises)
   * For remote workspaces: CachedRemoteMetadataFS (write-through cache)
   * Defaults to LocalMetadataFS for backward compatibility.
   */
  private metadataFSResolver: (workspaceId: string) => IMetadataFS = () => new LocalMetadataFS();

  private constructor() {
    this.config = {
      basePath: 'agents', // Just the agents folder name, not the full path
      backupEnabled: true,
      maxBackups: 5,
      writeTimeout: 30000, // 30 seconds
      healthCheckInterval: 60000, // 1 minute
      corruptionCheckEnabled: true,
      compressionEnabled: false,
      maxRetries: 3,
      retryDelay: 1000, // 1 second
    };

    this.healthMetrics = {
      totalFiles: 0,
      corruptedFiles: 0,
      totalSize: 0,
      averageWriteTime: 0,
      averageReadTime: 0,
      failedOperations: 0,
      successfulOperations: 0,
    };
  }

  private unwrapVersionedAgentData(parsed: any, agentId: AgentId): any {
    if ((parsed.version === 1 || parsed.version === 2) && parsed.data) {
      logger.debug('Detected versioned agent data format', { agentId, version: parsed.version });
      parsed = parsed.data;
    }

    if (parsed.config) {
      if (parsed.config.systemPrompt) {
        parsed.systemPrompt = parsed.config.systemPrompt;
      }
      if (parsed.config.name && !parsed.name) {
        parsed.name = parsed.config.name;
      }
      if (parsed.config.metadata && !parsed.metadata) {
        parsed.metadata = parsed.config.metadata;
      }
      if (parsed.config.agentType) {
        if (!parsed.metadata) {
          parsed.metadata = {};
        }
        parsed.metadata.agentType = parsed.config.agentType;
      }
      if (parsed.config.provider && !parsed.provider) {
        parsed.provider = parsed.config.provider;
      }
    }

    return parsed;
  }

  private normalizeAgentDates(agent: AgentSession): void {
    agent.createdAt = this.normalizeDate(agent.createdAt);
    agent.updatedAt = this.normalizeDate(agent.updatedAt);
    if (agent.lastActivity) {
      agent.lastActivity = this.normalizeDate(agent.lastActivity);
    }
    if (agent.startedAt) {
      agent.startedAt = this.normalizeDate(agent.startedAt);
    }
    if (agent.endedAt) {
      agent.endedAt = this.normalizeDate(agent.endedAt);
    }
  }

  private skipJsonWhitespace(raw: string, index: number): number {
    while (index < raw.length && /\s/.test(raw[index])) {
      index++;
    }
    return index;
  }

  private findJsonStringEnd(raw: string, start: number): number {
    let escaped = false;
    for (let index = start + 1; index < raw.length; index++) {
      const char = raw[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        return index + 1;
      }
    }
    throw new Error('Unterminated JSON string');
  }

  private findJsonValueEnd(raw: string, start: number): number {
    start = this.skipJsonWhitespace(raw, start);
    const opening = raw[start];
    if (opening === '"') {
      return this.findJsonStringEnd(raw, start);
    }

    if (opening === '{' || opening === '[') {
      const closing = opening === '{' ? '}' : ']';
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < raw.length; index++) {
        const char = raw[index];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === '\\') {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }
        if (char === '"') {
          inString = true;
        } else if (char === opening) {
          depth++;
        } else if (char === closing) {
          depth--;
          if (depth === 0) {
            return index + 1;
          }
        }
      }
      throw new Error('Unterminated JSON value');
    }

    let index = start;
    while (index < raw.length && raw[index] !== ',' && raw[index] !== '}' && raw[index] !== ']') {
      index++;
    }
    return index;
  }

  private findTopLevelJsonProperty(
    raw: string,
    propertyName: string,
    objectStart = 0,
    objectEnd = raw.length,
  ): { valueStart: number; valueEnd: number; valueText: string } | null {
    let index = this.skipJsonWhitespace(raw, objectStart);
    if (raw[index] !== '{') {
      return null;
    }
    index++;

    while (index < objectEnd) {
      index = this.skipJsonWhitespace(raw, index);
      if (raw[index] === '}') {
        return null;
      }
      if (raw[index] === ',') {
        index++;
        continue;
      }
      if (raw[index] !== '"') {
        return null;
      }

      const keyEnd = this.findJsonStringEnd(raw, index);
      const key = JSON.parse(raw.slice(index, keyEnd));
      const colonIndex = this.skipJsonWhitespace(raw, keyEnd);
      if (raw[colonIndex] !== ':') {
        return null;
      }

      const valueStart = this.skipJsonWhitespace(raw, colonIndex + 1);
      const valueEnd = this.findJsonValueEnd(raw, valueStart);
      if (key === propertyName) {
        return { valueStart, valueEnd, valueText: raw.slice(valueStart, valueEnd) };
      }
      index = valueEnd;
    }

    return null;
  }

  private countJsonArrayElements(rawArray: string): number {
    let index = this.skipJsonWhitespace(rawArray, 0);
    if (rawArray[index] !== '[') {
      return 0;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let expectingValue = true;
    let count = 0;

    for (; index < rawArray.length; index++) {
      const char = rawArray[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        if (depth === 1 && expectingValue) {
          count++;
          expectingValue = false;
        }
        inString = true;
        continue;
      }
      if (char === '[' || char === '{') {
        if (depth === 1 && expectingValue) {
          count++;
          expectingValue = false;
        }
        depth++;
        continue;
      }
      if (char === ']' || char === '}') {
        depth--;
        if (depth === 0) {
          return count;
        }
        continue;
      }
      if (depth === 1 && char === ',') {
        expectingValue = true;
        continue;
      }
      if (depth === 1 && expectingValue && !/\s/.test(char)) {
        count++;
        expectingValue = false;
      }
    }

    return count;
  }

  private summarizeAgentJson(raw: string, agentId: AgentId): { raw: string; messageCount: number } {
    const versionProperty = this.findTopLevelJsonProperty(raw, 'version');
    const version = versionProperty ? JSON.parse(versionProperty.valueText) : undefined;
    const dataProperty = this.findTopLevelJsonProperty(raw, 'data');
    const agentObjectStart =
      (version === 1 || version === 2) && dataProperty ? dataProperty.valueStart : 0;
    const agentObjectEnd =
      (version === 1 || version === 2) && dataProperty ? dataProperty.valueEnd : raw.length;
    const messagesProperty = this.findTopLevelJsonProperty(
      raw,
      'messages',
      agentObjectStart,
      agentObjectEnd,
    );

    if (!messagesProperty) {
      return { raw, messageCount: 0 };
    }

    const messageCount = this.countJsonArrayElements(messagesProperty.valueText);
    logger.debug('Summarized agent JSON without parsing message array', {
      agentId,
      messageCount,
    });

    return {
      raw: `${raw.slice(0, messagesProperty.valueStart)}[]${raw.slice(messagesProperty.valueEnd)}`,
      messageCount,
    };
  }

  static getInstance(): UnifiedPersistence {
    if (!UnifiedPersistence.instance) {
      UnifiedPersistence.instance = new UnifiedPersistence();
    }
    return UnifiedPersistence.instance;
  }

  /**
   * Configure persistence settings
   */
  configure(config: Partial<PersistenceConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Persistence configured', { config: this.config });

    // Restart health checks if interval changed
    if (config.healthCheckInterval !== undefined) {
      this.stopHealthChecks();
      this.startHealthChecks();
    }
  }

  /**
   * Set the IMetadataFS resolver for remote workspace support.
   * Must be called before any read/write operations for remote workspaces.
   */
  setMetadataFSResolver(resolver: (workspaceId: string) => IMetadataFS): void {
    this.metadataFSResolver = resolver;
    logger.info('MetadataFS resolver configured');
  }

  /**
   * Get the IMetadataFS instance for a workspace.
   * Returns LocalMetadataFS by default (backward compatible).
   */
  private getFS(workspaceId: string): IMetadataFS {
    return this.metadataFSResolver(workspaceId);
  }

  /**
   * Initialize persistence and start health checks.
   *
   * Note: Directories are created on-demand when saving agents,
   * so this method is optional. Call it if you want to enable
   * periodic health checks.
   */
  async initialize(workspacePath: string): Promise<void> {
    logger.debug('initialize() called', {
      workspacePath,
    });

    // Start health checks if enabled
    if (this.config.healthCheckInterval && this.config.healthCheckInterval > 0) {
      this.startHealthChecks();
    }
  }

  /**
   * Mark an agent as pending (being created but not yet persisted).
   * This allows loadAgent to return the pending data instead of failing with ENOENT.
   * Used during bulk task delegation to avoid redundant IPC calls.
   */
  markAgentPending(agentId: string, agent: AgentSession): void {
    logger.debug('Marking agent as pending', { agentId });
    this.pendingAgents.set(agentId, agent);
  }

  /**
   * Clear pending status for an agent (after it's been persisted).
   */
  clearAgentPending(agentId: string): void {
    if (this.pendingAgents.has(agentId)) {
      logger.debug('Clearing pending status for agent', { agentId });
      this.pendingAgents.delete(agentId);
    }
  }

  /**
   * Check if an agent is pending (being created).
   */
  isAgentPending(agentId: string): boolean {
    return this.pendingAgents.has(agentId);
  }

  /**
   * Get pending agent data if available.
   */
  getPendingAgent(agentId: string): AgentSession | undefined {
    return this.pendingAgents.get(agentId);
  }

  /**
   * Perform health check on persistence layer
   */
  async performHealthCheck(workspacePath?: string): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const issues: HealthIssue[] = [];

    try {
      // Check disk access - use a test workspace ID if not provided
      const testWorkspaceId = 'test-health-check';
      const testDir = this.getAgentsDirectory(testWorkspaceId, workspacePath);

      // Ensure directory exists first
      try {
        await fs.mkdir(testDir, { recursive: true });
      } catch {
        // Directory might already exist, that's fine
      }

      const testPath = path.join(testDir, '.health-check');

      try {
        await fs.writeFile(testPath, 'test', 'utf-8');
        await fs.unlink(testPath);
      } catch (error) {
        issues.push({
          type: 'permission',
          severity: 'critical',
          message: 'Cannot write to persistence directory',
          details: error,
        });
      }

      // Check for corrupted files
      if (this.config.corruptionCheckEnabled) {
        const corruptionResult = await this.checkForCorruption(workspacePath);
        if (corruptionResult.corruptedFiles.length > 0) {
          issues.push({
            type: 'corruption',
            severity: corruptionResult.corruptedFiles.length > 5 ? 'high' : 'medium',
            message: `Found ${corruptionResult.corruptedFiles.length} corrupted files`,
            details: corruptionResult.corruptedFiles,
          });
        }
      }

      // Check performance metrics
      const avgWriteTime = this.calculateAverage(this.operationStats.writes);
      const avgReadTime = this.calculateAverage(this.operationStats.reads);

      if (avgWriteTime > 5000) {
        // 5 seconds
        issues.push({
          type: 'performance',
          severity: 'medium',
          message: `Slow write performance: ${avgWriteTime}ms average`,
          details: { avgWriteTime },
        });
      }

      // Update health metrics
      this.healthMetrics.averageWriteTime = avgWriteTime;
      this.healthMetrics.averageReadTime = avgReadTime;
      this.healthMetrics.lastCheckTime = new Date();

      const healthy = issues.filter((i) => i.severity === 'critical').length === 0;

      logger.info('Health check completed', {
        healthy,
        issues: issues.length,
        duration: Date.now() - startTime,
      });

      return {
        healthy,
        issues,
        metrics: { ...this.healthMetrics },
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Health check failed', error as Error);
      issues.push({
        type: 'integrity',
        severity: 'critical',
        message: 'Health check failed',
        details: error,
      });

      return {
        healthy: false,
        issues,
        metrics: { ...this.healthMetrics },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check for corrupted files
   */
  async checkForCorruption(workspacePath?: string): Promise<{
    corruptedFiles: string[];
    details: Map<string, string>;
  }> {
    const corruptedFiles: string[] = [];
    const details = new Map<string, string>();

    try {
      // If no workspace path provided, skip the check
      if (!workspacePath) {
        return { corruptedFiles, details };
      }

      // Extract workspace ID from path if possible, otherwise use a placeholder
      // The workspace path might be a temp directory, so use a default ID for testing
      const workspaceId =
        workspacePath.includes('intent') || workspacePath.includes('.workspaces')
          ? path.basename(path.dirname(workspacePath))
          : 'test-workspace';
      const agentIds = await this.listAgents(workspaceId, workspacePath);

      for (const agentId of agentIds) {
        const agentPath = this.getAgentPath(agentId, workspaceId, workspacePath);

        try {
          const data = await fs.readFile(agentPath, 'utf-8');

          // Check if file is valid JSON
          const parsed = JSON.parse(data);

          // Verify checksum if available
          const checksumPath = `${agentPath}.checksum`;
          try {
            const storedChecksum = await fs.readFile(checksumPath, 'utf-8');
            const currentChecksum = this.calculateChecksum(data);

            if (storedChecksum !== currentChecksum) {
              corruptedFiles.push(agentId);
              details.set(agentId, 'Checksum mismatch');
            }
          } catch {
            // No checksum file, skip verification
          }

          // Validate structure
          validateAgentSession(parsed);
        } catch (error) {
          corruptedFiles.push(agentId);
          details.set(agentId, error instanceof Error ? error.message : 'Unknown corruption');
        }
      }

      this.healthMetrics.corruptedFiles = corruptedFiles.length;
      this.healthMetrics.totalFiles = agentIds.length;

      return { corruptedFiles, details };
    } catch (error) {
      logger.error('Corruption check failed', error as Error);
      return { corruptedFiles: [], details: new Map() };
    }
  }

  /**
   * Recover from corruption
   */
  async recoverFromCorruption(workspacePath?: string): Promise<CorruptionRecoveryResult> {
    const details: string[] = [];
    let filesRecovered = 0;
    let filesLost = 0;

    try {
      const { corruptedFiles } = await this.checkForCorruption(workspacePath);

      // Extract workspace ID from path if possible, otherwise use a placeholder
      // The workspace path might be a temp directory, so use a default ID for testing
      const workspaceId =
        workspacePath && (workspacePath.includes('intent') || workspacePath.includes('.workspaces'))
          ? path.basename(path.dirname(workspacePath))
          : 'test-workspace';

      for (const agentId of corruptedFiles) {
        const agentPath = this.getAgentPath(agentId, workspaceId, workspacePath);

        // Try to recover from backup
        const backupResult = await this.loadFromBackup(agentPath);

        if (backupResult.success && backupResult.data) {
          // Restore from backup
          await this.performAtomicWrite(agentPath, backupResult.data);
          filesRecovered++;
          details.push(`Recovered ${agentId} from backup`);
        } else {
          // Move corrupted file to quarantine
          const quarantinePath = `${agentPath}.corrupted.${Date.now()}`;
          try {
            await fs.rename(agentPath, quarantinePath);
            details.push(`Quarantined corrupted file: ${agentId}`);
          } catch {
            details.push(`Failed to quarantine: ${agentId}`);
          }
          filesLost++;
        }
      }

      logger.info('Corruption recovery completed', {
        filesRecovered,
        filesLost,
        total: corruptedFiles.length,
      });

      return {
        success: filesRecovered > 0 || filesLost === 0,
        filesRecovered,
        filesLost,
        details,
      };
    } catch (error) {
      logger.error('Corruption recovery failed', error as Error);
      return {
        success: false,
        filesRecovered: 0,
        filesLost: 0,
        details: [`Recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  /**
   * Save agent session with atomic write and queue management
   */
  async saveAgent(agent: AgentSession, workspacePath?: string): Promise<SaveResult> {
    const startTime = Date.now();
    const agentId = agent.id as AgentId;
    const agentPath = this.getAgentPath(agentId, agent.workspaceId, workspacePath);

    // Use debug level for routine save operations
    logger.debug('saveAgent called with agent data', {
      agentId,
      hasSystemPrompt: 'systemPrompt' in agent,
      systemPromptLength: (agent as any).systemPrompt?.length || 0,
      agentKeys: Object.keys(agent),
    });

    // IMPORTANT: Preserve critical fields from existing file that the frontend may not have
    // This handles the case where config/name is set before first message, then frontend saves
    // session without knowing about the config or name
    let preservedConfig: Record<string, any> | undefined;
    let preservedName: string | undefined;
    let preservedNameExplicitlySet: boolean | undefined;
    let preservedAcpSessionId: string | undefined;
    let preservedCompletionReport: string | undefined;
    let preservedCompletionReportTimestamp: string | undefined;
    let existingMessagesOnDisk: any[] = [];
    const incomingMetadata =
      (agent as any).metadata &&
      typeof (agent as any).metadata === 'object' &&
      !Array.isArray((agent as any).metadata)
        ? (agent as any).metadata
        : undefined;
    const metadataFS = workspacePath ? new LocalMetadataFS() : this.getFS(agent.workspaceId);
    try {
      const existingData = await metadataFS.readFile(agentPath, 'utf-8');
      const existingRaw = JSON.parse(existingData);
      // Handle both versioned (with data wrapper) and unversioned formats
      const existingAgent =
        existingRaw.version && existingRaw.data ? existingRaw.data : existingRaw;
      existingMessagesOnDisk = existingAgent.messages || [];

      // Preserve config from existing file (includes behaviorPrompt, specialist, etc.)
      // Only preserve if existing config has fields that incoming doesn't have
      if (existingAgent.config && typeof existingAgent.config === 'object') {
        const incomingConfig = (agent as any).config || {};
        const mergedConfig: Record<string, any> = { ...existingAgent.config };
        // Merge: keep existing values for keys not in incoming, but let incoming override
        for (const key of Object.keys(incomingConfig)) {
          if (incomingConfig[key] !== undefined) {
            mergedConfig[key] = incomingConfig[key];
          }
        }
        preservedConfig = mergedConfig;
      }

      // Preserve name from existing file when:
      // 1. The existing name was explicitly set — always preserve regardless of incoming name
      //    (protects user/agent-set names from text-derived names like "Repo overview")
      // 2. The disk has a non-generic/non-random name but the incoming save has a generic/random name
      if (existingAgent.name && typeof existingAgent.name === 'string') {
        const incomingName =
          typeof (agent as any).name === 'string' ? (agent as any).name : undefined;

        const incomingExplicitlySet = !!(agent as any).nameExplicitlySet;

        if (existingAgent.nameExplicitlySet && !incomingExplicitlySet) {
          // Disk name was explicitly set but incoming save doesn't have the flag —
          // this is a stale overwrite from old in-memory data. Preserve the disk name.
          preservedName = existingAgent.name;
          preservedNameExplicitlySet = true;
        } else if (
          !incomingExplicitlySet &&
          (!incomingName ||
            incomingName.trim() === '' ||
            (isGenericAgentName(incomingName) && !isGenericAgentName(existingAgent.name)) ||
            (isRandomAgentName(incomingName) &&
              !isRandomAgentName(existingAgent.name) &&
              !isGenericAgentName(existingAgent.name)))
        ) {
          preservedName = existingAgent.name;
        }
      }

      // Preserve acpSessionId from existing file if incoming save doesn't have it.
      // acpSessionId is written ONLY by the session:created event handler and stores
      // the real auggie session UUID for session/load. Other save paths may not have
      // this field on their copy of the session object, so we must not let them clobber it.
      if (existingAgent.acpSessionId && !agent.acpSessionId) {
        preservedAcpSessionId = existingAgent.acpSessionId;
      }

      // Preserve metadata.completionReport / completionReportTimestamp from existing
      // file if the incoming save doesn't carry them. ReportToParentTool writes these
      // fields directly to disk; other save paths (frontend, streaming) may hold a
      // stale in-memory copy without them and must not clobber the disk value.
      const existingMetadata =
        existingAgent.metadata &&
        typeof existingAgent.metadata === 'object' &&
        !Array.isArray(existingAgent.metadata)
          ? existingAgent.metadata
          : undefined;
      if (existingMetadata?.completionReport && !incomingMetadata?.completionReport) {
        preservedCompletionReport = existingMetadata.completionReport;
        if (existingMetadata.completionReportTimestamp) {
          preservedCompletionReportTimestamp = existingMetadata.completionReportTimestamp;
        }
      }
    } catch {
      // File doesn't exist or can't be read - that's fine, nothing to preserve
    }

    // If the incoming save has assistant messages and disk has user messages that
    // the incoming snapshot is missing, preserve those disk user messages when the
    // incoming users are only an older subset of the on-disk users. This targets
    // stale backend streaming saves that loaded the session before the frontend
    // wrote the latest user message to disk, while avoiding edited/new incoming
    // user messages that should replace the old conversation branch.
    let messagesWithPreservedUserMsgs = agent.messages || [];
    if (existingMessagesOnDisk.length > 0 && messagesWithPreservedUserMsgs.length > 0) {
      const incomingHasAssistantMsg = messagesWithPreservedUserMsgs.some(
        (m: any) => m.role === 'assistant',
      );

      if (incomingHasAssistantMsg) {
        const incomingIds = new Set(messagesWithPreservedUserMsgs.map((m: any) => m.id));
        const existingIds = new Set(existingMessagesOnDisk.map((m: any) => m.id));
        const incomingUserMessages = messagesWithPreservedUserMsgs.filter(
          (m: any) => m.role === 'user',
        );
        const incomingHasUserMsg = incomingUserMessages.length > 0;
        const incomingHasNewAssistantMsg = messagesWithPreservedUserMsgs.some(
          (m: any) => m.role === 'assistant' && !existingIds.has(m.id),
        );
        const incomingHasOnlyDiskUserMessages = incomingUserMessages.every((m: any) =>
          existingIds.has(m.id),
        );
        const missingUserMessages = existingMessagesOnDisk.filter(
          (m: any) => m.role === 'user' && !incomingIds.has(m.id),
        );
        const shouldPreserveMissingUsers = !incomingHasUserMsg || incomingHasNewAssistantMsg;

        if (
          incomingHasOnlyDiskUserMessages &&
          shouldPreserveMissingUsers &&
          missingUserMessages.length > 0
        ) {
          logger.warn(
            'saveAgent - preserving user messages from disk that stale backend save is missing',
            {
              agentId,
              missingCount: missingUserMessages.length,
              incomingCount: messagesWithPreservedUserMsgs.length,
            },
          );

          const existingOrderById = new Map(
            existingMessagesOnDisk.map((message: any, index) => [message.id, index]),
          );
          const timestampedMessages = [
            ...messagesWithPreservedUserMsgs,
            ...missingUserMessages,
          ].map((message: any, index) => {
            const timestamp =
              message.timestamp instanceof Date
                ? message.timestamp.getTime()
                : Date.parse(message.timestamp);
            const order =
              existingOrderById.get(message.id) ?? existingMessagesOnDisk.length + index;
            return { message, order, timestamp };
          });

          if (timestampedMessages.every(({ timestamp }) => Number.isFinite(timestamp))) {
            messagesWithPreservedUserMsgs = timestampedMessages
              .sort((a, b) => a.timestamp - b.timestamp || a.order - b.order)
              .map(({ message }) => message);
          } else {
            // Fall back to the legacy behavior when timestamps do not establish order.
            messagesWithPreservedUserMsgs = [
              ...missingUserMessages,
              ...messagesWithPreservedUserMsgs,
            ];
          }
        }
      }
    }

    // CRITICAL: Deduplicate messages before saving to prevent duplicate logical messages on disk.
    // This is a safety net - duplicates should be prevented upstream, but this ensures
    // the persisted data is always clean regardless of how we got here.
    let deduplicatedMessages = messagesWithPreservedUserMsgs;
    if (messagesWithPreservedUserMsgs.length > 0) {
      const normalizedMessages = messagesWithPreservedUserMsgs.map((msg) =>
        normalizeAgentMessage(msg),
      );
      const uniqueMessages = deduplicateAgentMessages(normalizedMessages);
      const duplicatesRemoved = normalizedMessages.length - uniqueMessages.length;

      if (duplicatesRemoved > 0) {
        logger.warn('saveAgent - removed duplicate messages before saving', {
          agentId,
          originalCount: messagesWithPreservedUserMsgs.length,
          uniqueCount: uniqueMessages.length,
          duplicatesRemoved,
        });
      }

      deduplicatedMessages = uniqueMessages;
    }

    // Truncate large tool call results before persisting to prevent JSON bloat.
    // This only affects the persisted copy — the in-memory agent retains full data.
    const truncatedMessages = truncateLargeFields(deduplicatedMessages);

    // Ensure createdAt and updatedAt are set
    const agentToSave = {
      ...agent,
      messages: truncatedMessages,
      createdAt: agent.createdAt || new Date().toISOString(),
      updatedAt: agent.updatedAt || new Date().toISOString(),
      // Merge preserved config (includes behaviorPrompt, specialist, etc.)
      ...(preservedConfig && {
        config: preservedConfig,
      }),
      // Preserve name from existing file if incoming is generic/stale
      ...(preservedName && {
        name: preservedName,
        ...(preservedNameExplicitlySet && { nameExplicitlySet: true }),
      }),
      // Preserve acpSessionId from existing file if not in incoming agent
      ...(preservedAcpSessionId && {
        acpSessionId: preservedAcpSessionId,
      }),
      // Preserve metadata.completionReport[Timestamp] from disk when the incoming
      // save doesn't include them. Merges into whatever metadata the caller provided.
      ...(preservedCompletionReport && {
        metadata: {
          ...(incomingMetadata ?? {}),
          completionReport: preservedCompletionReport,
          ...(preservedCompletionReportTimestamp && {
            completionReportTimestamp: preservedCompletionReportTimestamp,
          }),
        },
      }),
    };

    // Remove null values that should be undefined
    if (agentToSave.createdAt === null) {
      agentToSave.createdAt = new Date().toISOString();
    }
    if (agentToSave.updatedAt === null) {
      agentToSave.updatedAt = new Date().toISOString();
    }

    // Validate agent data before saving
    try {
      const validatedAgent = validateAgentSession(agentToSave);

      // Use debug level for routine validation
      logger.debug('After validation', {
        agentId,
        hasSystemPromptBefore: 'systemPrompt' in agent,
        hasSystemPromptAfter: 'systemPrompt' in validatedAgent,
        validatedKeys: Object.keys(validatedAgent),
      });

      // Use the validated agent for saving (cast back to AgentSession to preserve branded types)
      agent = validatedAgent as AgentSession;
    } catch (error) {
      logger.error('Invalid agent data', { agentId, error });
      this.operationStats.failures++;
      return {
        success: false,
        error: `Invalid agent data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // Chain onto any operation already queued for this agent so that save
    // and rename serialise on the same per-agent queue. writeInProgress and
    // writeQueue must be set in the same synchronous tick — otherwise a
    // concurrent renameAgent could observe writeInProgress=true but
    // writeQueue=undefined and bypass the wait.
    const previous = this.writeQueue.get(agentId) ?? Promise.resolve();
    this.writeInProgress.set(agentId, true);

    const work: Promise<SaveResult> = previous
      .catch(() => undefined)
      .then(async (): Promise<SaveResult> => {
        let retries = 0;

        // Re-check disk inside the lock for a concurrent rename. We always
        // perform the re-read regardless of the incoming `nameExplicitlySet`
        // flag: a stale full-session save captured just after an earlier
        // rename carries `nameExplicitlySet: true` too, so the flag alone is
        // not proof the save is authoritative. Promote the disk name only
        // when the on-disk copy is explicitly set AND its name disagrees
        // with the incoming save — that combination identifies a rename
        // that landed while this save was queued.
        try {
          const latestRaw = await metadataFS.readFile(agentPath, 'utf-8');
          const latestParsed = JSON.parse(latestRaw);
          const latestAgent =
            latestParsed.version && latestParsed.data ? latestParsed.data : latestParsed;
          if (
            latestAgent &&
            latestAgent.nameExplicitlySet === true &&
            typeof latestAgent.name === 'string' &&
            latestAgent.name !== agent.name
          ) {
            agent.name = latestAgent.name;
            agent.nameExplicitlySet = true;
          }
        } catch {
          // File may not exist yet or may be mid-write; fall through to the
          // main write path which is the authoritative operation.
        }

        // Retry logic
        let lastError: Error | undefined;
        for (let i = 0; i <= (this.config.maxRetries || 3); i++) {
          if (i > 0) {
            retries++;
            await this.delay(this.config.retryDelay || 1000);
            logger.debug(`Retrying save operation (attempt ${i + 1})`, { agentId });
          }

          try {
            // Create write promise with timeout. Do NOT overwrite
            // writeQueue here — the single `work` promise registered below
            // represents the entire save (including retries).
            const writePromise = this.performAtomicWrite(agentPath, agent, metadataFS);

            const result = await Promise.race([
              writePromise,
              new Promise<SaveResult>((_, reject) =>
                setTimeout(() => reject(new Error('Write timeout')), this.config.writeTimeout),
              ),
            ]);

            result.duration = Date.now() - startTime;
            result.retries = retries;

            // Track operation time
            this.operationStats.writes.push(result.duration);
            this.operationStats.successes++;

            // Keep only last 100 operations for stats
            if (this.operationStats.writes.length > 100) {
              this.operationStats.writes.shift();
            }

            logger.debug('Agent saved successfully', {
              agentId,
              duration: result.duration,
              retries,
            });

            // Clear pending status now that agent is persisted
            this.clearAgentPending(agentId);

            // OPTIMIZATION: Invalidate load cache since data has changed
            this.invalidateLoadCache(agentId, agent.workspaceId);

            return result;
          } catch (error) {
            lastError = error as Error;
            logger.warn(`Save attempt ${i + 1} failed`, { agentId, error });
          }
        }

        // All retries failed
        this.operationStats.failures++;
        logger.error('Failed to save agent after retries', {
          agentId,
          retries,
          error: lastError,
        });
        return {
          success: false,
          error: lastError?.message || 'Unknown error',
          retries,
        };
      });

    // Register the work in the queue synchronously so any concurrent save/
    // rename sees an entry to await.
    this.writeQueue.set(agentId, work);

    try {
      return await work;
    } finally {
      // Only clear the lock if our work is still the current entry —
      // avoids clobbering a newer save/rename that chained onto us.
      if (this.writeQueue.get(agentId) === work) {
        this.writeQueue.delete(agentId);
        this.writeInProgress.delete(agentId);
      }
    }
  }

  /**
   * Rename an agent's session file safely.
   *
   * Acquires the same per-agent write lock that `saveAgent` uses, loads fresh
   * state from disk **inside** the lock so it sees any save that just
   * completed, applies the name patch, and writes via `performAtomicWrite` so
   * the temp-file rename, backup, and `.checksum` sidecar are all updated.
   *
   * When `skipIfExplicitlySet` is true (MCP path), the method short-circuits
   * without writing if the session already has `nameExplicitlySet: true` and
   * returns the existing name with `skipped: true`.
   */
  async renameAgent(
    agentId: string,
    workspaceId: string,
    name: string,
    options: { skipIfExplicitlySet?: boolean; workspacePath?: string } = {},
  ): Promise<{ ok: boolean; name: string; skipped?: boolean; error?: string }> {
    const { skipIfExplicitlySet = false, workspacePath } = options;
    const brandedAgentId = agentId as AgentId;
    const brandedWorkspaceId = workspaceId as WorkspaceId;

    if (!name || typeof name !== 'string') {
      throw new Error('name is required');
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('name must not be empty or whitespace-only');
    }

    // Chain onto any operation already queued for this agent so that rename
    // and save serialise on the same per-agent queue. writeInProgress and
    // writeQueue must be set in the same synchronous tick — otherwise a
    // concurrent saveAgent could observe writeInProgress=true but
    // writeQueue=undefined and bypass the wait.
    const previous = this.writeQueue.get(brandedAgentId) ?? Promise.resolve();
    this.writeInProgress.set(brandedAgentId, true);

    const work: Promise<{ ok: boolean; name: string; skipped?: boolean; error?: string }> = previous
      .catch(() => undefined)
      .then(async () => {
        // Invalidate the load cache before reading so we always see the
        // latest bytes on disk rather than a stale cached entry.
        this.invalidateLoadCache(brandedAgentId, brandedWorkspaceId);

        const loadResult = await this.loadAgent(brandedAgentId, brandedWorkspaceId, workspacePath);
        if (!loadResult.success || !loadResult.data) {
          return {
            ok: false,
            name: trimmedName,
            error: loadResult.error || 'Failed to load agent session',
          };
        }

        const session = loadResult.data;
        const existingName = session.name ?? '';
        const existingExplicitlySet = Boolean(
          (session as unknown as { nameExplicitlySet?: boolean }).nameExplicitlySet,
        );

        if (skipIfExplicitlySet && existingExplicitlySet) {
          return { ok: true, name: existingName, skipped: true };
        }

        const patched = {
          ...(session as unknown as Record<string, unknown>),
          name: trimmedName,
          nameExplicitlySet: true,
        };

        const agentPath = this.getAgentPath(agentId, workspaceId, workspacePath);
        const metadataFS = workspacePath ? new LocalMetadataFS() : this.getFS(workspaceId);

        const writeResult = await Promise.race([
          this.performAtomicWrite(agentPath, patched, metadataFS),
          new Promise<SaveResult>((_, reject) =>
            setTimeout(() => reject(new Error('Write timeout')), this.config.writeTimeout),
          ),
        ]);

        if (!writeResult.success) {
          return {
            ok: false,
            name: trimmedName,
            error: writeResult.error,
          };
        }

        // Invalidate the load cache so the next read returns the renamed session.
        this.invalidateLoadCache(brandedAgentId, brandedWorkspaceId);

        return { ok: true, name: trimmedName };
      });

    // Register the work in the queue synchronously so any concurrent save/
    // rename sees an entry to await. The SaveResult cast is safe because
    // callers awaiting the queue only need to know when the operation ends.
    this.writeQueue.set(brandedAgentId, work as unknown as Promise<SaveResult>);

    try {
      return await work;
    } finally {
      // Only clear the flags if our work is still the current entry —
      // avoids clobbering a newer operation that may have chained onto us.
      if (this.writeQueue.get(brandedAgentId) === (work as unknown as Promise<SaveResult>)) {
        this.writeQueue.delete(brandedAgentId);
        this.writeInProgress.delete(brandedAgentId);
      }
    }
  }

  /**
   * Invalidate load cache for a specific agent (call after saves)
   */
  invalidateLoadCache(agentId: AgentId, workspaceId: WorkspaceId): void {
    const cacheKey = `${workspaceId}/${agentId}`;
    this.loadCache.delete(cacheKey);
  }

  /**
   * Invalidate all load caches for a specific workspace.
   * Call this when a workspace is deleted to prevent stale agent data from being returned.
   */
  invalidateLoadCachesForWorkspace(workspaceId: WorkspaceId): void {
    const prefix = `${workspaceId}/`;
    for (const key of this.loadCache.keys()) {
      if (key.startsWith(prefix)) {
        this.loadCache.delete(key);
      }
    }
    this.inactiveLoadCacheWorkspaces.delete(workspaceId);
  }

  /**
   * Invalidate all load caches (useful on workspace switch)
   */
  invalidateAllLoadCaches(): void {
    this.loadCache.clear();
    this.inactiveLoadCacheWorkspaces.clear();
  }

  /**
   * Evict completed agent-session load cache entries for workspaces that are no longer open.
   * In-flight promises are retained so concurrent callers still dedupe, but their resolved
   * full session data is not kept while the workspace remains inactive.
   */
  trimLoadCachesToOpenWorkspaces(openWorkspaceIds: Iterable<string>): void {
    const openWorkspaceIdSet = new Set(openWorkspaceIds);

    for (const workspaceId of openWorkspaceIdSet) {
      this.inactiveLoadCacheWorkspaces.delete(workspaceId);
    }

    for (const [cacheKey, cached] of this.loadCache) {
      const separatorIndex = cacheKey.indexOf('/');
      const workspaceId = separatorIndex >= 0 ? cacheKey.slice(0, separatorIndex) : cacheKey;
      if (openWorkspaceIdSet.has(workspaceId)) continue;

      if (cached.loadPromise) {
        this.inactiveLoadCacheWorkspaces.add(workspaceId);
      } else {
        this.loadCache.delete(cacheKey);
      }
    }
  }

  /**
   * Load lightweight agent metadata for list/status surfaces without retaining message history.
   * Full message hydration remains on-demand through loadAgent().
   */
  async loadAgentSummary(
    agentId: AgentId,
    workspaceId: WorkspaceId,
    workspacePath?: string,
  ): Promise<LoadResult<AgentSession>> {
    const pendingAgent = this.getPendingAgent(agentId);
    if (pendingAgent) {
      return {
        success: true,
        data: {
          ...pendingAgent,
          messages: [],
          metadata: {
            ...pendingAgent.metadata,
            messageCount: pendingAgent.messages?.length ?? 0,
          },
        },
      };
    }

    const agentPath = this.getAgentPath(agentId, workspaceId, workspacePath);
    const metadataFS = workspacePath ? new LocalMetadataFS() : this.getFS(workspaceId);

    try {
      const data = await metadataFS.readFile(agentPath, 'utf-8');
      const summaryJson = this.summarizeAgentJson(data, agentId);
      let parsed = this.unwrapVersionedAgentData(JSON.parse(summaryJson.raw), agentId);
      parsed = {
        ...parsed,
        messages: [],
        metadata: {
          ...parsed.metadata,
          messageCount: summaryJson.messageCount,
        },
      };

      const agent = validateAgentSession(parsed) as AgentSession;
      this.normalizeAgentDates(agent);

      return { success: true, data: agent };
    } catch (error) {
      logger.warn('Failed to load agent summary', { agentId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Agent not found',
      };
    }
  }

  /**
   * Load agent session from disk with validation and recovery
   */
  async loadAgent(
    agentId: AgentId,
    workspaceId: WorkspaceId,
    workspacePath?: string,
  ): Promise<LoadResult<AgentSession>> {
    // Check if agent is pending (being created but not yet persisted)
    // This avoids ENOENT errors during bulk task delegation
    const pendingAgent = this.getPendingAgent(agentId);
    if (pendingAgent) {
      logger.debug('Returning pending agent data (not yet persisted)', { agentId });
      return {
        success: true,
        data: pendingAgent,
      };
    }

    // OPTIMIZATION: Check load cache to prevent redundant disk reads
    const cacheKey = `${workspaceId}/${agentId}`;
    const cached = this.loadCache.get(cacheKey);
    const now = Date.now();

    // If there's a pending load promise, wait for it (dedupes concurrent calls)
    if (cached?.loadPromise) {
      logger.debug('Waiting for in-flight load request', { agentId, workspaceId });
      return cached.loadPromise;
    }

    // If we have cached data and it's still fresh, return it
    if (cached && now - cached.timestamp < this.LOAD_CACHE_TTL_MS) {
      logger.debug('Returning cached agent data', {
        agentId,
        workspaceId,
        cacheAge: now - cached.timestamp,
      });
      return cached.data;
    }

    const agentPath = this.getAgentPath(agentId, workspaceId, workspacePath);

    // Create the load promise to dedupe concurrent requests
    // When workspacePath is provided (testing), use local FS directly
    const loadPromise = this.loadAgentFromDisk(agentId, workspaceId, agentPath, !!workspacePath);

    // Store the promise in cache so concurrent calls can wait for it
    this.loadCache.set(cacheKey, {
      data: cached?.data || { success: false, error: 'Loading...' },
      timestamp: now,
      loadPromise,
    });

    // Execute the load and cache the result
    const result = await loadPromise;

    if (this.inactiveLoadCacheWorkspaces.has(workspaceId)) {
      this.loadCache.delete(cacheKey);
      return result;
    }

    // Update cache with the result
    this.loadCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
      loadPromise: undefined,
    });

    return result;
  }

  /**
   * Internal method that actually loads from disk
   */
  private async loadAgentFromDisk(
    agentId: AgentId,
    workspaceId: WorkspaceId,
    agentPath: string,
    useLocalFS?: boolean,
  ): Promise<LoadResult<AgentSession>> {
    try {
      // Try to load main file
      const metadataFS = useLocalFS ? new LocalMetadataFS() : this.getFS(workspaceId);
      const data = await metadataFS.readFile(agentPath, 'utf-8');
      let parsed = this.unwrapVersionedAgentData(JSON.parse(data), agentId);

      // Log what we loaded from disk - use debug level for routine operations
      logger.debug('Loaded data from disk', {
        agentId,
        hasSystemPrompt: 'systemPrompt' in parsed,
        systemPromptLength: parsed.systemPrompt?.length || 0,
        loadedKeys: Object.keys(parsed),
      });

      // Try to repair corrupted data if validation fails
      let agent: AgentSession;
      try {
        // Validate using schema
        const validated = validateAgentSession(parsed);

        // Log what validation returned - use debug level for routine operations
        logger.debug('After load validation', {
          agentId,
          hasSystemPromptBefore: 'systemPrompt' in parsed,
          hasSystemPromptAfter: 'systemPrompt' in validated,
          validatedKeys: Object.keys(validated),
        });

        agent = validated as AgentSession;
      } catch (validationError) {
        logger.warn('Agent data validation failed, attempting repair', {
          agentId,
          error: validationError,
        });

        // Attempt to repair the corrupted agent data
        const repaired = this.repairCorruptedAgentData(parsed, agentId, workspaceId);

        // Try to validate the repaired data
        try {
          validateAgentSession(repaired);
          agent = repaired as AgentSession;
          logger.info('Successfully repaired corrupted agent data', { agentId });

          // Save the repaired data back to disk (without version wrapper)
          await this.performAtomicWrite(agentPath, agent, metadataFS);
        } catch (repairError) {
          // If repair fails, try backup
          throw repairError;
        }
      }

      // Normalize dates
      this.normalizeAgentDates(agent);

      // Normalize message timestamps and deduplicate logical messages
      if (agent.messages) {
        const normalizedMessages = agent.messages.map((msg) => normalizeAgentMessage(msg));
        const uniqueMessages = deduplicateAgentMessages(normalizedMessages);
        const duplicatesFound = normalizedMessages.length - uniqueMessages.length;

        if (duplicatesFound > 0) {
          logger.warn('loadAgent - found and removed duplicate messages from disk', {
            agentId,
            originalCount: agent.messages.length,
            uniqueCount: uniqueMessages.length,
            duplicatesFound,
          });
          // Save the cleaned data back to disk
          agent.messages = uniqueMessages;
          // Schedule a save to clean up the file (don't await to avoid blocking load)
          this.performAtomicWrite(agentPath, agent, metadataFS).catch((err) => {
            logger.warn('Failed to save cleaned agent data', { agentId, error: err });
          });
        } else {
          agent.messages = uniqueMessages;
        }
      }

      // Use debug level for routine operations
      logger.debug('Loaded agent', { agentId, messageCount: agent.messages?.length || 0 });

      return {
        success: true,
        data: agent,
      };
    } catch (error) {
      logger.warn('Failed to load main agent file', { agentId, error });

      // Try to load from backup
      if (this.config.backupEnabled) {
        const backupResult = await this.loadFromBackup(agentPath);
        if (backupResult.success) {
          logger.info('Recovered agent from backup', { agentId });
          return { ...backupResult, fromBackup: true };
        }
      }

      // Return failure instead of creating a new agent
      // This prevents the issue where checking for duplicates creates the file
      logger.debug('Agent file does not exist', { agentId });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Agent not found',
      };
    }
  }

  /**
   * Save a single message (append to existing session)
   */
  async saveMessage(
    agentId: string,
    workspaceId: string,
    message: AgentMessage,
    workspacePath?: string,
  ): Promise<SaveResult> {
    // Load existing session
    const loadResult = await this.loadAgent(
      agentId as AgentId,
      workspaceId as WorkspaceId,
      workspacePath,
    );
    if (!loadResult.success || !loadResult.data) {
      logger.warn('saveMessage - Failed to load agent', {
        agentId,
        workspaceId,
        loadSuccess: loadResult.success,
        hasData: !!loadResult.data,
        error: loadResult.error,
      });
      return {
        success: false,
        error: 'Failed to load existing session',
      };
    }

    const agent = loadResult.data;

    // Use debug level for routine operations
    logger.debug('saveMessage - agent from loadResult', {
      agentId,
      hasSystemPrompt: 'systemPrompt' in agent,
      agentKeys: Object.keys(agent),
      messagesCount: agent.messages?.length || 0,
    });

    // Append message only if not already present (prevent duplicates)
    if (!agent.messages) {
      agent.messages = [];
    }

    // O(1) duplicate check using message ID
    const existingIds = new Set(agent.messages.map((m) => m.id));
    if (existingIds.has(message.id)) {
      logger.debug('saveMessage - skipping duplicate message', {
        agentId,
        messageId: message.id,
        existingCount: agent.messages.length,
      });
      // Return success - the message is already saved
      return { success: true };
    }

    agent.messages.push(message);
    agent.updatedAt = new Date();

    logger.debug('saveMessage - after adding message', {
      agentId,
      messagesCount: agent.messages.length,
      messageId: message.id,
    });

    // Save updated session
    return this.saveAgent(agent, workspacePath);
  }

  /**
   * Delete agent data
   */
  async deleteAgent(
    agentId: string,
    workspaceId: string,
    workspacePath?: string,
  ): Promise<SaveResult> {
    const agentPath = this.getAgentPath(agentId, workspaceId, workspacePath);
    const metadataFS = workspacePath ? new LocalMetadataFS() : this.getFS(workspaceId);

    try {
      // Create backup before deletion (always local)
      if (this.config.backupEnabled) {
        await this.createBackup(agentPath);
      }

      // Delete main file via IMetadataFS (supports remote workspaces)
      await metadataFS.unlink(agentPath);

      // Delete backups (always local - backups are a local-only concern)
      const backupDir = `${agentPath}.backups`;
      try {
        await fs.rm(backupDir, { recursive: true });
      } catch {
        // Ignore if backup dir doesn't exist
      }

      logger.debug('Deleted agent', { agentId });

      this.clearAgentPending(agentId);
      this.invalidateLoadCache(agentId as AgentId, workspaceId as WorkspaceId);

      return { success: true };
    } catch (error) {
      logger.error('Failed to delete agent', { agentId, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List all agents in a workspace
   */
  async listAgents(workspaceId: string, workspacePath?: string): Promise<string[]> {
    const agentsPath = this.getAgentsDirectory(workspaceId, workspacePath);
    const metadataFS = workspacePath ? new LocalMetadataFS() : this.getFS(workspaceId);

    try {
      const entries = await metadataFS.readdir(agentsPath, { withFileTypes: true });
      const agentIds = entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('.tmp'),
        )
        .map((entry) => entry.name.replace('.json', ''))
        .filter((id) => unifiedIdService.isValidAgentId(id));

      logger.debug('Listed agents', { workspaceId, count: agentIds.length });
      return agentIds;
    } catch (error) {
      logger.error('Failed to list agents', { workspaceId, error });
      return [];
    }
  }

  /**
   * Perform atomic write operation with robust backup strategy.
   * When metadataFS is provided, the final write goes through IMetadataFS
   * (supporting remote workspaces). Temp files and backups always use local fs.
   */
  private async performAtomicWrite(
    filePath: string,
    data: any,
    metadataFS?: IMetadataFS,
  ): Promise<SaveResult> {
    // Single disk-write funnel: strip transient streaming/processing flags so a
    // crash mid-stream can never persist (or later re-hydrate) a phantom
    // "responding" state. Clone first — callers may pass frozen Redux/loaded
    // objects that must not be mutated. Genuinely-streaming sessions (a message
    // with isStreaming) are preserved untouched.
    data = normalizeStreamingState({ ...data });

    // Use a unique temp file name to avoid race conditions
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const tempPath = `${filePath}.tmp.${uniqueSuffix}`;
    const checksumPath = `${filePath}.checksum`;

    try {
      // Ensure directory exists (use metadataFS if available for remote support)
      const dir = path.dirname(filePath);
      try {
        if (metadataFS) {
          await metadataFS.mkdir(dir, { recursive: true });
        } else {
          await fs.mkdir(dir, { recursive: true });
        }
        // Verify directory was created (always check locally since reads go to local cache)
        await fs.access(dir);
      } catch (dirError) {
        logger.error('Failed to create directory', { dir, error: dirError });
        throw new Error(`Failed to create directory: ${dir}`);
      }

      // Write to temp file
      const jsonData = JSON.stringify(data);

      // Use debug level for routine atomic write operations
      logger.debug('performAtomicWrite - data to be written', {
        hasSystemPrompt: 'systemPrompt' in data,
        systemPromptLength: data.systemPrompt?.length || 0,
        dataKeys: Object.keys(data),
      });

      logger.debug('Writing to temp file', {
        tempPath,
        dataLength: jsonData.length,
      });

      try {
        await fs.writeFile(tempPath, jsonData, 'utf-8');

        // Sync file to disk for durability
        await fsyncFile(tempPath);

        logger.debug('Successfully wrote to temp file', { tempPath });
      } catch (writeError) {
        logger.error('Failed to write to temp file', {
          tempPath,
          error: writeError,
          errorMessage: writeError instanceof Error ? writeError.message : 'Unknown error',
          errorCode: (writeError as any)?.code,
        });
        throw new Error(`Failed to write to temp file: ${tempPath}`);
      }

      // Small delay to ensure file system has flushed the write
      await this.delay(10);

      // Verify temp file exists and is readable
      try {
        await fs.access(tempPath);
        const stats = await fs.stat(tempPath);
        logger.debug('Temp file verified', {
          tempPath,
          size: stats.size,
        });
      } catch (error) {
        logger.error('Temp file not accessible after write', {
          tempPath,
          error,
          dirExists: await fs
            .access(dir)
            .then(() => true)
            .catch(() => false),
        });
        throw new Error(`Temp file not accessible after write: ${tempPath}`);
      }

      // Verify temp file content - just ensure it's valid JSON
      const verification = await fs.readFile(tempPath, 'utf-8');

      try {
        // Simply verify the file contains valid JSON
        JSON.parse(verification);

        // Basic sanity check - file shouldn't be empty or too small
        if (verification.length < 2) {
          throw new Error('File content too small to be valid JSON');
        }

        logger.debug('Write verification passed', {
          tempPath,
          contentLength: verification.length,
        });
      } catch (parseError) {
        logger.error('Write verification failed - invalid JSON in temp file', {
          error: parseError,
          tempPath,
          contentLength: verification.length,
        });
        throw new Error('Write verification failed - invalid JSON in temp file');
      }

      // Calculate and store checksum
      const checksum = this.calculateChecksum(jsonData);

      // Create backup of existing file before overwriting
      if (this.config.backupEnabled) {
        try {
          await fs.access(filePath);
          // File exists, create timestamped backup
          await this.createBackup(filePath);
        } catch {
          // File doesn't exist yet, no backup needed
        }
      }

      // Write verified content to final destination
      if (metadataFS) {
        // When metadataFS is provided, write through IMetadataFS (supports remote workspaces).
        // The verified content from the temp file is written directly via metadataFS.writeFile,
        // which for CachedRemoteMetadataFS writes remote-first then updates local cache.
        try {
          await metadataFS.writeFile(filePath, verification, 'utf-8');
          logger.debug('Successfully wrote final file via metadataFS', { filePath });
        } catch (writeError) {
          logger.error('Failed to write final file via metadataFS', {
            filePath,
            error: writeError,
          });
          throw writeError;
        }
        // Clean up temp file (always local)
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      } else {
        // Move temp to final (atomic operation) - original local-only path
        try {
          // Double-check temp file exists before rename
          try {
            const tempStats = await fs.stat(tempPath);
            logger.debug('About to rename temp file', {
              tempPath,
              filePath,
              tempSize: tempStats.size,
            });
          } catch (statError) {
            logger.error('Temp file disappeared before rename', {
              tempPath,
              error: statError,
            });
            throw new Error(`Temp file disappeared before rename: ${tempPath}`);
          }

          // Attempt the rename - if the final file already exists, this will fail naturally
          // which is fine - it means another process already wrote the file
          try {
            await renameWithRetry(tempPath, filePath);
          } catch (renameError) {
            const errnoError = renameError as NodeJS.ErrnoException;
            // Check if the error is because the destination already exists
            if (errnoError.code === 'EEXIST' || errnoError.code === 'ENOTEMPTY') {
              logger.debug('Final file already exists, another process completed the write', {
                filePath,
                tempPath,
              });

              // Clean up our temp file
              try {
                await fs.unlink(tempPath);
                logger.debug('Cleaned up temp file after concurrent write', { tempPath });
              } catch {
                // Ignore cleanup errors
              }

              // Return success since the file is in place (written by another process)
              return { success: true, path: filePath };
            }

            // For other errors, re-throw
            throw renameError;
          }

          logger.debug('Successfully renamed temp file to final', {
            tempPath,
            filePath,
          });
        } catch (renameError) {
          const errnoError = renameError as NodeJS.ErrnoException;
          // Check if the error is because the temp file doesn't exist (ENOENT)
          if (errnoError.code === 'ENOENT' && errnoError.syscall === 'rename') {
            // The temp file doesn't exist - likely because another process already renamed it
            // Check if the final file exists now
            try {
              await fs.access(filePath);
              const finalStats = await fs.stat(filePath);

              logger.debug('Rename failed but final file exists (race condition resolved)', {
                filePath,
                finalSize: finalStats.size,
              });

              // Return success since the file is in place
              return { success: true, path: filePath };
            } catch {
              // Final file doesn't exist either - this is a real error
              logger.error('Rename failed and final file does not exist', {
                tempPath,
                filePath,
                error: (renameError as Error).message,
              });
              throw renameError;
            }
          }

          // For other errors, check if temp file still exists
          const tempExists = await fs
            .access(tempPath)
            .then(() => true)
            .catch(() => false);

          // If rename fails and temp file exists, try to clean it up
          if (tempExists) {
            try {
              await fs.unlink(tempPath);
            } catch {
              // Ignore cleanup error
            }
          }

          logger.error('Failed to rename temp file to final', {
            tempPath,
            filePath,
            tempExists,
            error: renameError,
          });
          throw renameError;
        }
      }

      // Write checksum file
      try {
        await fs.writeFile(checksumPath, checksum, 'utf-8');

        // Sync file to disk for durability
        await fsyncFile(checksumPath);
      } catch (error) {
        logger.warn('Failed to write checksum file', { path: checksumPath, error });
      }

      logger.debug('Atomic write completed', { path: filePath, checksum });

      return {
        success: true,
        path: filePath,
        checksum,
      };
    } catch (error) {
      // Try to restore from backup directory
      if (this.config.backupEnabled) {
        try {
          const backupResult = await this.loadFromBackup(filePath);
          if (backupResult.success && backupResult.data) {
            // Restore the most recent backup
            const backupData = JSON.stringify(backupResult.data, null, 2);
            await fs.writeFile(filePath, backupData, 'utf-8');

            // Sync file to disk for durability
            await fsyncFile(filePath);

            logger.info('Restored from backup after write failure', { path: filePath });
          }
        } catch (restoreError) {
          logger.warn('Failed to restore from backup', { path: filePath, error: restoreError });
        }
      }

      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      logger.error('Atomic write failed', { path: filePath, error });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create backup of agent data
   */
  private async createBackup(filePath: string): Promise<void> {
    const backupDir = `${filePath}.backups`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}.json`);

    try {
      await fs.mkdir(backupDir, { recursive: true });
      await fs.copyFile(filePath, backupPath);

      // Clean up old backups
      await this.cleanupOldBackups(backupDir);
    } catch (error) {
      logger.warn('Failed to create backup', { error });
    }
  }

  /**
   * Repair corrupted agent data by filling in missing required fields
   */
  private repairCorruptedAgentData(data: any, agentId: AgentId, workspaceId: WorkspaceId): any {
    const repaired = { ...data };

    // Ensure required fields exist
    if (!repaired.id) {
      repaired.id = agentId;
    }

    if (!repaired.workspaceId) {
      repaired.workspaceId = workspaceId;
    }

    if (!repaired.messages || !Array.isArray(repaired.messages)) {
      repaired.messages = [];
    }

    if (!repaired.status) {
      repaired.status = AgentStatus.Idle;
    }

    // Ensure dates exist
    const now = new Date().toISOString();
    if (!repaired.createdAt) {
      repaired.createdAt = now;
    }

    if (!repaired.updatedAt) {
      repaired.updatedAt = now;
    }

    // Set default values for optional fields
    if (repaired.name === undefined) {
      repaired.name = 'Agent';
    }

    if (repaired.isInitialAgent === undefined) {
      repaired.isInitialAgent = false;
    }

    if (repaired.isBackground === undefined) {
      repaired.isBackground = false;
    }

    // Clean up messages array
    if (repaired.messages && Array.isArray(repaired.messages)) {
      repaired.messages = repaired.messages.map((msg: any, index: number) => {
        const cleanMsg = { ...msg };

        // Ensure message has required fields
        // FIX: Also validate existing IDs - if they don't match the schema, regenerate them
        // The schema requires either 'msg_' prefix OR a valid UUID
        if (!cleanMsg.id || !isValidMessageId(cleanMsg.id)) {
          const newId = `msg_${Date.now()}_${index}`;
          if (cleanMsg.id) {
            logger.warn('Repairing invalid message ID', {
              oldId: cleanMsg.id,
              newId,
              index,
            });
          }
          cleanMsg.id = newId;
        }

        if (!cleanMsg.role) {
          cleanMsg.role = 'user'; // Default to user role
        }

        if (!cleanMsg.content) {
          cleanMsg.content = '';
        }

        if (!cleanMsg.timestamp) {
          cleanMsg.timestamp = now;
        }

        return cleanMsg;
      });
    }

    return repaired;
  }

  /**
   * Load from backup
   */
  private async loadFromBackup(filePath: string): Promise<LoadResult<AgentSession>> {
    const backupDir = `${filePath}.backups`;

    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter((f) => f.startsWith('backup-'))
        .sort()
        .reverse(); // Most recent first

      for (const backup of backups) {
        try {
          const backupPath = path.join(backupDir, backup);
          const data = await fs.readFile(backupPath, 'utf-8');
          const parsed = JSON.parse(data);
          validateAgentSession(parsed);
          const agent = parsed as AgentSession;

          logger.info('Loaded from backup', { backup });
          return { success: true, data: agent };
        } catch {
          // Try next backup
        }
      }
    } catch {
      // No backups available
    }

    return { success: false, error: 'No valid backups found' };
  }

  /**
   * Clean up old backups
   */
  private async cleanupOldBackups(backupDir: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter((f) => f.startsWith('backup-'))
        .sort()
        .reverse();

      if (backups.length > this.config.maxBackups) {
        const toDelete = backups.slice(this.config.maxBackups);
        for (const file of toDelete) {
          await fs.unlink(path.join(backupDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Normalize date values (string or Date to Date)
   */
  private normalizeDate(value: any): Date {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }
    return new Date();
  }

  /**
   * Get agent file path
   */
  private getAgentPath(agentId: string, workspaceId: string, workspacePath?: string): string {
    const dir = this.getAgentsDirectory(workspaceId, workspacePath);
    return path.join(dir, `${agentId}.json`);
  }

  /**
   * Get agents directory path
   *
   * IMPORTANT: Agents are ALWAYS stored in the workspace metadata directory,
   * NOT in the worktree path. The workspacePath parameter is used for testing
   * to override the default location.
   */
  private getAgentsDirectory(workspaceId: string, workspacePath?: string): string {
    // If workspacePath is provided (for testing), use it directly
    if (workspacePath) {
      return path.join(workspacePath, '.workspace/agents');
    }
    // Otherwise use WorkspaceConfig to get the correct path, which respects environment variables
    return WorkspaceConfig.paths.agents(workspaceId);
  }

  /**
   * Calculate checksum for data integrity
   */
  private calculateChecksum(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Calculate average from array of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    if (!this.config.healthCheckInterval || this.config.healthCheckInterval <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Periodic health check failed', error as Error);
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if a file or directory exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get total number of sessions
   */
  async getTotalSessions(): Promise<number> {
    try {
      let total = 0;
      const workspacesPath = path.join(this.config.basePath, 'workspaces');

      if (await this.fileExists(workspacesPath)) {
        const workspaces = await fs.readdir(workspacesPath);
        for (const workspace of workspaces) {
          const agentsPath = path.join(workspacesPath, workspace, 'agents');
          if (await this.fileExists(agentsPath)) {
            const agents = await fs.readdir(agentsPath);
            total += agents.filter((f) => f.endsWith('.json')).length;
          }
        }
      }

      return total;
    } catch (error) {
      logger.error('Failed to get total sessions', error as Error);
      return 0;
    }
  }

  /**
   * Get total number of messages across all sessions
   */
  async getTotalMessages(): Promise<number> {
    try {
      let total = 0;
      const workspacesPath = path.join(this.config.basePath, 'workspaces');

      if (await this.fileExists(workspacesPath)) {
        const workspaces = await fs.readdir(workspacesPath);
        for (const workspace of workspaces) {
          const agentsPath = path.join(workspacesPath, workspace, 'agents');
          if (await this.fileExists(agentsPath)) {
            const agents = await fs.readdir(agentsPath);
            for (const agentFile of agents.filter((f) => f.endsWith('.json'))) {
              try {
                const agentPath = path.join(agentsPath, agentFile);
                const content = await fs.readFile(agentPath, 'utf-8');
                const agent = JSON.parse(content);
                if (agent.messages && Array.isArray(agent.messages)) {
                  total += agent.messages.length;
                }
              } catch {
                // Skip corrupted files
              }
            }
          }
        }
      }

      return total;
    } catch (error) {
      logger.error('Failed to get total messages', error as Error);
      return 0;
    }
  }

  /**
   * Get storage size in bytes
   */
  async getStorageSize(): Promise<number> {
    try {
      const getDirectorySize = async (dirPath: string): Promise<number> => {
        let size = 0;

        if (!(await this.fileExists(dirPath))) {
          return 0;
        }

        const files = await fs.readdir(dirPath, { withFileTypes: true });

        for (const file of files) {
          const filePath = path.join(dirPath, file.name);
          if (file.isDirectory()) {
            size += await getDirectorySize(filePath);
          } else {
            const stats = await fs.stat(filePath);
            size += stats.size;
          }
        }

        return size;
      };

      const workspacesPath = path.join(this.config.basePath, 'workspaces');
      return await getDirectorySize(workspacesPath);
    } catch (error) {
      logger.error('Failed to get storage size', error as Error);
      return 0;
    }
  }

  /**
   * Get last cleanup time
   */
  async getLastCleanupTime(): Promise<Date | null> {
    try {
      const metaPath = path.join(this.config.basePath, '.meta', 'last-cleanup');
      if (await this.fileExists(metaPath)) {
        const content = await fs.readFile(metaPath, 'utf-8');
        return new Date(content.trim());
      }
      return null;
    } catch (error) {
      logger.error('Failed to get last cleanup time', error as Error);
      return null;
    }
  }

  /**
   * Clear all data for a workspace
   */
  async clearWorkspace(workspaceId: string): Promise<void> {
    try {
      const workspacePath = path.join(this.config.basePath, 'workspaces', workspaceId);
      if (await this.fileExists(workspacePath)) {
        await fs.rm(workspacePath, { recursive: true, force: true });
        logger.info('Cleared workspace', { workspaceId });
      }
      this.invalidateLoadCachesForWorkspace(workspaceId as WorkspaceId);
      for (const [agentId, agent] of this.pendingAgents) {
        if (agent.workspaceId === workspaceId) {
          this.pendingAgents.delete(agentId);
        }
      }
    } catch (error) {
      logger.error('Failed to clear workspace', { workspaceId, error });
      throw error;
    }
  }

  /**
   * Clear all persistence data
   */
  async clearAll(): Promise<void> {
    try {
      const workspacesPath = path.join(this.config.basePath, 'workspaces');
      if (await this.fileExists(workspacesPath)) {
        await fs.rm(workspacesPath, { recursive: true, force: true });
        logger.info('Cleared all persistence data');
      }

      // Update last cleanup time
      const metaPath = path.join(this.config.basePath, '.meta');
      await fs.mkdir(metaPath, { recursive: true });
      const cleanupPath = path.join(metaPath, 'last-cleanup');
      await fs.writeFile(cleanupPath, new Date().toISOString(), 'utf-8');

      // Sync file to disk for durability
      await fsyncFile(cleanupPath);

      this.invalidateAllLoadCaches();
      this.pendingAgents.clear();
    } catch (error) {
      logger.error('Failed to clear all data', error as Error);
      throw error;
    }
  }

  /**
   * Get messages for an agent
   */
  async getMessages(agentId: string): Promise<AgentMessage[]> {
    try {
      // Try to find the agent in any workspace
      const workspacesPath = path.join(this.config.basePath, 'workspaces');

      if (await this.fileExists(workspacesPath)) {
        const workspaces = await fs.readdir(workspacesPath);
        for (const workspace of workspaces) {
          const agentPath = path.join(workspacesPath, workspace, 'agents', `${agentId}.json`);
          if (await this.fileExists(agentPath)) {
            const content = await fs.readFile(agentPath, 'utf-8');
            const agent = JSON.parse(content);
            return agent.messages || [];
          }
        }
      }

      return [];
    } catch (error) {
      logger.error('Failed to get messages', { agentId, error });
      return [];
    }
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    this.stopHealthChecks();

    // Wait for pending operations
    const pendingWrites = Array.from(this.writeQueue.values());
    if (pendingWrites.length > 0) {
      logger.info('Waiting for pending writes to complete', { count: pendingWrites.length });
      await Promise.allSettled(pendingWrites);
    }

    this.writeQueue.clear();
    this.writeInProgress.clear();
    this.pendingAgents.clear();
    this.invalidateAllLoadCaches();
    logger.info('Persistence service shutdown complete');
  }
}

// Export singleton instance
export const unifiedPersistence = UnifiedPersistence.getInstance();

// Legacy export for backward compatibility
export const agentPersistence = unifiedPersistence;
