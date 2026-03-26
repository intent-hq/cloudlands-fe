import { createSelector } from "../../utils/create-selector";
import { getItem, getItems, type Collection } from "../../utils/collection-utils";
import { SPECIALISTS, GITHUB_DEPENDENT_SPECIALIST_IDS, type Specialist } from "$lib/constants/specialists";
import { getDefaultModelForProvider, getDefaultProviderId, PROVIDER_MODEL_TIERS, } from "$shared/config/provider-config";
import { selectActiveProviderId } from "../provider-settings/provider-settings-selectors";
import { selectIsFeatureEnabled } from "../feature-codes/feature-codes-selectors";
import type { CustomSpecialist, FileSpecialist, SpecialistOverrides } from "./specialists-slice";
import { githubAuthStore } from "$features/github-auth/renderer/github-auth.store.svelte";
// ============================================================================
// Basic state selectors
// ============================================================================
export const selectBundledSpecialists = createSelector((state): Specialist[] => state.specialists.bundledSpecialists);
export const selectCustomSpecialistsCollection = createSelector((state): Collection<CustomSpecialist, "id"> => state.specialists.customSpecialists);
export const selectFileSpecialistsCollection = createSelector((state): Collection<FileSpecialist, "id"> => state.specialists.fileSpecialists);
export const selectCustomSpecialists = createSelector((state): CustomSpecialist[] => getItems(selectCustomSpecialistsCollection.select(state)));
export const selectFileSpecialists = createSelector((state): FileSpecialist[] => getItems(selectFileSpecialistsCollection.select(state)));
export const selectUserOverrides = createSelector((state): SpecialistOverrides => state.specialists.userOverrides);
export const selectOverridesLoaded = createSelector((state): boolean => state.specialists.overridesLoaded);
export const selectCustomSpecialistsLoaded = createSelector((state): boolean => state.specialists.customSpecialistsLoaded);
export const selectFileSpecialistsLoaded = createSelector((state): boolean => state.specialists.fileSpecialistsLoaded);
export const selectBundledSpecialistsLoaded = createSelector((state): boolean => state.specialists.bundledSpecialistsLoaded);
export const selectSpecialistsFolderPath = createSelector((state): string | null => state.specialists.specialistsFolderPath);
export const selectProviderModelOverrides = createSelector((state): Record<string, Record<string, string>> => state.specialists.providerModelOverrides);
// ============================================================================
// Visibility gating helpers
// ============================================================================
/**
 * Check if a specialist should be visible based on Redux state and GitHub auth.
 * Gates both feature-flagged specialists (ralph) and GitHub-dependent specialists (pr-shepherd, pr-reviewer).
 * Components that use selectSpecialists() should also reference githubAuthStore.state.isAuthenticated
 * to ensure reactivity when GitHub auth changes.
 */
