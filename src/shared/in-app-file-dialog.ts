/**
 * In-app file dialogs — the wire shapes shared by main (`src/main/file-dialogs.ts`)
 * and the renderer host (`InAppFileDialogHost.svelte`).
 *
 * Some desktops (Intent OS) cannot show native file choosers. When the launcher
 * sets INTENT_IN_APP_PICKER=1, main asks the shown renderer to present the
 * in-app picker instead and waits for its answer. The picker lists the frontend
 * host's filesystem through main, so a picked path is always a path main can
 * open or write, whichever machine the window shows.
 */

/** One in-app file dialog request pushed from main to the shown renderer. */
export interface InAppFileDialogRequest {
  id: string;
  kind: 'open' | 'save';
  title?: string;
  /** Open: the folder (or a file in it) to start in. Save: a file name or full path. */
  defaultPath?: string;
  /** Open only: choose folders instead of files. */
  directory?: boolean;
  /** Open only: allow choosing more than one file. */
  multiple?: boolean;
  /** Lowercase extensions without the dot. Absent or empty shows every file. */
  extensions?: string[];
  buttonLabel?: string;
}

/** The renderer's answer: chosen paths, or `null` when the user cancelled. */
export interface InAppFileDialogResponse {
  id: string;
  paths: string[] | null;
}

/** Frontend-host folder listing; same shape as the daemon's `host.listDirectory`. */
export interface LocalDirectoryListing {
  path: string;
  parent: string | null;
  home: string;
  entries: { name: string; path: string; isDirectory: boolean; isGitRepo: boolean }[];
  favorites?: { id: string; path: string }[];
}

/** One file picked for a renderer `<input type=file>`. */
export interface InAppPickedFile {
  name: string;
  path: string;
  type: string;
  data: Uint8Array;
}

/** Renderer → main: pick files for a file input (accept + multiple as on the input). */
export interface InAppPickFilesRequest {
  accept?: string;
  multiple?: boolean;
  title?: string;
}

interface DialogFilter {
  name?: string;
  extensions: string[];
}

/**
 * Collapse Electron file filters into one extension list. A `*` filter (or no
 * filters) means every file is allowed, so the result is `undefined`.
 */
export function extensionsFromFilters(
  filters: readonly DialogFilter[] | undefined,
): string[] | undefined {
  if (!filters || filters.length === 0) return undefined;
  const extensions = new Set<string>();
  for (const filter of filters) {
    for (const raw of filter.extensions) {
      const ext = raw
        .trim()
        .replace(/^\*?\./, '')
        .toLowerCase();
      if (!ext || ext === '*') return undefined;
      extensions.add(ext);
    }
  }
  return extensions.size > 0 ? [...extensions] : undefined;
}

const MIME_WILDCARD_EXTENSIONS: Record<string, string[]> = {
  'image/*': [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'svg',
    'heic',
    'heif',
    'avif',
    'tif',
    'tiff',
  ],
  'video/*': ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'],
  'audio/*': ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'],
  'text/*': ['txt', 'md', 'csv', 'log', 'json', 'html', 'xml', 'yaml', 'yml'],
};

const MIME_EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/json': ['json'],
  'application/zip': ['zip'],
  'text/plain': ['txt'],
  'text/markdown': ['md', 'markdown'],
  'text/csv': ['csv'],
  'text/html': ['html', 'htm'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/svg+xml': ['svg'],
};

/**
 * Turn an `<input accept>` value into an extension list. Unknown MIME types
 * make the filter fall open (`undefined`) rather than hide files the input
 * would accept.
 */
export function extensionsFromAccept(accept: string | undefined): string[] | undefined {
  const tokens = (accept ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return undefined;
  const extensions = new Set<string>();
  for (const token of tokens) {
    if (token.startsWith('.')) {
      extensions.add(token.slice(1));
      continue;
    }
    const known = MIME_WILDCARD_EXTENSIONS[token] ?? MIME_EXTENSIONS[token];
    if (!known) return undefined;
    for (const ext of known) extensions.add(ext);
  }
  return extensions.size > 0 ? [...extensions] : undefined;
}

const EXTENSION_MIME: Record<string, string> = {};
for (const [mime, exts] of Object.entries(MIME_EXTENSIONS)) {
  for (const ext of exts) EXTENSION_MIME[ext] ??= mime;
}
Object.assign(EXTENSION_MIME, {
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  log: 'text/plain',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  ts: 'text/plain',
  js: 'text/javascript',
});

/** Best-effort MIME type for a picked file, matching what a browser file input reports. */
export function mimeTypeForFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return EXTENSION_MIME[name.slice(dot + 1).toLowerCase()] ?? '';
}

/** Whether `name` passes an extension filter (`undefined` passes everything). */
export function fileMatchesExtensions(name: string, extensions: readonly string[] | undefined) {
  if (!extensions || extensions.length === 0) return true;
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(`.${ext}`));
}
