import { isBinaryExtension } from '$shared/binary-file-extensions';

/**
 * Get the language identifier for syntax highlighting based on file extension
 */
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',

    // Web
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',

    // Frameworks
    svelte: 'svelte',
    vue: 'vue',

    // Data formats
    json: 'json',
    jsonc: 'json',
    json5: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    conf: 'ini',
    cfg: 'ini',

    // Programming languages
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    scala: 'scala',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    m: 'objective-c',
    mm: 'objective-c',
    r: 'r',

    // Scripting
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    ps1: 'powershell',
    bat: 'batch',
    cmd: 'batch',

    // Documentation
    md: 'markdown',
    mdx: 'markdown',
    markdown: 'markdown',
    tex: 'latex',
    rst: 'restructuredtext',

    // Database
    sql: 'sql',

    // GraphQL
    graphql: 'graphql',
    gql: 'graphql',

    // Functional languages
    elm: 'elm',
    clj: 'clojure',
    cljs: 'clojure',
    ex: 'elixir',
    exs: 'elixir',
    erl: 'erlang',
    hrl: 'erlang',
    fs: 'fsharp',
    fsx: 'fsharp',
    ml: 'ocaml',
    mli: 'ocaml',
    hs: 'haskell',
    lhs: 'haskell',

    // Other languages
    jl: 'julia',
    nim: 'nim',
    nims: 'nim',
    cr: 'crystal',
    d: 'd',
    zig: 'zig',
    v: 'v',
    dart: 'dart',
    lua: 'lua',
    pl: 'perl',

    // Assembly
    asm: 'assembly',
    s: 'assembly',

    // Config files
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    mk: 'makefile',
    cmake: 'cmake',
    nginx: 'nginx',
    tf: 'hcl',
    hcl: 'hcl',
    proto: 'protobuf',

    // Editor configs
    vim: 'vim',
    vimrc: 'vim',
    tmux: 'tmux',
  };

  // First try extension-based lookup
  const byExt = languageMap[ext || ''];
  if (byExt) return byExt;

  // Then handle common dotfiles / config files that don't have meaningful extensions
  const fileName = path.split('/').pop()?.toLowerCase() || '';
  const dotfileLanguageMap: Record<string, string> = {
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    '.babelrc': 'json',
    '.npmrc': 'ini',
    '.editorconfig': 'ini',
  };
  const byName = dotfileLanguageMap[fileName];
  if (byName) return byName;

  return 'text';
}

/**
 * Determine if a file should be treated as text based on its extension
 */
export function shouldTreatAsText(filePath: string): boolean {
  return !isBinaryExtension(filePath);
}

/**
 * Get a file's extension
 */
export function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() || '';
}

/**
 * Strip workspace path prefix from an absolute path to get a relative path.
 * Properly checks directory boundaries to avoid false prefix matches
 * (e.g., '/a/repo' should NOT match '/a/repos/src/file.ts').
 *
 * @example
 * stripWorkspacePrefix('/a/repo/src/file.ts', '/a/repo') // => 'src/file.ts'
 * stripWorkspacePrefix('/a/repos/src/file.ts', '/a/repo') // => '/a/repos/src/file.ts' (no match)
 * stripWorkspacePrefix('/a/repo', '/a/repo') // => ''
 */
export function stripWorkspacePrefix(absolutePath: string, workspacePath: string): string {
  if (!workspacePath) return absolutePath;
  if (absolutePath === workspacePath) return '';
  // Ensure match is at a directory boundary (workspace path followed by '/')
  if (absolutePath.startsWith(workspacePath + '/')) {
    return absolutePath.slice(workspacePath.length + 1);
  }
  return absolutePath;
}

/**
 * Get a file's name without path
 */
export function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/**
 * Get a file's directory path
 */
export function getDirectoryPath(filePath: string): string {
  const parts = filePath.split('/');
  parts.pop();
  return parts.join('/') || '';
}

/**
 * Get a file's name without extension
 */
export function getFileNameWithoutExtension(filePath: string): string {
  const fileName = getFileName(filePath);
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
}

/**
 * Check if a file is likely a binary file based on its extension
 */
export function isBinaryFile(filePath: string): boolean {
  return !shouldTreatAsText(filePath);
}

/**
 * Get MIME type for a file based on its extension
 */
export function getMimeType(filePath: string): string {
  const ext = getFileExtension(filePath);
  const mimeTypes: Record<string, string> = {
    // Text
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    xml: 'application/xml',

    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',

    // Documents
    pdf: 'application/pdf',

    // Archives
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',

    // Default
    '': 'application/octet-stream',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Check if a path is likely a directory
 */
export function isDirectory(path: string): boolean {
  // Simple heuristic: directories typically don't have extensions
  // or end with a slash
  return path.endsWith('/') || !path.includes('.') || path.lastIndexOf('/') > path.lastIndexOf('.');
}

/**
 * Normalize a file path for comparison: forward slashes, no trailing slash.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Check if two file paths refer to the same file.
 *
 * Handles absolute vs relative path comparisons safely by requiring a `/`
 * boundary before suffix matches. This prevents false positives like
 * `bar.js` matching `foobar.js`.
 *
 * @example
 * pathsMatch('src/foo/bar.js', '/home/user/project/src/foo/bar.js') // true
 * pathsMatch('bar.js', 'foobar.js') // false
 * pathsMatch('src/bar.js', 'other/bar.js') // false
 */
export function pathsMatch(pathA: string | undefined | null, pathB: string | undefined | null): boolean {
  if (!pathA || !pathB) return false;

  const a = normalizePath(pathA);
  const b = normalizePath(pathB);

  // Exact match after normalization
  if (a === b) return true;

  // Full path containment: one must be a complete suffix of the other
  // with a `/` boundary to prevent partial filename matches
  if (a.endsWith('/' + b)) return true;
  if (b.endsWith('/' + a)) return true;

  return false;
}