export const selectIsSpecialistVisible = createSelector((state, specialistId: string): boolean => {
    // Gate ralph behind feature flag
    if (specialistId === 'ralph' && !selectIsFeatureEnabled.select(state, 'ralph-agent')) {
        return false;
    }
    // Gate GitHub-dependent specialists behind GitHub auth
    if (GITHUB_DEPENDENT_SPECIALIST_IDS.has(specialistId)) {
        if (!githubAuthStore.state.isAuthenticated) {
            return false;
        }
    }
    return true;
});
/**
 * Helper to filter specialists based on GitHub auth status.
 * Used by components that have access to githubAuthStore.
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
// Priority: file > bundled > custom > hardcoded SPECIALISTS (last resort)
// ============================================================================
export const selectSpecialists = createSelector((state): Specialist[] => {
    const fileSpecialists = getItems(state.specialists.fileSpecialists);
    const bundledSpecialists = state.specialists.bundledSpecialists;
    const customSpecialists = getItems(state.specialists.customSpecialists);
    const seen = new Set<string>();
    const result: Specialist[] = [];
    // File-based specialists first (highest priority)
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
    // Electron-store custom specialists (skip if ID conflicts)
    for (const custom of customSpecialists) {
        if (!seen.has(custom.id) && selectIsSpecialistVisible.select(state, custom.id)) {
            seen.add(custom.id);
            result.push({
                id: custom.id,
                name: custom.name,
                description: custom.description,
                codingAgent: custom.codingAgent,
                defaultModel: custom.model,
                defaultModelTier: undefined,
                defaultBehaviorPrompt: custom.behaviorPrompt,
                roleReminder: custom.roleReminder,
            });
        }
        else if (seen.has(custom.id)) {
        }
    }
    // Last resort fallback: hardcoded SPECIALISTS
    for (const specialist of SPECIALISTS) {
        if (!seen.has(specialist.id) && selectIsSpecialistVisible.select(state, specialist.id)) {
            seen.add(specialist.id);
            result.push(specialist);
        }
    }
    if (result.length > 0 &&
        fileSpecialists.length === 0 &&
        bundledSpecialists.length === 0) {
    }
    return result;
});
// ============================================================================
// Parameterized selectors
// ============================================================================
/** Get specialist info by ID from any source */
export const selectSpecialistById = createSelector((state, specialistId: string): {
    id: string;
    name: string;
    description: string;
    source: 'file' | 'builtin' | 'custom';
} | null => {
    const file = getItem(state.specialists.fileSpecialists, specialistId);
    if (file) {
        return { id: file.id, name: file.name, description: file.description, source: 'file' };
    }
    const bundled = state.specialists.bundledSpecialists.find((s: Specialist) => s.id === specialistId);
    if (bundled) {
        return { id: bundled.id, name: bundled.name, description: bundled.description, source: 'builtin' };
    }
    const custom = getItem(state.specialists.customSpecialists, specialistId);
    if (custom) {
        return { id: custom.id, name: custom.name, description: custom.description, source: 'custom' };
    }
    return null;
});
/** Get specialist display name by ID */
export const selectSpecialistName = createSelector((state, specialistId: string): string | null => {
    return selectSpecialistById.select(state, specialistId)?.name ?? null;
});
/** Get the effective model for a specialist (override or default) */
export const selectEffectiveModel = createSelector((state, specialistId: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    if (!specialist)
        return '';
    // Check for user override first
    const override = state.specialists.userOverrides.modelOverrides[specialistId];
    if (override)
        return override;
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
export const selectResolvedDefaultModel = createSelector((state, specialistId: string, providerId?: string): string => {
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
/** Get the effective behavior prompt for a specialist */
export const selectEffectiveBehaviorPrompt = createSelector((state, specialistId: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    if (!specialist)
        return '';
    const override = state.specialists.userOverrides.behaviorPromptOverrides[specialistId];
    return override || specialist.defaultBehaviorPrompt;
});
/** Check if a specialist is built-in (bundled) */
export const selectIsBuiltIn = createSelector((state, specialistId: string): boolean => {
    return state.specialists.bundledSpecialists.some((s: Specialist) => s.id === specialistId);
});
/** Check if a specialist is file-based */
export const selectIsFileBased = createSelector((state, specialistId: string): boolean => {
    return !!getItem(state.specialists.fileSpecialists, specialistId);
});
/** Check if a specialist has any overrides */
export const selectHasOverrides = createSelector((state, specialistId: string): boolean => {
    return (!!state.specialists.userOverrides.codingAgentOverrides?.[specialistId] ||
        !!state.specialists.userOverrides.modelOverrides?.[specialistId] ||
        !!state.specialists.userOverrides.behaviorPromptOverrides?.[specialistId]);
});
/** Get a file specialist by ID */
export const selectGetFileSpecialist = createSelector((state, specialistId: string): FileSpecialist | undefined => {
    return getItem(state.specialists.fileSpecialists, specialistId);
});
/** Get the on-disk file path for a specialist */
export const selectSpecialistFilePath = createSelector((state, specialistId: string): string | undefined => {
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
/** Get the effective coding agent for a specialist (override → specialist default → active provider) */
export const selectEffectiveCodingAgent = createSelector((state, specialistId: string): string => {
    const override = state.specialists.userOverrides.codingAgentOverrides?.[specialistId];
    if (override)
        return override;
    return selectResolvedDefaultCodingAgent.select(state, specialistId);
});
/** Get the resolved default coding agent for a specialist (specialist default → active provider) */
export const selectResolvedDefaultCodingAgent = createSelector((state, specialistId: string): string => {
    const specialists = selectSpecialists.select(state);
    const specialist = specialists.find((s: Specialist) => s.id === specialistId);
    return specialist?.codingAgent || selectActiveProviderId.select(state);
});
