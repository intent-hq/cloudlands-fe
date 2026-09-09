/**
 * Specialists Service (BACKEND ONLY)
 *
 * Provides access to specialist configurations, formatted for the daemon and
 * the renderer IPC surface.
 * Reads specialists from (in priority order):
 * 1. User file-based specialists (~/.intent/specialists/*.md) - highest priority
 * 2. Bundled specialists (resources/specialists/*.md)
 * 3. Custom specialists from electron-store (deprecated, migrated to files)
 * 4. Hardcoded SPECIALISTS array (last-resort fallback if file loading fails)
 *
 * IMPORTANT: initSpecialistsService() MUST be awaited during app startup before
 * any workspace creation occurs. This ensures the file cache is ready when
 * getEffectiveSpecialist() is called. GitHub auth is refreshed separately after
 * the first window is created because it requires the daemon but is not critical
 * to specialist resolution.
 */

import { Logger } from '$shared/logger';
import {
  SPECIALISTS,
  getSpecialistById,
  GITHUB_DEPENDENT_SPECIALIST_IDS,
} from '$lib/constants/specialists';
import {
  loadSpecialistFiles,
  loadProjectSpecialistFiles,
  loadBundledSpecialistFiles,
} from '../../specialists/main/specialist-file-loader';
import {
  mergeSpecialistsByPriority,
  type SpecialistFile,
  type SpecialistRole,
} from '../../../shared/specialist-file-types';
import { isGitHubConfigured } from '../../../main/utils/github-auth-status';
import { createCache } from '../../../main/utils/cache';

const logger = new Logger('SpecialistsService');

// Cached GitHub auth status for synchronous filtering
let isGitHubAuthenticated = false;

export interface EffectiveSpecialist {
  id: string;
  name: string;
  description: string;
  /** ACP provider / runtime backend for this specialist after fallback resolution. */
  codingAgent: string;
  /**
   * Explicit frontmatter model, verbatim ('' when the file declares none).
   * Tier→model resolution is daemon-owned; the main process never synthesizes
   * a model from a tier.
   */
  model: string;
  behaviorPrompt: string;
  isCustomized: boolean;
  /**
   * Short reminder of critical constraints for this specialist.
   * May be explicit (from config) or auto-generated from behaviorPrompt.
   */
  roleReminder?: string;
  /** Orchestration role (PROTOCOL §5.11 `role`); undefined = standard. */
  role?: SpecialistRole;
  /** Specialist ids the orchestrator delegates to (advisory/render-only). */
  teamAgents?: string[];
  /** Built-in avatar design id; unknown/absent degrades to the fallback. */
  icon?: string;
}

let initPromise: Promise<void> | null = null;

// Cache for file-based specialists (refreshed on demand)
// Each workspace can have its own effective set because project specialists are repo-local.
const DEFAULT_FILE_CACHE_KEY = '__default__';
const FILE_CACHE_TTL_MS = 5000; // 5 second cache for file-based specialists
const fileSpecialistsCache = createCache<string, SpecialistFile[]>({
  name: 'file-specialists',
  ttlMs: FILE_CACHE_TTL_MS,
  maxSize: 50,
});

// TTL-free "last known good" specialists per cache key. Updated only on a
// successful merge in refreshFileSpecialistsCache(). The TTL cache above remains
// the freshness/refresh trigger; this cache lets getCachedFileSpecialists() serve
// the most recent successfully-loaded list when a transient refresh fails instead
// of resolving to an empty list.
const lastKnownGoodFileSpecialists = createCache<string, SpecialistFile[]>({
  name: 'file-specialists-last-known-good',
  maxSize: 50,
});

// In-flight promise to prevent concurrent cache refreshes (race condition fix)
const refreshInFlight = new Map<string, Promise<void>>();

function getFileCacheKey(workspacePath?: string): string {
  return workspacePath || DEFAULT_FILE_CACHE_KEY;
}

function getCachedFileSpecialists(workspacePath?: string): SpecialistFile[] {
  const cacheKey = getFileCacheKey(workspacePath);
  return (
    fileSpecialistsCache.get(cacheKey) ??
    lastKnownGoodFileSpecialists.get(cacheKey) ??
    fileSpecialistsCache.get(DEFAULT_FILE_CACHE_KEY) ??
    lastKnownGoodFileSpecialists.get(DEFAULT_FILE_CACHE_KEY) ??
    []
  );
}

