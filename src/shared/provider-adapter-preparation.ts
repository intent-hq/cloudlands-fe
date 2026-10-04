/** Best-effort onboarding operation, shared by web and Electron transports. */
export interface AdapterPreparationClient {
  request<T>(method: string, params: unknown): Promise<T>;
}

interface Discovery {
  providers: Array<{ id: string; installed: boolean; gatedOff?: string | null }>;
}

interface PreparationState {
  context: string;
  attempted: Set<string>;
  unsupported: boolean;
  discovery?: Promise<void>;
}

const eligibleIds = new Set(['claude-code', 'codex', 'pi']);

/** Each owner retains only the current generation of each captured client. */
export function createProviderAdapterPreparer() {
  const states = new WeakMap<AdapterPreparationClient, PreparationState>();
  return function prepare(client: AdapterPreparationClient, context: string): Promise<void> {
    let state = states.get(client);
    if (!state || state.context !== context) {
      state = { context, attempted: new Set(), unsupported: false };
      states.set(client, state);
    }
    if (state.unsupported) return Promise.resolve();
    if (state.discovery) return state.discovery;
    const current = state;
    const run = async () => {
      try {
        const discovery = await client.request<Discovery>('host.providerDiscovery', {});
        if (states.get(client) !== current) return;
        const providerIds = [
          ...new Set(
            discovery.providers
              .filter((row) => eligibleIds.has(row.id) && row.installed && !row.gatedOff)
              .map((row) => row.id),
          ),
        ].filter((id) => !current.attempted.has(id));
        if (!providerIds.length) return;
        for (const id of providerIds) current.attempted.add(id);
        // Acknowledgement is not readiness. Never await downloads, auth, or even
        // this optional method's reply before allowing subsequent discovery.
        void client
          .request<{ accepted: true }>('host.prepareProviderAdapters', { providerIds })
          .catch((error: { rpcCode?: number; code?: number }) => {
            if (error?.rpcCode === -32601 || error?.code === -32601) current.unsupported = true;
          });
      } catch {
        // Offline discovery/preparation is optional; an explicit later refresh
        // may discover new providers. Ordinary launches retain their fallback.
      }
    };
    current.discovery = run().finally(() => {
      current.discovery = undefined;
    });
    return current.discovery;
  };
}
