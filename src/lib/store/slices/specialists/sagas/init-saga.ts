import { call, put } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { SPECIALISTS_CHANNELS } from "$shared/ipc/channels";
import type { Specialist } from "$lib/constants/specialists";
import {
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialists,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setUserOverrides,
  setOverridesLoaded,
  setSpecialistsFolderPath,
  setProviderModelOverrides,
  SPECIALISTS_OVERRIDES_KEY,
  CUSTOM_SPECIALISTS_KEY,
  PROVIDER_MODEL_OVERRIDES_KEY,
  type FileSpecialist,
} from "../specialists-slice";

const logger = createLogger("SpecialistsInitSaga");

function* loadBundledSpecialists() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.LIST_BUNDLED,
        {}
      );
      if (result?.success && result.data?.specialists) {
        const specialists: Specialist[] = result.data.specialists.map(
          (spec: any) => ({
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
          })
        );
        yield* put(setBundledSpecialists(specialists));
        logger.info("Loaded bundled specialists", { count: specialists.length });
      }
    }
  } catch (error) {
    logger.error("Failed to load bundled specialists", { error });
  } finally {
    yield* put(setBundledSpecialistsLoaded(true));
  }
}

function* loadOverrides() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        'settings:get',
        { key: SPECIALISTS_OVERRIDES_KEY }
      );
      if (result?.success && result.data) {
        yield* put(setUserOverrides(result.data));
        logger.info("Loaded specialist overrides from electron-store");
      }
    }
  } catch (error) {
    logger.error("Failed to load specialist overrides:", error);
  } finally {
    yield* put(setOverridesLoaded(true));
  }
}

function* loadCustomSpecialists() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        'settings:get',
        { key: CUSTOM_SPECIALISTS_KEY }
      );
      if (result?.success && result.data) {
        yield* put(setCustomSpecialists(result.data));
        logger.debug("Loaded custom specialists from electron-store");
      }
    }
  } catch (error) {
    logger.error("Failed to load custom specialists:", error);
  } finally {
    yield* put(setCustomSpecialistsLoaded(true));
  }
}

function* loadFileSpecialistsData() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.LIST_FILES,
        {}
      );
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
          source: 'file' as const,
        }));
        yield* put(setFileSpecialists(fileSpecs));
        if (errors.length > 0) {
          logger.warn("Errors loading specialist files:", { errors });
        }
      }
    }
  } catch (error) {
    logger.error("Failed to load file-based specialists:", error);
  } finally {
    yield* put(setFileSpecialistsLoaded(true));
  }
}

function* loadFolderPath() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.GET_FOLDER_PATH,
        {}
      );
      if (result?.success && result.data) {
        yield* put(setSpecialistsFolderPath(result.data));
      }
    }
  } catch (error) {
    logger.error("Failed to get specialists folder path:", error);
  }
}



function* loadProviderModelOverridesCache() {
  try {
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      PROVIDER_MODEL_OVERRIDES_KEY
    );
    if (stored) {
      const parsed: Record<string, Record<string, string>> = JSON.parse(stored);
      yield* put(setProviderModelOverrides(parsed));
      logger.debug("Loaded per-provider model overrides cache");
    }
  } catch (error) {
    logger.error("Failed to load per-provider model overrides cache:", error);
  }
}

export function* initSaga() {
  yield* call(loadBundledSpecialists);
  yield* call(loadOverrides);
  yield* call(loadCustomSpecialists);
  yield* call(loadFileSpecialistsData);
  yield* call(loadFolderPath);
  yield* call(loadProviderModelOverridesCache);
}
