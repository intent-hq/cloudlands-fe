import type {
  DevConsoleChannel,
  DevConsoleRequest,
  DevConsoleResponses,
} from '$shared/ipc/dev-console-contract';

/** Direct typed native bridge: intentionally independent of app/daemon boot and IPC logging. */
export async function devConsoleInvoke<C extends DevConsoleChannel>(
  channel: C,
  request: DevConsoleRequest<C>,
): Promise<DevConsoleResponses[C]> {
  if (!window.electronAPI?.invoke) throw new Error('Dev Console requires Electron');
  return window.electronAPI.invoke(channel, request);
}

export function openDevConsole(): Promise<DevConsoleResponses['dev-console:open']> {
  return devConsoleInvoke('dev-console:open', {});
}