let specialistsServiceInitialized = false;

/**
 * Initialize the specialists service (call once during app startup).
 * This MUST be awaited before getEffectiveSpecialist is called.
 */
export async function initSpecialistsService(): Promise<void> {
  if (specialistsServiceInitialized) {
    return; // Already initialized
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      // The one-time electron-store 'settings' → file-based specialist
      // migrations (custom-specialists / specialists-overrides) are retired
      // with the legacy `settings` store (PROTOCOL.md §5.12). Fresh-start
      // posture: any user data still in the legacy store is not carried
      // forward; users author specialists directly in ~/.intent/specialists.
      logger.info('Specialists service initialized (file-based)');

      // Pre-load file-based specialists (includes bundled + user files)
      await refreshFileSpecialistsCache();

      specialistsServiceInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize specialists service', error as Error);
    }
  })();
  return initPromise;
}

/**
 * Refresh the cached GitHub authentication status.
 * Called after first-window startup and when auth state changes. The probe hits
 * the daemon's `github.authStatus` directly and folds errors to false. Until the
 * first refresh completes, the conservative false default hides GitHub-only
 * specialists from synchronous consumers.
 */
export async function refreshGitHubAuthStatus(): Promise<void> {
  isGitHubAuthenticated = await isGitHubConfigured();
  logger.info('GitHub auth status refreshed', { isGitHubAuthenticated });
}

/**
 * Refresh the cache of file-based specialists
 * Loads both bundled specialists and user file-based specialists.
 * User file-based specialists override bundled specialists with the same ID.
 */
async function refreshFileSpecialistsCache(workspacePath?: string): Promise<void> {
  try {
    const [bundledResult, userResult, projectResult] = await Promise.all([
      loadBundledSpecialistFiles(),
      loadSpecialistFiles(),
      loadProjectSpecialistFiles(workspacePath),
    ]);

    const mergedSpecialists = mergeSpecialistsByPriority(
      bundledResult.specialists,
      userResult.specialists,
      projectResult.specialists,
    );

    const cacheKey = getFileCacheKey(workspacePath);
    fileSpecialistsCache.set(cacheKey, mergedSpecialists);
    // Retain the successful result so a later transient failure can still serve it.
    lastKnownGoodFileSpecialists.set(cacheKey, mergedSpecialists);

    const allErrors = [...bundledResult.errors, ...userResult.errors, ...projectResult.errors];
    if (allErrors.length > 0) {
      logger.warn(`Errors loading specialist files: ${allErrors.map((e) => e.error).join(', ')}`);
    }

    logger.info(
      `Loaded specialists: ${bundledResult.specialists.length} bundled, ${userResult.specialists.length} user files, ${projectResult.specialists.length} project files, ${mergedSpecialists.length} total`,
      { workspacePath },
    );
  } catch (error) {
    logger.error('Failed to refresh file specialists cache', error as Error);
  }
}

/**
 * Get file-based specialists (with caching)
 * Uses in-flight promise tracking to prevent concurrent cache refreshes.
 */
async function getFileSpecialists(workspacePath?: string): Promise<SpecialistFile[]> {
  const cacheKey = getFileCacheKey(workspacePath);
  if (!fileSpecialistsCache.has(cacheKey)) {
    if (!refreshInFlight.has(cacheKey)) {
      refreshInFlight.set(
        cacheKey,
        refreshFileSpecialistsCache(workspacePath).finally(() => {
          refreshInFlight.delete(cacheKey);
        }),
      );
    }
    await refreshInFlight.get(cacheKey);
  }
  return getCachedFileSpecialists(workspacePath);
}

/**
 * Find a file-based specialist by ID (synchronous, uses cache)
 */
function findFileSpecialistSync(
  specialistId: string,
  workspacePath?: string,
): SpecialistFile | undefined {
  return getCachedFileSpecialists(workspacePath).find((s) => s.id === specialistId);
}

/**
 * Force refresh the file specialists cache.
 * Useful when files have been modified externally.
 */
