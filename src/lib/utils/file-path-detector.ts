/**
 * File Path Detector
 *
 * Utility for detecting file paths in text content and making them clickable.
 * Used by the TipTap editor to enable clicking on file paths to open files.
 *
 * Design goals:
 * - Performant: Only runs on click, not on every keystroke
 * - Robust: Handles various file path formats
 * - Low false positives: Avoids matching URLs, emails, etc.
 */

/**
 * Common file extensions that indicate a valid file path
 * Sorted roughly by frequency in typical codebases
 */
const FILE_EXTENSIONS = new Set([
  // Code
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'scala',
  'c',
  'cpp',
  'cc',
  'h',
  'hpp',
  'cs',
  'php',
  'swift',
  'dart',
  'lua',
  'r',
  'pl',
  'pm',
  // Web
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'vue',
  'svelte',
  'astro',
  // Config
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'xml',
  'env',
  'properties',
  // Docs
  'md',
  'mdx',
  'txt',
  'rst',
  'adoc',
  'org',
  // Data
  'csv',
  'tsv',
  'sql',
  'graphql',
  'gql',
  // Shell
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  // Other
  'dockerfile',
  'makefile',
  'gitignore',
  'gitattributes',
  'lock',
  'log',
  'patch',
  'diff',
]);

/**
 * Patterns that indicate something is NOT a file path
 */
const NON_FILE_PATTERNS = [
  /^https?:\/\//i, // URLs
  /^[a-z]+:\/\//i, // Other protocols (ftp://, file://, etc.)
  /^mailto:/i, // Email links
  /^tel:/i, // Phone links
  /^data:/i, // Data URIs
  /^#/, // Anchor links
  /^@[a-zA-Z]/, // @mentions that aren't file paths
  /^\$/, // Variables
];

/**
 * Regex to match file paths
 * Matches patterns like:
 * - src/components/Button.tsx
 * - ./relative/path.js
 * - ../parent/file.ts
 * - /absolute/path/file.py
 * - path/to/file.json
 * - File: path/to/file.ts
 * - typescript/apps/app/app/lib/agents/prompts/query.ts
 */
const FILE_PATH_REGEX = /^(?:File:\s*)?([./]?[a-zA-Z0-9_\-@./]+\.[a-zA-Z0-9]+)$/;

/**
 * Check if text looks like a file path
 */
export function isFilePath(text: string): boolean {
  const trimmed = text.trim();

  // Quick rejections
  if (trimmed.length < 3) return false;
  if (trimmed.length > 500) return false;

  // Check against non-file patterns
  for (const pattern of NON_FILE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Must match file path pattern
  const match = trimmed.match(FILE_PATH_REGEX);
  if (!match) return false;

  const path = match[1];

  // Extract extension
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;

  const ext = path.slice(lastDot + 1).toLowerCase();

  // Extension must be known (reduces false positives)
  return FILE_EXTENSIONS.has(ext);
}

/**
 * Extract file path from text, handling common prefixes
 * Returns null if no valid file path found
 */
export function extractFilePath(text: string): string | null {
  const trimmed = text.trim();

  // Handle "File: path/to/file.ts" format
  const filePrefix = /^File:\s*/i;
  const withoutPrefix = trimmed.replace(filePrefix, '');

  if (isFilePath(withoutPrefix)) {
    return withoutPrefix;
  }

  if (isFilePath(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Check if the target element should be treated as a file path link
 * Returns the file path if valid, null otherwise
 */
export function detectFilePathFromClick(target: HTMLElement): string | null {
  // Skip if already handled (links, mentions, etc.)
  if (target.closest('a')) return null;
  if (target.closest('[data-mention]')) return null;
  if (target.closest('[data-primitive-type]')) return null;

  // Skip if handled by FilePathDecorations plugin (has data-file-path attribute)
  if (target.closest('[data-file-path]')) return null;

  // Only handle clicks directly on code elements
  // This prevents matching file paths in the middle of paragraph text
  const codeElement = target.tagName === 'CODE' ? target : target.closest('code');
  if (!codeElement) return null;

  // Skip if this code element contains a file path decoration (already handled by plugin)
  if (codeElement.querySelector('[data-file-path]')) return null;

  // Get the text to check
  const text = codeElement.textContent?.trim() || '';
  if (!text) return null;

  // Extract and validate file path
  return extractFilePath(text);
}
