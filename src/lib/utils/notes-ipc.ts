/**
 * Notes IPC helper shared by sagas and UI code that already performs explicit
 * user-triggered notes commands.
 */
import { invoke } from "$lib/electron-bridge";
import { commandResponseToResult } from "$shared/ipc-utils";
import type { Result } from "$shared/result";
import type { CommandResponse } from "$shared/types";

export async function notesIpc<T>(channel: string, data?: unknown): Promise<Result<T, string>> {
  try {
    const response = await invoke<CommandResponse<T>>(channel, data);
    return commandResponseToResult<T>(response);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "IPC call failed",
    };
  }
}