export async function refreshSpecialistsFromFiles(workspacePath?: string): Promise<void> {
  if (!workspacePath) {
    fileSpecialistsCache.clear();
    refreshInFlight.clear();
    await refreshFileSpecialistsCache();
    return;
  }

  const cacheKey = getFileCacheKey(workspacePath);
  fileSpecialistsCache.delete(cacheKey);
  refreshInFlight.delete(cacheKey);
  await refreshFileSpecialistsCache(workspacePath);
}

// Wave 2: checkStoreInitialized, getCustomSpecialists, getUserOverrides, and
// applyUserOverrides have been removed. All specialist resolution now goes
// through the file-based system. The electron-store is only used for
// one-time migration during initSpecialistsService().

/**
 * Resolve the coding agent for a specialist. Per decision D1(B): never
 * silently fall back to the registry's default provider — that's how a
 * delegated specialist with no explicit `codingAgent` ended up spawning on
 * an uninstalled Auggie binary. Callers must thread an already
 * availability-validated provider as `fallbackCodingAgent`; when neither is
 * supplied, this returns `''` so callers can surface a failure instead of a
 * doomed spawn.
 */
function resolveSpecialistCodingAgent(
  explicitCodingAgent: string | undefined,
  fallbackCodingAgent?: string,
): string {
  return explicitCodingAgent || fallbackCodingAgent || '';
}

/**
 * Get the effective configuration for a specialist.
 * Priority order (Wave 2 — fully file-based):
 * 1. Project-level files (<repo>/.intent/specialists/*.md) — highest
 * 2. User-level files (~/.intent/specialists/*.md)
 * 3. Bundled files (resources/specialists/*.md)
 * 4. Hardcoded SPECIALISTS array (last-resort fallback)
 *
 * Note: User files that override a bundled specialist (same ID) already have
 * overrides baked in — no separate override layer needed.
 *
 * @param specialistId - The specialist ID to look up
 * @param providerId - Optional fallback coding agent used when the specialist does not specify one.
 */
export function getEffectiveSpecialist(
  specialistId: string,
  providerId?: string,
  workspacePath?: string,
): EffectiveSpecialist | null {
  // File-based specialists include project, user, and bundled specialists.
  // The cache already merges them with the correct priority.
  const fileSpecialist = findFileSpecialistSync(specialistId, workspacePath);
  if (fileSpecialist) {
    return {
      id: fileSpecialist.id,
      name: fileSpecialist.frontmatter.name,
      description: fileSpecialist.frontmatter.description,
      codingAgent: resolveSpecialistCodingAgent(fileSpecialist.frontmatter.codingAgent, providerId),
      model: fileSpecialist.frontmatter.model || '',
      behaviorPrompt: fileSpecialist.behaviorPrompt,
      isCustomized: fileSpecialist.source !== 'bundled',
      roleReminder: fileSpecialist.frontmatter.roleReminder,
      role: fileSpecialist.frontmatter.role,
      teamAgents: fileSpecialist.frontmatter.teamAgents,
      icon: fileSpecialist.frontmatter.icon,
    };
  }

  // Last resort fallback: hardcoded SPECIALISTS array from constants.
  // Only consulted when file-based loading yielded nothing — once file
  // specialists loaded, the loaded set is authoritative and shipped
  // specialists absent from it must not resurrect (daemon replacement mode).
  if (getCachedFileSpecialists(workspacePath).length === 0) {
    const hardcoded = getSpecialistById(specialistId);
    if (hardcoded) {
      logger.warn(
        `Using hardcoded fallback for specialist "${specialistId}" — file-based loading may have failed`,
      );
      return {
        id: hardcoded.id,
        name: hardcoded.name,
        description: hardcoded.description,
        codingAgent: resolveSpecialistCodingAgent(hardcoded.codingAgent, providerId),
        model: hardcoded.defaultModel || '',
        behaviorPrompt: hardcoded.defaultBehaviorPrompt,
        isCustomized: false,
        roleReminder: hardcoded.roleReminder,
        role: hardcoded.role,
        teamAgents: hardcoded.teamAgents,
        icon: hardcoded.icon,
      };
    }
  }

  return null;
}

