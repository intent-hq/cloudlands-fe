// PERF: Detect content complexity to choose rendering strategy
// - Simple: plain text, no markdown - render as <p>
// - Static: has markdown - render the processed HTML directly (no TipTap)
//
// Read-only rendering never needs a live ProseMirror view: the markdown
// processor already emits final HTML for task lists (read-only checkboxes),
// tables, images, and intent:// links, and the container click/keydown
// handlers in MarkdownViewer provide the interactivity.
// Patterns that need markdown processing (rendered as processed static HTML)
const needsProcessingPatterns = [
  /(^|[^\\])\$(?!\$)(?=\S)(?:\\.|[^\\$\n])+?\$(?!\$)/, // Inline dollar math
  /(^|[^\\])\\\((?:\\.|[^\\\n])*?\\\)/, // Inline parenthesized math
  /^(?: {0,3})(?:\$\$|\\\[)/m, // Standalone display math (complete or unfinished)
  /^\s*[-*]\s*\[[ x]\]/m, // Task lists (rendered read-only)
  // i18n-ignore (scanner false positive: backticks in regex literal confuse the string tracker)
  /```/, // Code blocks (triple backticks)
  /`[^`]+`/, // Inline code (single backticks)
  /\|.*\|/, // Tables
  /\[.*\]\(.*\)/, // Links
  /!\[.*\]\(.*\)/, // Images
  /<[a-z][\s\S]*>/i, // HTML tags
  /^#{1,6}\s/m, // Headers
  /^\s*>\s/m, // Blockquotes
  /\*\*[^*]+\*\*/, // Bold (double asterisks)
  /\*[^*]+\*/, // Italic (single asterisks)
  /_[^_]+_/, // Italic (underscores)
  /~~[^~]+~~/, // Strikethrough
  /^[-*_]{3,}\s*$/m, // Horizontal rules
  /^\s*[-*+]\s/m, // Unordered lists
  /^\s*\d+\.\s/m, // Ordered lists
  // @-mentions and bare file paths that injectMentionSpans converts to mention chips
  /@note\//, // @note/... mentions
  /@context\[/, // @context[...] mentions
  /@member\[/, // Persisted workspace member mentions
  /@\//, // @/absolute/path mentions
  /@[A-Za-z0-9._-]+\/[^\s]*\.[A-Za-z0-9]+/, // @relative/path/file.ext mentions
  /@[A-Za-z0-9._-]+\.[A-Za-z0-9]+/, // @file.ext mentions
  /@auggie-personality-/, // @auggie-personality-* persona mentions
  /intent:\/\//, // intent:// protocol URLs
  /\b[A-Za-z0-9][A-Za-z0-9._-]+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql)\b/, // bare filenames like file.ext
  /\b[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql)\b/, // bare paths like dir/file.ext
];

export function classifyMarkdownContent(content: string): 'simple' | 'static' {
  if (!content) return 'simple';
  // Check if needs markdown processing
  if (needsProcessingPatterns.some((pattern) => pattern.test(content))) {
    return 'static';
  }
  return 'simple';
}
