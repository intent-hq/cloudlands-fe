import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

export interface BootWindowBackendOptions {
  /** The persisted active machine (last used). */
  activeId: string;
  /** An `open` link refers to this machine's daemon, so its window is local. */
  wantsLocal: boolean;
  /** Build the machine's pooled client; rejects when it cannot be built. */
  connect: (backendId: string) => Promise<unknown>;
  onFallback?: (backendId: string, error: unknown) => void;
}

/**
 * The machine the boot frame opens on when nothing was restored: the
 * persisted active machine, or the local one for an `open` link or when the
 * active machine's client cannot be built (deleted record, missing token), so
 * the window is not one whose every RPC fails closed.
 */
export async function resolveBootWindowBackendId(
  options: BootWindowBackendOptions,
): Promise<string> {
  const { activeId, wantsLocal, connect, onFallback } = options;
  if (wantsLocal || activeId === LOCAL_CONNECTION_ID) return LOCAL_CONNECTION_ID;
  try {
    await connect(activeId);
    return activeId;
  } catch (error) {
    onFallback?.(activeId, error);
    return LOCAL_CONNECTION_ID;
  }
}
