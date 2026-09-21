import { overrideMockIpcHandler } from '$shared/ipc-mock-router';

/** Intercept the fixture's editor choices at the real routed IPC seam. */
export function interceptSpecialistEditorLaunches(
  record: (launch: { channel: string; args: unknown[] }) => void,
) {
  const disposers = ['vscode:open', 'external-editors:open-with-other'].map((channel) =>
    overrideMockIpcHandler(channel, (...args) => {
      record({ channel, args });
      return { success: true };
    }),
  );
  return () => disposers.forEach((dispose) => dispose());
}
