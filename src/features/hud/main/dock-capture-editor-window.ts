/**
 * The capture editor window (Capture and recording editor spec): an ordinary,
 * resizable window owned by main, larger than the dock's panel, opened for one
 * attachment at the dock's explicit request. It is not always on top and is never
 * raised or focused except by that request.
 *
 * Ownership: a session belongs to the exact dock window and document that opened
 * it (strict backend binding). The editor window gets the session only through its
 * own main frame on its current document, stamped with the same backend. When the
 * dock's document or binding goes away, the editor closes.
 */
import { randomUUID } from 'node:crypto';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { BrowserWindow, ipcMain, nativeTheme, screen, type IpcMainInvokeEvent } from 'electron';
import { Logger } from '../../../shared/logger';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  DOCK_CAPTURE_EDITOR_ROUTE,
  DockCaptureEditorCloseSchema,
  DockCaptureEditorOpenSchema,
  canonicalDockAttachmentPath,
  type DockCaptureEditorOpenResult,
  type DockCaptureEditorSnapshot,
} from '../../../shared/dock-capture-editor';
import {
  getWindowAppearanceOptions,
  getWindowTitleBarOptions,
} from '../../../shared/main/window-appearance';
import { fixWebContentsZoom } from '../../../main/fixed-zoom';
import { getDockWindow } from '../../../main/dock-window';
import {
  noteDockCaptureEditorFocused,
  registerDockCaptureEditorWindow,
} from '../../../main/dock-capture-editor-identity';
import {
  getStrictBackendBindingForWebContents,
  onStrictBackendBindingRetired,
  stampWindowWithBackend,
} from '../../../main/window-backend';
import {
  parseWorkspaceFileRequest,
  withWorkspaceMediaBackendHint,
} from '../../../main/utils/workspace-file-url';

const logger = new Logger('DockCaptureEditor');
const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SIZE = { width: 1040, height: 720 };
const MIN_SIZE = { width: 640, height: 480 };

interface Session {
  snapshot: DockCaptureEditorSnapshot;
  backendId: string;
  /** Ends this session when the opening dock document's binding is retired. */
  stopWatching: () => void;
}

let editor: BrowserWindow | null = null;
let editorBackendId: string | null = null;
let session: Session | null = null;

function routeUrl(route: string): string {
  if (process.env.NODE_ENV === 'development')
    return `http://127.0.0.1:${process.env.DEV_PORT || '5190'}${route}`;
  return `app://workspaces${route}`;
}

const unavailable = (error = 'unavailable'): DockCaptureEditorOpenResult => ({ ok: false, error });

/** Main's own media URL for the attachment, through the workspace-file resolver. */
function mediaUrlFor(
  workspaceId: string,
  attachmentPath: string,
  backendId: string,
): string | null {
  const encoded = attachmentPath.split('/').map(encodeURIComponent).join('/');
  const raw = `workspace-file://${workspaceId}/${encoded}`;
  const parsed = parseWorkspaceFileRequest(raw);
  if (!parsed.ok || parsed.workspaceId !== workspaceId || parsed.filePath !== attachmentPath)
    return null;
  return withWorkspaceMediaBackendHint(raw, backendId);
}

function usable(window: BrowserWindow | null): window is BrowserWindow {
  return !!window && !window.isDestroyed() && !window.webContents.isDestroyed();
}

function endSession(): void {
  session?.stopWatching();
  session = null;
}

function closeEditor(): void {
  endSession();
  const window = editor;
  editor = null;
  editorBackendId = null;
  if (usable(window)) window.close();
}

