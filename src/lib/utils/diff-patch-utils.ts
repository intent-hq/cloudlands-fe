const UNIFIED_DIFF_HEADER_REGEX = /^---[ \t]+[^\r\n]+\r?\n\+\+\+[ \t]+[^\r\n]+\r?\n@@[ \t]+-\d+(?:,\d+)?[ \t]+\+\d+(?:,\d+)?[ \t]+@@/m;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

export function hasUnifiedDiffHeaders(diff: string): boolean {
  return UNIFIED_DIFF_HEADER_REGEX.test(diff);
}

export function withSyntheticDiffHeaders(diff: string): string {
  if (hasUnifiedDiffHeaders(diff)) {
    return diff;
  }

  const normalizedDiff = diff.replace(/\r\n?/g, '\n');
  const hasTrailingNewline = normalizedDiff.endsWith('\n');
  const diffBody = hasTrailingNewline ? normalizedDiff.slice(0, -1) : normalizedDiff;
  const lines = diffBody.length > 0 ? diffBody.split('\n') : [];
  const patchLines: string[] = [];
  let oldLineCount = 0;
  let newLineCount = 0;

  for (const line of lines) {
    if (line.startsWith('-')) {
      oldLineCount += 1;
      patchLines.push(line);
    } else if (line.startsWith('+')) {
      newLineCount += 1;
      patchLines.push(line);
    } else if (line === NO_NEWLINE_MARKER) {
      patchLines.push(line);
    } else {
      oldLineCount += 1;
      newLineCount += 1;
      patchLines.push(line.startsWith(' ') ? line : ` ${line}`);
    }
  }

  const oldStartLine = oldLineCount > 0 ? 1 : 0;
  const newStartLine = newLineCount > 0 ? 1 : 0;

  return `--- a/file\n+++ b/file\n@@ -${oldStartLine},${oldLineCount} +${newStartLine},${newLineCount} @@\n${patchLines.join('\n')}${hasTrailingNewline && patchLines.length > 0 ? '\n' : ''}`;
}

function decodeBase64(str: string): string {
  try {
    if (/^[A-Za-z0-9+/=]+$/.test(str.trim())) {
      return decodeURIComponent(escape(atob(str)));
    }
  } catch {
    // If decode fails, use as-is.
  }
  return str;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&#x2F;': '/',
};

const HTML_ENTITY_RE = /&(?:lt|gt|amp|quot|#39|#x27|#x2F);/g;

function decodeHtmlEntities(str: string): string {
  return str.replace(HTML_ENTITY_RE, (match) => HTML_ENTITY_MAP[match] ?? match);
}

export function decodeDiffContent(str: string): string {
  return decodeHtmlEntities(decodeBase64(str));
}