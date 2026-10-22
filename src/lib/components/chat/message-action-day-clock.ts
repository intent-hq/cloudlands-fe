// One browser clock for mounted timestamp presenters, released with its final
// subscriber. Local presentation state only; no message/domain state is cached.
const listeners = new Set<(day: string) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let day: string;

function refresh() {
  clearTimeout(timer);
  const now = new Date();
  const nextDay = now.toDateString();
  if (day !== nextDay) {
    day = nextDay;
    for (const listener of listeners) listener(day);
  }
  const midnight = new Date(now);
  // Local midnight also handles 23/25-hour DST days.
  midnight.setHours(24, 0, 0, 0);
  timer = setTimeout(refresh, midnight.getTime() - now.getTime());
}

export function observeMessageActionDay(listener: (day: string) => void): () => void {
  if (listeners.size === 0) {
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
  }
  listeners.add(listener);
  listener(day);
  return () => {
    listeners.delete(listener);
    if (listeners.size !== 0) return;
    clearTimeout(timer);
    timer = undefined;
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
  };
}
