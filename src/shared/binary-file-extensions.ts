/**
 * Binary File Extensions
 *
 * Shared constants and utilities for identifying binary/non-diffable files.
 * This file is safe to use in both main (Node.js) and renderer (browser) contexts.
 */

/**
 * Known binary file extensions that should never be diffed.
 * These files will show as "Binary file" in the UI.
 */
export const BINARY_FILE_EXTENSIONS = new Set([
  // Machine Learning / AI / Scientific Data
  '.onnx',
  '.onnx_data',
  '.pt',
  '.pth',
  '.bin',
  '.safetensors',
  '.h5',
  '.hdf5',
  '.pkl',
  '.pickle',
  '.npy',
  '.npz',
  '.model',
  '.weights',
  '.tflite',
  '.mlmodel',
  '.pb',
  '.ckpt',
  '.mat',    // MATLAB data files
  '.parquet', // Apache Parquet columnar data
  '.feather', // Apache Arrow Feather format
  '.arrow',   // Apache Arrow IPC format

  // WebAssembly
  '.wasm',

  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.icns',
  '.webp',
  '.tiff',
  '.tif',
  '.svg', // SVG could be diffed but can be very large
  '.psd',
  '.raw',
  '.heic',
  '.heif',
  '.avif',

  // Audio
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',

  // Video
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.wmv',
  '.flv',

  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.xz',
  '.tgz',

  // Executables / Libraries
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.a',
  '.o',
  '.obj',
  '.app',

  // Fonts
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',

  // Documents (binary formats)
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',

  // Database
  '.db',
  '.sqlite',
  '.sqlite3',

  // Compiled / Bytecode
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.ear',
  '.node',
]);

/**
 * Patterns for files that should be skipped (lock files, minified, build artifacts)
 */
export const SKIP_FILE_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /[\\/](dist|build|node_modules)[\\/]/,
];

/**
 * Get file extension from a path (works in both Node.js and browser)
 */
export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastDot > lastSlash && lastDot !== -1) {
    return filePath.slice(lastDot).toLowerCase();
  }
  return '';
}

/**
 * Check if a file extension indicates a binary file
 */
export function isBinaryExtension(filePath: string): boolean {
  const ext = getExtension(filePath);
  return BINARY_FILE_EXTENSIONS.has(ext);
}

/**
 * Check if a file matches skip patterns (lock files, minified, build artifacts)
 */
export function matchesSkipPattern(filePath: string): boolean {
  return SKIP_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Check if a file should be skipped for AI processing (binary, lock file, minified, etc.)
 * Returns { skip: boolean, reason?: string }
 */
export function shouldSkipFileForAI(filePath: string): { skip: boolean; reason?: string } {
  if (isBinaryExtension(filePath)) {
    return { skip: true, reason: 'binary/media file' };
  }
  if (matchesSkipPattern(filePath)) {
    return { skip: true, reason: 'lock/minified/build file' };
  }
  return { skip: false };
}

/**
 * Known text extensions that should never be treated as binary
 * even if content detection thinks they might be (e.g., SVG with special chars).
 */
export const KNOWN_TEXT_EXTENSIONS = new Set([
  // Markup / Web
  '.svg',
  '.xml',
  '.html',
  '.htm',
  '.xhtml',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.styl',
  '.vue',
  '.svelte',
  '.astro',
  '.ejs',
  '.hbs',
  '.pug',
  '.jade',
  '.njk',
  '.twig',
  '.liquid',

  // JavaScript / TypeScript
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',

  // Python
  '.py',
  '.pyi',
  '.pyw',

  // Ruby
  '.rb',

  // Rust
  '.rs',

  // Go
  '.go',

  // Java / JVM
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',

  // C / C++
  '.c',
  '.h',
  '.cpp',
  '.cxx',
  '.cc',
  '.hpp',
  '.hxx',

  // C# / F# / VB
  '.cs',
  '.fs',
  '.fsx',
  '.vb',

  // Swift / Objective-C
  '.swift',
  '.m',
  '.mm',

  // R
  '.r',
  '.R',

  // Perl
  '.pl',
  '.pm',

  // PHP
  '.php',
  '.phtml',

  // Lua
  '.lua',

  // Dart
  '.dart',

  // Elm
  '.elm',

  // Erlang / Elixir
  '.erl',
  '.ex',
  '.exs',

  // Haskell
  '.hs',
  '.lhs',

  // OCaml
  '.ml',
  '.mli',

  // Clojure
  '.clj',
  '.cljs',
  '.cljc',

  // Lisp / Scheme / Racket
  '.lisp',
  '.cl',
  '.el',
  '.rkt',
  '.scm',

  // Other languages
  '.zig',
  '.nim',
  '.v',
  '.vhdl',
  '.vhd',
  '.sv',
  '.svh',
  '.d',
  '.jl',
  '.cr',
  '.hack',
  '.hh',

  // Shell / Scripting
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.psm1',
  '.psd1',
  '.bat',
  '.cmd',
  '.awk',
  '.sed',

  // Data / Config
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.properties',
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.npmrc',
  '.nvmrc',
  '.eslintrc',
  '.prettierrc',
  '.babelrc',

  // Markup / Docs
  '.rst',
  '.tex',
  '.latex',
  '.adoc',
  '.asciidoc',
  '.org',
  '.wiki',
  '.textile',
  '.csv',
  '.tsv',

  // Build / Project
  '.cmake',
  '.make',
  '.mk',
  '.gradle',
  '.sbt',
  '.cabal',
  '.gemspec',
  '.podspec',
  '.bzl',
  '.bazel',
  '.BUILD',

  // Query / Database
  '.sql',
  '.graphql',
  '.gql',
  '.prisma',

  // Other text formats
  '.diff',
  '.patch',
  '.log',
  '.lock',
  '.mdx',
  '.jsonc',
  '.json5',
  '.jsonl',
  '.ndjson',
  '.geojson',
  '.ipynb',
]);

/**
 * Check if content appears to be binary by looking for null bytes
 * and high ratio of non-printable characters.
 *
 * @param buffer - The buffer to check
 * @param sampleSize - How many bytes to sample (default 8192)
 * @returns true if the content appears to be binary
 */
export function detectBinaryContent(buffer: Buffer, sampleSize = 8192): boolean {
  const sample = buffer.subarray(0, Math.min(sampleSize, buffer.length));

  // Check for null bytes - strong indicator of binary
  if (sample.includes(0)) {
    return true;
  }

  // Count non-printable characters (excluding common whitespace)
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    // Allow: tab (9), newline (10), carriage return (13), and printable ASCII (32-126)
    // Also allow common extended ASCII/UTF-8 lead bytes (194-244)
    if (
      byte !== 9 &&
      byte !== 10 &&
      byte !== 13 &&
      !(byte >= 32 && byte <= 126) &&
      !(byte >= 194 && byte <= 244) &&
      !(byte >= 128 && byte <= 191) // UTF-8 continuation bytes
    ) {
      nonPrintable++;
    }
  }

  // If more than 30% non-printable, likely binary
  return nonPrintable / sample.length > 0.3;
}
