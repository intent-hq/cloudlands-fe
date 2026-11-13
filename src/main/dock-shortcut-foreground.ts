export interface ForegroundSnapshot {
  pid?: number;
  appId?: string;
  appName?: string;
  title?: string;
  url?: string;
  urlStatus?: 'available' | 'unavailable' | 'permission-required';
}
type Outcome = 'ok' | 'timeout' | 'unavailable';
async function bounded<T>(
  read: () => Promise<T>,
  ms: number,
): Promise<{ value?: T; outcome: Outcome }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read().then(
        (value) => ({ value, outcome: 'ok' as const }),
        () => ({ outcome: 'unavailable' as const }),
      ),
      new Promise<{ outcome: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ outcome: 'timeout' }), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function sampleDockForeground(reader: {
  foregroundApp(): Promise<ForegroundSnapshot>;
  foregroundContext(): Promise<ForegroundSnapshot>;
}) {
  const start = Date.now();
  const app = await bounded(() => reader.foregroundApp(), 1_500);
  if (!app.value?.pid)
    return {
      snapshot: app.value ?? {},
      identityOutcome: app.outcome,
      urlOutcome: 'unavailable',
      elapsedMs: Date.now() - start,
    };
  const detail = await bounded(() => reader.foregroundContext(), 650);
  // A successful empty/different-owner reply is native focus invalidation, not
  // missing enrichment. Refuse it so the feed keeps its last verified context.
  if (detail.outcome === 'ok' && detail.value?.pid !== app.value.pid)
    throw new Error('Foreground observation invalidated');
  // A delayed or failed URL read cannot erase the app captured before focus.
  const snapshot =
    detail.value?.pid === app.value.pid ? { ...app.value, ...detail.value } : app.value;
  return {
    snapshot,
    identityOutcome: app.outcome,
    urlOutcome:
      detail.value?.pid === app.value.pid
        ? (detail.value.urlStatus ?? (detail.value.url ? 'available' : 'unavailable'))
        : detail.outcome === 'timeout'
          ? 'timeout'
          : 'unavailable',
    elapsedMs: Date.now() - start,
  };
}

/** Only a real, supported document URL is usable as a tab; app/title text is never a URL. */
export function foregroundDocumentUrl(value: unknown, appId?: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    // The native Figma tab is a file, not its selected node or mutable filename.
    // Only normalize the observed HTTPS document grammar; never infer figma://,
    // local shell URLs, file keys from titles, or browser address semantics.
    if (appId === 'com.figma.Desktop') {
      const match = /^\/design\/([A-Za-z0-9]+)(?:\/[^/]*)?$/.exec(url.pathname);
      return url.protocol === 'https:' &&
        ['figma.com', 'www.figma.com'].includes(url.hostname) &&
        !url.port &&
        !url.username &&
        !url.password &&
        match
        ? `https://www.figma.com/design/${match[1]}`
        : null;
    }
    return ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
