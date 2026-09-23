interface RenderRequest {
  source: string;
  isStreaming: boolean;
  revision: string;
}

/** One in-flight render and one latest trailing snapshot; not a resetting debounce. */
export function createProgressiveRenderQueue(
  render: (request: RenderRequest, isCurrent: () => boolean) => Promise<void>,
  interval = 80,
) {
  let latest: RenderRequest | undefined;
  let pending: RenderRequest | undefined;
  let busy = false;
  let disposed = false;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function drain() {
    timer = undefined;
    if (disposed || busy || !pending) return;
    const request = pending;
    const generation = epoch;
    pending = undefined;
    busy = true;
    try {
      await render(request, () => !disposed && generation === epoch);
    } finally {
      busy = false;
      if (!disposed && pending) timer = setTimeout(() => void drain(), interval);
    }
  }

  return {
    update(request: RenderRequest) {
      if (disposed) return;
      if (
        latest?.source === request.source &&
        latest.isStreaming === request.isStreaming &&
        latest.revision === request.revision
      )
        return;
      // Append-only streaming can paint its in-flight snapshot before catching up,
      // otherwise continuous tokens would invalidate every render and starve paint.
      // Replacements, configuration changes and final validation invalidate it.
      if (
        latest &&
        (!request.isStreaming ||
          !latest.isStreaming ||
          request.revision !== latest.revision ||
          !request.source.startsWith(latest.source))
      )
        epoch += 1;
      latest = request;
      pending = request;
      if (!busy && timer === undefined) void drain();
    },
    dispose() {
      disposed = true;
      epoch += 1;
      pending = undefined;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