function createEditorWindow(backendId: string): BrowserWindow {
  const dock = getDockWindow();
  const display = dock ? screen.getDisplayMatching(dock.getBounds()) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(DEFAULT_SIZE.width, area.width);
  const height = Math.min(DEFAULT_SIZE.height, area.height);
  const { tabbingIdentifier: _tabs, ...titleBar } = getWindowTitleBarOptions();
  const window = new BrowserWindow({
    ...getWindowAppearanceOptions(nativeTheme.shouldUseDarkColors, process.platform, false),
    ...titleBar,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
    minWidth: Math.min(MIN_SIZE.width, area.width),
    minHeight: Math.min(MIN_SIZE.height, area.height),
    show: false,
    skipTaskbar: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../../../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  registerDockCaptureEditorWindow(window);
  fixWebContentsZoom(window.webContents);
  stampWindowWithBackend(window, backendId);
  // The document is bound to its backend on dom-ready (stampWindowWithBackend's own
  // listener, registered first, runs first). A read made before that finds no
  // binding, so tell the page once it is bound; it then reads the session.
  window.webContents.on('dom-ready', () => {
    if (editor === window && usable(window))
      window.webContents.send(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED);
  });
  window.on('closed', () => {
    if (editor !== window) return;
    editor = null;
    editorBackendId = null;
    endSession();
  });
  void window.loadURL(routeUrl(DOCK_CAPTURE_EDITOR_ROUTE)).catch((error) => {
    logger.warn('Failed to load the capture editor', { error });
  });
  window.once('ready-to-show', () => {
    if (editor !== window || !session) return;
    noteDockCaptureEditorFocused();
    window.show();
    window.focus();
  });
  return window;
}

/** The dock (exact window, main frame, strict binding) asking for an editor. */
function open(event: IpcMainInvokeEvent, request: unknown): DockCaptureEditorOpenResult {
  const dock = getDockWindow();
  if (
    !dock ||
    event.sender !== dock.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame
  )
    return unavailable();
  const binding = getStrictBackendBindingForWebContents(event.sender);
  if (!binding || binding.window !== dock) return unavailable();
  const parsed = DockCaptureEditorOpenSchema.safeParse(request);
  if (!parsed.success) return unavailable('invalid');
  const { attachmentPath, ...rest } = parsed.data;
  const canonical = canonicalDockAttachmentPath(attachmentPath);
  if (!canonical) return unavailable('invalid-path');
  const mediaUrl = mediaUrlFor(rest.workspaceId, canonical, binding.backendId);
  if (!mediaUrl) return unavailable('invalid-path');

  // A window of another backend is never reused for this one.
  if (usable(editor) && editorBackendId !== binding.backendId) closeEditor();
  endSession();
  const openId = randomUUID();
  const sender = event.sender;
  const stopWatching = onStrictBackendBindingRetired(sender, () => {
    if (session?.snapshot.openId === openId) closeEditor();
  });
  // Sending does not yet apply saved edits, so nothing can be saved: an edit of a
  // known source is a preview, and a source without one opens read-only.
  const output = rest.source ? { ready: false } : undefined;
  session = {
    snapshot: { ...rest, openId, mediaUrl, ...(output ? { output } : {}) },
    backendId: binding.backendId,
    stopWatching,
  };

  if (usable(editor)) {
    // Retarget the open (stage 1: never edited) window to this attachment.
    editor.webContents.send(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED);
    if (editor.isMinimized()) editor.restore();
    noteDockCaptureEditorFocused();
    editor.show();
    editor.focus();
  } else {
    editor = createEditorWindow(binding.backendId);
    editorBackendId = binding.backendId;
  }
  return { ok: true, openId };
}

/** The editor window itself: its main frame, on its current, same-backend document. */
function fromEditor(event: IpcMainInvokeEvent): boolean {
  const window = editor;
  if (!usable(window) || event.sender !== window.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  const binding = getStrictBackendBindingForWebContents(event.sender);
  return !!binding && binding.window === window && binding.backendId === session?.backendId;
}

export function setupDockCaptureEditorIPC(): void {
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.OPEN, (event, request: unknown) => {
    try {
      return open(event, request);
    } catch (error) {
      logger.warn('Capture editor failed to open', { error });
      return unavailable('failed');
    }
  });
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.GET, (event) =>
    fromEditor(event) && session ? session.snapshot : null,
  );
  // Closes only the session the page asked about: a Cancel queued from an earlier
  // attachment never closes the one the window was retargeted to.
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.CLOSE, (event, request: unknown) => {
    const parsed = DockCaptureEditorCloseSchema.safeParse(request);
    if (!parsed.success || !fromEditor(event)) return false;
    if (session?.snapshot.openId !== parsed.data.openId) return false;
    closeEditor();
    return true;
  });
}
