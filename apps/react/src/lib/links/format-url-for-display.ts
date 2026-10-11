/** Pure source formatter from tooltip/link-tooltip-state.svelte.ts. */
export function formatUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    const display = parsed.host + parsed.pathname;
    const cleaned = display.endsWith('/') ? display.slice(0, -1) : display;
    if (cleaned.length <= 50) return cleaned;
    const parts = cleaned.split('/');
    let result = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const next = result + '/' + parts[i];
      if (next.length > 47) return result + '/…';
      result = next;
    }
    return result;
  } catch {
    return url.length > 50 ? url.slice(0, 47) + '…' : url;
  }
}
