import {
  call,
  put,
} from "typed-redux-saga";
import { getLocalStorageJSON } from "$store/renderer/utils/safe-local-storage-saga";
import { SPECIALISTS_CHANNELS } from "$shared/ipc/channels";
import type { Specialist } from "$lib/constants/specialists";
import { selectActiveWorkspace } from "$store/renderer/slices/workspace/workspace-selectors";
import {
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
  setSpecialistsFolderPath,
  setProviderModelOverrides,
  PROVIDER_MODEL_OVERRIDES_KEY,
  type FileSpecialist,
} from "../specialists-slice";

function* loadBundledSpecialists() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.LIST_BUNDLED, {});
            if (result?.success && result.data?.specialists) {
                const specialists: Specialist[] = result.data.specialists.map((spec: any) => ({
                    id: spec.id,
                    name: spec.frontmatter.name,
                    description: spec.frontmatter.description,
                    codingAgent: spec.frontmatter.codingAgent,
                    defaultModel: spec.frontmatter.model || '',
                    defaultModelTier: spec.frontmatter.modelTier,
                    defaultBehaviorPrompt: spec.behaviorPrompt,
                    roleReminder: spec.frontmatter.roleReminder,
                    source: 'bundled' as const,
                    filePath: spec.filePath,
                }));
                yield* put(setBundledSpecialists(specialists));
            }
        }
    }
    catch {
    }
    finally {
        yield* put(setBundledSpecialistsLoaded(true));
    }
}

function* loadFileSpecialistsData() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const workspace = yield* selectActiveWorkspace.effect();
            const workspacePath: string | undefined = workspace?.worktreePath ?? workspace?.repositoryPath ?? workspace?.path;
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.LIST_FILES, { workspacePath });
            if (result?.success && result.data) {
                const { specialists, errors } = result.data;
                const fileSpecs: FileSpecialist[] = specialists.map((s: any) => ({
                    id: s.id,
                    name: s.frontmatter.name,
                    description: s.frontmatter.description,
                    codingAgent: s.frontmatter.codingAgent,
                    model: s.frontmatter.model || '',
                    modelTier: s.frontmatter.modelTier,
                    behaviorPrompt: s.behaviorPrompt,
                    roleReminder: s.frontmatter.roleReminder,
                    filePath: s.filePath,
                    source: s.source,
                }));
                yield* put(setFileSpecialists(fileSpecs));
                if (errors.length > 0) {
                }
            }
        }
    }
    catch {
    }
    finally {
        yield* put(setFileSpecialistsLoaded(true));
    }
}
function* loadFolderPath() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.GET_FOLDER_PATH, {});
            if (result?.success && result.data) {
                yield* put(setSpecialistsFolderPath(result.data));
            }
        }
    }
    catch {
    }
}
function* loadProviderModelOverridesCache() {
    const parsed = yield* call(getLocalStorageJSON<Record<string, Record<string, string>>>, PROVIDER_MODEL_OVERRIDES_KEY);
    if (parsed) {
        yield* put(setProviderModelOverrides(parsed));
    }
}
export function* initSaga() {
    yield* call(loadBundledSpecialists);
    // Wave 2: Overrides and custom specialists are no longer loaded from electron-store.
    // They are now fully file-based. Mark them as loaded immediately.
    yield* put(setOverridesLoaded(true));
    yield* put(setCustomSpecialistsLoaded(true));
    yield* call(loadFileSpecialistsData);
    yield* call(loadFolderPath);
    yield* call(loadProviderModelOverridesCache);
}