/**
 * Get all specialists with effective configurations (Wave 2 — fully file-based).
 * Includes file-based specialists (project + user + bundled) with hardcoded fallback.
 *
 * @param providerId - Optional fallback coding agent used when a specialist does not specify one.
 */
export function getAllEffectiveSpecialists(
  providerId?: string,
  workspacePath?: string,
): EffectiveSpecialist[] {
  // File-based specialists (project > user > bundled, already merged in cache)
  const fileEffective: EffectiveSpecialist[] = getCachedFileSpecialists(workspacePath).map(
    (file) => ({
      id: file.id,
      name: file.frontmatter.name,
      description: file.frontmatter.description,
      codingAgent: resolveSpecialistCodingAgent(file.frontmatter.codingAgent, providerId),
      model: file.frontmatter.model || '',
      behaviorPrompt: file.behaviorPrompt,
      isCustomized: file.source !== 'bundled',
      roleReminder: file.frontmatter.roleReminder,
      role: file.frontmatter.role,
      teamAgents: file.frontmatter.teamAgents,
      icon: file.frontmatter.icon,
    }),
  );

  // Last resort fallback: hardcoded SPECIALISTS, only when file-based loading
  // yielded nothing. Once file specialists loaded, the loaded set is
  // authoritative — shipped specialists absent from it must not resurrect
  // (daemon replacement mode).
  const hardcodedFallback: EffectiveSpecialist[] =
    fileEffective.length > 0
      ? []
      : SPECIALISTS.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          codingAgent: resolveSpecialistCodingAgent(s.codingAgent, providerId),
          model: s.defaultModel || '',
          behaviorPrompt: s.defaultBehaviorPrompt,
          isCustomized: false,
          roleReminder: s.roleReminder,
          role: s.role,
          teamAgents: s.teamAgents,
          icon: s.icon,
        }));

  if (hardcodedFallback.length > 0) {
    logger.warn(
      `Using hardcoded fallback for ${hardcodedFallback.length} specialists — file-based loading may have failed`,
      { ids: hardcodedFallback.map((s) => s.id) },
    );
  }

  const allSpecialists = [...fileEffective, ...hardcodedFallback];

  let filtered = allSpecialists;

  // Hide GitHub-dependent specialists when GitHub is not connected
  if (!isGitHubAuthenticated) {
    filtered = filtered.filter((s) => !GITHUB_DEPENDENT_SPECIALIST_IDS.has(s.id));
  }

  return filtered;
}

/**
 * Format specialists for inclusion in agent prompts.
 * Omits concrete model IDs so the prompt is provider-agnostic.
 */
export async function formatSpecialistsForPrompt(workspacePath?: string): Promise<string> {
  await getFileSpecialists(workspacePath);
  const specialists = getAllEffectiveSpecialists(undefined, workspacePath);

  const rows = specialists
    .map((s) => `| **${s.name}** | \`${s.id}\` | ${s.description} |`)
    .join('\n');

  // Example ids come from the resolved list so a replacement set never sees
  // shipped ids it does not contain; implementor/verifier are preferred only
  // when actually present.
  const ids = specialists.map((s) => s.id);
  const delegateExampleId = ids.includes('implementor') ? 'implementor' : ids[0];
  const createExampleId = ids.includes('verifier')
    ? 'verifier'
    : (ids.find((id) => id !== delegateExampleId) ?? delegateExampleId);

  const examples = delegateExampleId
    ? `

**Examples** (call via the \`workspace_api\` tool):

\`\`\`
// Delegate an existing task note to a specialist
ws.agent.delegate({ taskNoteId: "abc-123", specialist: "${delegateExampleId}" })

// Create a new agent with a specialist
ws.agent.create("Review changes", "Check the implementation...", { specialist: "${createExampleId}" })
\`\`\`
`
    : '\n';

  return `## Agent Specialists

You have access to the following agent specialists. When delegating work, you can either create a blank agent or use \`specialist\` to create an agent with specific, pre-configured behavior:

| Specialist | ID | Purpose |
|------------|-------|---------|
${rows}${examples}
The specialist parameter sets the model and adds role-specific instructions. Override with \`model\` or \`behaviorPrompt\` if needed.`;
}
