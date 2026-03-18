import { call, put, select, takeEvery } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { SPECIALISTS_CHANNELS } from "$shared/ipc/channels";
import {
  exportBuiltinToFile,
  saveFileSpecialist,
  deleteFileSpecialist,
  openSpecialistsFolder,
  loadFileSpecialists,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  type FileSpecialist,
  type SpecialistsState,
} from "../specialists-slice";

const logger = createLogger("FileSpecialistsSaga");

function* reloadFileSpecialists() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.LIST_FILES,
        {}
      );
      if (result?.success && result.data) {
        const { specialists, errors } = result.data;

        // Get current state to preserve existing codingAgent values
        const state: SpecialistsState = yield* select((s: any) => s.specialists);
        const previousFileSpecialistsById = new Map(
          state.fileSpecialists.map(fs => [fs.id, fs])
        );

        const fileSpecs: FileSpecialist[] = specialists.map((s: any) => {
          const previous = previousFileSpecialistsById.get(s.id);
          // Preserve existing codingAgent if frontmatter doesn't provide one (including empty strings)
          const codingAgent = s.frontmatter.codingAgent || previous?.codingAgent;
          return {
            id: s.id,
            name: s.frontmatter.name,
            description: s.frontmatter.description,
            codingAgent,
            model: s.frontmatter.model || '',
            modelTier: s.frontmatter.modelTier,
            behaviorPrompt: s.behaviorPrompt,
            roleReminder: s.frontmatter.roleReminder,
            filePath: s.filePath,
            source: 'file' as const,
          };
        });
        yield* put(setFileSpecialists(fileSpecs));
        if (errors.length > 0) {
          logger.warn("Errors loading specialist files:", { errors });
        }
      }
    }
  } catch (error) {
    logger.error("Failed to reload file-based specialists:", error);
  } finally {
    yield* put(setFileSpecialistsLoaded(true));
  }
}

function* handleExportBuiltin(action: ReturnType<typeof exportBuiltinToFile>) {
  const [specialistId] = action.payload;
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.EXPORT_BUILTIN,
        { id: specialistId }
      );
      if (result?.success) {
        yield* call(reloadFileSpecialists);
      } else if (result?.error) {
        logger.warn("Failed to export specialist:", { error: result.error });
      }
    }
  } catch (error) {
    logger.error("Failed to export specialist to file:", error);
  }
}

function* handleSaveFileSpecialist(action: ReturnType<typeof saveFileSpecialist>) {
  const [specialist] = action.payload;
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.WRITE_FILE,
        specialist
      );
      if (result?.success) {
        yield* call(reloadFileSpecialists);
      } else if (result?.error) {
        logger.warn("Failed to save specialist file:", { error: result.error });
      }
    }
  } catch (error) {
    logger.error("Failed to save specialist file:", error);
  }
}

function* handleDeleteFileSpecialist(action: ReturnType<typeof deleteFileSpecialist>) {
  const [specialistId] = action.payload;
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result: any = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.DELETE_FILE,
        { id: specialistId }
      );
      if (result?.success) {
        yield* call(reloadFileSpecialists);
      } else if (result?.error) {
        logger.warn("Failed to delete specialist file:", { error: result.error });
      }
    }
  } catch (error) {
    logger.error("Failed to delete specialist file:", error);
  }
}

function* handleOpenFolder() {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        SPECIALISTS_CHANNELS.OPEN_FOLDER,
        {}
      );
    }
  } catch (error) {
    logger.error("Failed to open specialists folder:", error);
  }
}

export function* fileSpecialistsSaga() {
  yield* takeEvery(exportBuiltinToFile, handleExportBuiltin);
  yield* takeEvery(saveFileSpecialist, handleSaveFileSpecialist);
  yield* takeEvery(deleteFileSpecialist, handleDeleteFileSpecialist);
  yield* takeEvery(openSpecialistsFolder, handleOpenFolder);
  yield* takeEvery(loadFileSpecialists, reloadFileSpecialists);
}

