// Source: MermaidRenderer.svelte legacy source decoding.
function decodeBase64(str: string): string {
  try {
    // Check if it looks like base64 (no newlines, only base64 chars)
    if (/^[A-Za-z0-9+/=]+$/.test(str.trim())) {
      return decodeURIComponent(escape(atob(str)));
    }
    // Fall back to treating as plain text (for backwards compatibility)
    return str;
  } catch {
    // If base64 decode fails, return as-is
    return str;
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export function decodeMermaidSource(code: string): string {
  return decodeHtmlEntities(decodeBase64(code));
}
