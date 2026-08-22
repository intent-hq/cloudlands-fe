export function installChatToolNavigationIpcMock(): () => void {
  const originalApi = window.electronAPI;
  const api =
    originalApi ??
    ({
      invoke: async () => undefined,
      versions: { electron: '0.0.0-browser' },
    } as unknown as NonNullable<Window['electronAPI']>);

  if (!originalApi) {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  }

  const invoke = api.invoke.bind(api);
  api.invoke = (async (channel: string, ...args: unknown[]) => {
    const request = args[0] as { method?: string } | undefined;
    if (request?.method === 'note.get') {
      return { ok: true, result: { id: 'note-1', title: 'Plan' } };
    }
    return invoke(channel, ...args);
  }) as typeof api.invoke;

  return () => {
    if (originalApi) api.invoke = invoke;
    else Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  };
}
