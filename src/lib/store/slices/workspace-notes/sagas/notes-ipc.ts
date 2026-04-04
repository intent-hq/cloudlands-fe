/**
 * Notes IPC helper for sagas.
 *
 * Thin wrapper that calls `invoke` from electron-bridge and converts
 * the CommandResponse to a Result, matching the behaviour that was
 * previously provided by the private `notesClient.invoke` method.
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

