import { store } from "../../store";
import {
  getItem,
  getItems,
  type Collection,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import {
  SPECIALISTS,
  GITHUB_DEPENDENT_SPECIALIST_IDS,
  type Specialist,
} from "$lib/constants/specialists";
import {
  getDefaultModelForProvider,
  getDefaultProviderId,
  PROVIDER_MODEL_TIERS,
} from "$shared/config/provider-config";
import { selectActiveProviderId } from "../provider-settings/provider-settings-selectors";
import type { CustomSpecialist, FileSpecialist, SpecialistOverrides } from "./specialists-slice";
import { selectGitHubAuthIsAuthenticated } from "../github-auth/github-auth-selectors";
// ============================================================================
// Basic state selectors
// ============================================================================
export const selectBundledSpecialists = store.createSelector((state): Specialist[] => state.specialists.bundledSpecialists);
export const selectCustomSpecialistsCollection = store.createSelector((state): Collection<CustomSpecialist, "id"> => state.specialists.customSpecialists);
export const selectFileSpecialistsCollection = store.createSelector((state): Collection<FileSpecialist, "id"> => state.specialists.fileSpecialists);
export const selectCustomSpecialists = store.createSelector((state): CustomSpecialist[] => getItems(selectCustomSpecialistsCollection.select(state)));
export const selectFileSpecialists = store.createSelector((state): FileSpecialist[] => getItems(selectFileSpecialistsCollection.select(state)));
export const selectUserOverrides = store.createSelector((state): SpecialistOverrides => state.specialists.userOverrides);
export const selectOverridesLoaded = store.createSelector((state): boolean => state.specialists.overridesLoaded);
export const selectCustomSpecialistsLoaded = store.createSelector((state): boolean => state.specialists.customSpecialistsLoaded);
export const selectFileSpecialistsLoaded = store.createSelector((state): boolean => state.specialists.fileSpecialistsLoaded);
export const selectBundledSpecialistsLoaded = store.createSelector((state): boolean => state.specialists.bundledSpecialistsLoaded);
export const selectSpecialistsFolderPath = store.createSelector((state): string | null => state.specialists.specialistsFolderPath);
export const selectProviderModelOverrides = store.createSelector((state): Record<string, Record<string, string>> => state.specialists.providerModelOverrides);
// ============================================================================
// Visibility gating helpers
// ============================================================================
/**
 * Check if a specialist should be visible based on Redux state and GitHub auth.
 * Gates GitHub-dependent specialists (pr-shepherd, pr-reviewer).
 */
export const selectIsSpecialistVisible = store.createSelector((state, specialistId: string): boolean => {
    // Gate GitHub-dependent specialists behind GitHub auth
    if (GITHUB_DEPENDENT_SPECIALIST_IDS.has(specialistId)) {
        if (!selectGitHubAuthIsAuthenticated.select(state)) {
            return false;
        }
    }
    return true;
});
/**
 * Helper to filter specialists based on GitHub auth status.
 * @param specialists List of specialists to filter
 * @param isGitHubAuthenticated Whether user is authenticated with GitHub
 */
export function filterSpecialistsByGitHubAuth(specialists: Specialist[], isGitHubAuthenticated: boolean): Specialist[] {
    if (isGitHubAuthenticated) {
        return specialists;
    }
    // Hide GitHub-dependent specialists when not authenticated
    return specialists.filter((s) => !GITHUB_DEPENDENT_SPECIALIST_IDS.has(s.id));
}
// ============================================================================
// Derived: merged specialists list
// Priority: file (project > user) > bundled > hardcoded SPECIALISTS (last resort)
// ============================================================================
export const selectSpecialists = store.createSelector((state): Specialist[] => {
    const fileSpecialists = getItems(state.specialists.fileSpecialists);
    const bundledSpecialists = state.specialists.bundledSpecialists;
    const seen = new Set<string>();
    const result: Specialist[] = [];
    // File-based specialists first (highest priority — includes project + user files)
    for (const file of fileSpecialists) {
        if (!seen.has(file.id) && selectIsSpecialistVisible.select(state, file.id)) {
            seen.add(file.id);
            const effectiveTier = file.modelTier || (!file.model ? 'balanced' : undefined);
            result.push({
                id: file.id,
                name: file.name,
                description: file.description,
                codingAgent: file.codingAgent,
                defaultModel: file.model || undefined,
                defaultModelTier: effectiveTier,
                defaultBehaviorPrompt: file.behaviorPrompt,
                roleReminder: file.roleReminder,
                source: file.source,
            });
        }
    }
    // Bundled specialists (skip if overridden by file)
    for (const specialist of bundledSpecialists) {
        if (!seen.has(specialist.id) && selectIsSpecialistVisible.select(state, specialist.id)) {
            seen.add(specialist.id);
            result.push(specialist);
        }
    }
    // Wave 2: Electron-store custom specialists are no longer included.
    // They should have been migrated to files on startup.
    // Last resort fallback: hardcoded SPECIALISTS
    for (const specialist of SPECIALISTS) {
        if (!seen.has(specialist.id) && selectIsSpecialistVisible.select(state, specialist.id)) {
            seen.add(specialist.id);
            result.push(specialist);
        }
    }

    // Stable sort: bundled specialists in their original order first,
    // then custom (user/project) specialists sorted alphabetically by name.
    // This prevents the list from reordering when a specialist is re-saved.
    const bundledOrder = new Map<string, number>();
    // Build order from bundled + hardcoded fallback (both represent "built-in" order)
    for (const s of bundledSpecialists) {
        if (!bundledOrder.has(s.id)) bundledOrder.set(s.id, bundledOrder.size);
    }
    for (const s of SPECIALISTS) {
        if (!bundledOrder.has(s.id)) bundledOrder.set(s.id, bundledOrder.size);
    }

    result.sort((a, b) => {
        const aIsBuiltIn = bundledOrder.has(a.id);
        const bIsBuiltIn = bundledOrder.has(b.id);
        // Built-in specialists come first, in their original order
        if (aIsBuiltIn && bIsBuiltIn) return bundledOrder.get(a.id)! - bundledOrder.get(b.id)!;
        if (aIsBuiltIn && !bIsBuiltIn) return -1;
        if (!aIsBuiltIn && bIsBuiltIn) return 1;
        // Custom specialists sorted alphabetically by name
        return a.name.localeCompare(b.name);
    });

    return result;
});
// ============================================================================
// Parameterized selectors
// ============================================================================
/** Get specialist info by ID from any source */
export const selectSpecialistById = store.createSelector((state, specialistId: string): {
    id: string;
    name: string;
    description: string;
    source: FileSpecialist['source'] | 'builtin';
} | null => {
    const file = getItem(state.specialists.fileSpecialists, specialistId);
    if (file) {
        return { id: file.id, name: file.name, description: file.description, source: file.source };
    }
    const bundled = state.specialists.bundledSpecialists.find((s: Specialist) => s.id === specialistId);
    if (bundled) {
        return { id: bundled.id, name: bundled.name, description: bundled.description, source: 'builtin' };
    }
    return null;
});
/** Get specialist display name by ID */
export const selectSpecialistName = store.createSelector((state, specialistId: string): string | null => {
    return selectSpecialistById.select(state, specialistId)?.name ?? null;
});
/** Get the effective model for a specialist (file override → bundled default → tier resolution) */
export const selectEffectiveModel = store.createSelector((state, specialistId: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    if (!specialist)
        return '';
    // Wave 2: File specialists already have the correct model baked in.
    // No need to check userOverrides — they're deprecated.
    // Resolve the model tier to an actual model ID for the active provider
    if (specialist.defaultModelTier) {
        const providerId = selectEffectiveCodingAgent.select(state, specialistId);
        if (providerId in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(providerId, specialist.defaultModelTier);
            const defaultProviderId = getDefaultProviderId();
            return providerId !== defaultProviderId ? `${providerId}:${baseModel}` : baseModel;
        }
        // Provider has no tier mapping — fall through
    }
    return specialist.defaultModel ?? '';
});
/** Get the resolved default model (ignoring user overrides) */
export const selectResolvedDefaultModel = store.createSelector((state, specialistId: string, providerId?: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    if (!specialist)
        return '';
    if (specialist.defaultModelTier) {
        const effectiveProviderId = providerId ?? selectEffectiveCodingAgent.select(state, specialistId);
        if (effectiveProviderId in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(effectiveProviderId, specialist.defaultModelTier);
            const defaultProviderId = getDefaultProviderId();
            return effectiveProviderId !== defaultProviderId ? `${effectiveProviderId}:${baseModel}` : baseModel;
        }
    }
    return specialist.defaultModel ?? '';
});
/** Get the effective behavior prompt for a specialist (file override → bundled default) */
export const selectEffectiveBehaviorPrompt = store.createSelector((state, specialistId: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    if (!specialist)
        return '';
    // Wave 2: File specialists already have the correct prompt baked in.
    return specialist.defaultBehaviorPrompt;
});
/** Check if a specialist is built-in (bundled) */
export const selectIsBuiltIn = store.createSelector((state, specialistId: string): boolean => {
    return state.specialists.bundledSpecialists.some((s: Specialist) => s.id === specialistId);
});
/** Check if a specialist is file-based */
export const selectIsFileBased = store.createSelector((state, specialistId: string): boolean => {
    return !!getItem(state.specialists.fileSpecialists, specialistId);
});
/** Check if a built-in specialist has been overridden by a user file */
export const selectHasOverrides = store.createSelector((state, specialistId: string): boolean => {
    const isBuiltIn = state.specialists.bundledSpecialists.some((s: Specialist) => s.id === specialistId);
    if (!isBuiltIn) return false;
    const file = getItem(state.specialists.fileSpecialists, specialistId);
    return !!file && file.source === 'user';
});
/** Get a file specialist by ID */
export const selectGetFileSpecialist = store.createSelector((state, specialistId: string): FileSpecialist | undefined => {
    return getItem(state.specialists.fileSpecialists, specialistId);
});
export const selectSpecialistSourceLabel = store.createSelector((state, specialistId: string): 'Project' | 'User' | 'Built-in' | null => {
    const file = getItem(state.specialists.fileSpecialists, specialistId);
    if (file?.source === 'project') {
        return 'Project';
    }
    if (file?.source === 'user') {
        return 'User';
    }
    if (state.specialists.bundledSpecialists.some((s: Specialist) => s.id === specialistId)) {
        return 'Built-in';
    }
    return null;
});
/** Get the on-disk file path for a specialist */
export const selectSpecialistFilePath = store.createSelector((state, specialistId: string): string | undefined => {
    const file = getItem(state.specialists.fileSpecialists, specialistId);
    if (file)
        return file.filePath;
    const bundled = state.specialists.bundledSpecialists.find((s: Specialist) => s.id === specialistId);
    if (bundled && 'filePath' in bundled)
        return (bundled as Specialist & {
            filePath: string;
        }).filePath;
    return undefined;
});
/** Get the effective coding agent for a specialist (file value → bundled default → active provider) */
export const selectEffectiveCodingAgent = store.createSelector((state, specialistId: string): string => {
    // Wave 2: File specialists already have the correct codingAgent baked in.
    // Check file specialist first, then fall back to bundled/hardcoded.
    const file = getItem(state.specialists.fileSpecialists, specialistId);
    if (file?.codingAgent) return file.codingAgent;
    return selectResolvedDefaultCodingAgent.select(state, specialistId);
});
/** Get the resolved default coding agent for a specialist (specialist default → active provider) */
export const selectResolvedDefaultCodingAgent = store.createSelector((state, specialistId: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    return specialist?.codingAgent || selectActiveProviderId.select(state);
});
