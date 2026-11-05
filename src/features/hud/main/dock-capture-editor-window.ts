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
  DockCaptureEditorAnswerSchema,
  DockCaptureEditorOpenSchema,
  canonicalDockAttachmentPath,
  DockCaptureEditorSaveResultSchema,
  DockCaptureEditorTranscriptUpdateSchema,
  DockCaptureEditorRetakeResultSchema,
  type DockCaptureEditorRetakeOutcome,
  type DockCaptureEditorOpenResult,
  type DockCaptureEditorSaveResult,
  type DockCaptureEditorSnapshot,
} from '../../../shared/dock-capture-editor';
import {
  DockMediaEditSchema,
  DockMediaSaveRequestSchema,
  type DockMediaSaveRequest,
  type DockMediaSource,
} from '../../../shared/dock-media-edit';
import { z } from 'zod';
import {
  getWindowAppearanceOptions,
  getWindowTitleBarOptions,
} from '../../../shared/main/window-appearance';
import { fixWebContentsZoom } from '../../../main/fixed-zoom';
import { getDockWindow } from '../../../main/dock-window';
import {
  getDockMediaChoiceLocalPref,
  setDockMediaChoiceLocalPref,
} from '../../../main/local-prefs';
import { dockMediaOutputReady } from './dock-media-output';
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
  /** The opening dock document: the only one that persists this session's saves. */
  owner: { sender: Electron.WebContents; binding: object };
  /**
   * Retake candidates main placed for this session, by main's token. Never evicted
   * while the session lives (the editor's undo history can return to any of them); a
   * retake past the bound is refused before capturing.
   */
  candidates: Map<string, { source: DockMediaSource; mediaUrl: string }>;
  /** Ends this session when the opening dock document's binding is retired. */
  stopWatching: () => void;
}

/** A save sent to the owning dock, waiting for its durable result. */
interface PendingSave {
  openId: string;
  owner: Session['owner'];
  resolve: (result: DockCaptureEditorSaveResult) => void;
  timer: ReturnType<typeof setTimeout>;
}
const SAVE_TIMEOUT_MS = 15_000;
const pendingSaves = new Map<string, PendingSave>();

/** A retake sent to the owning dock, waiting for its placed candidate. */
interface PendingRetake {
  openId: string;
  owner: Session['owner'];
  resolve: (result: DockCaptureEditorRetakeOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}
/** A selection can take a while; past this the retake fails (the editor comes back). */
const RETAKE_TIMEOUT_MS = 120_000;
const MAX_CANDIDATES = 4;
const pendingRetakes = new Map<string, PendingRetake>();
function settleRetake(requestId: string, result: DockCaptureEditorRetakeOutcome): void {
  const pending = pendingRetakes.get(requestId);
  if (!pending) return;
  pendingRetakes.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
}

/** The editor's save: its draft edit (and, after a retake, the candidate's token). */
const EditorSaveSchema = z
  .object({
    openId: z.string().uuid(),
    edit: DockMediaEditSchema,
    replacement: z
      .object({ candidateToken: z.string().min(1).max(512) })
      .strict()
      .optional(),
  })
  .strict();

function settleSave(requestId: string, result: DockCaptureEditorSaveResult): void {
  const pending = pendingSaves.get(requestId);
  if (!pending) return;
  pendingSaves.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
}

/**
 * What waits for the editor's answer: closing the window, or opening another source.
 * Only the editor knows whether it has unsaved edits, so it is asked every time; it
 * answers Discard at once when it has none. `requestId` ties the answer to this ask.
 */
type Pending = { requestId: string } & ({ kind: 'close' } | { kind: 'retarget'; next: Session });

let editor: BrowserWindow | null = null;
let editorBackendId: string | null = null;
let session: Session | null = null;
let pending: Pending | null = null;
/** Set while main itself closes the window (after Discard, or with nothing to lose). */
let closingAllowed = false;
/**
 * Every open admitted so far. An open that awaited (readiness, preferences) goes on
 * only if no newer open started, and the editor was not closed or its owner retired
 * meanwhile: those bump it too.
 */
let openGeneration = 0;

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

function dropPending(): void {
  if (pending?.kind === 'retarget') pending.next.stopWatching();
  pending = null;
}

function endSession(): void {
  const ended = session;
  ended?.stopWatching();
  session = null;
  // Its saves can no longer reach the editor: they end as failed (the dock may still
  // finish writing; nothing here claims they were cancelled).
  if (ended) {
    for (const [requestId, pending] of pendingSaves)
      if (pending.openId === ended.snapshot.openId)
        settleSave(requestId, { requestId, result: 'failed' });
    for (const [requestId, pending] of pendingRetakes)
      if (pending.openId === ended.snapshot.openId)
        settleRetake(requestId, { ok: false, error: 'failed' });
  }
}

function closeEditor(): void {
  openGeneration += 1;
  dropPending();
  endSession();
  const window = editor;
  editor = null;
  editorBackendId = null;
  if (!usable(window)) return;
  closingAllowed = true;
  try {
    window.close();
  } finally {
    closingAllowed = false;
  }
}

/**
 * Ask the editor before `next` happens. A close asked while a question is open keeps
 * that question; a newer switch replaces it under a new request id, so an answer to
 * the earlier one does nothing.
 */
function askDiscard(next: { kind: 'close' } | { kind: 'retarget'; next: Session }): void {
  if (pending && next.kind === 'close') return;
  if (!usable(editor) || !session) {
    if (next.kind === 'retarget') showSession(next.next);
    else closeEditor();
    return;
  }
  dropPending();
  const requestId = randomUUID();
  pending = { ...next, requestId };
  editor.webContents.send(DOCK_CAPTURE_EDITOR_CHANNELS.CONFIRM_DISCARD, {
    openId: session.snapshot.openId,
    requestId,
  });
}

/** Show `next` in the editor: in the open window when it is the same backend's. */
function showSession(next: Session): void {
  if (usable(editor) && editorBackendId !== next.backendId) closeEditor();
  dropPending();
  endSession();
  session = next;
  if (usable(editor)) {
    editor.webContents.send(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED);
    if (editor.isMinimized()) editor.restore();
    noteDockCaptureEditorFocused();
    editor.show();
    editor.focus();
  } else {
    editor = createEditorWindow(next.backendId);
    editorBackendId = next.backendId;
  }
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
  // The window's own close (its button, Cmd+W) asks the editor first; it closes at
  // once without unsaved edits. A document that is gone has nothing to ask.
  window.on('close', (event) => {
    if (closingAllowed || editor !== window || !session || window.webContents.isCrashed()) return;
    event.preventDefault();
    askDiscard({ kind: 'close' });
  });
  window.on('closed', () => {
    if (editor !== window) return;
    // Closed by the person: an open still awaiting must not reopen it.
    openGeneration += 1;
    dropPending();
    editor = null;
    editorBackendId = null;
    endSession();
  });
  void window.loadURL(routeUrl(DOCK_CAPTURE_EDITOR_ROUTE)).catch((error) => {
    logger.warn('Failed to load the capture editor', { error });
  });
  // Shown once the page has read its session (so never as a blank window while it
  // loads), or after a bound wait if it never does.
  const fallback = setTimeout(() => revealEditor(window), REVEAL_FALLBACK_MS);
  window.once('closed', () => clearTimeout(fallback));
  return window;
}

const REVEAL_FALLBACK_MS = 8000;

/** Show and focus a not-yet-shown editor (its first reveal, at the dock's request). */
function revealEditor(window: BrowserWindow): void {
  if (editor !== window || !usable(window) || !session || window.isVisible()) return;
  noteDockCaptureEditorFocused();
  window.show();
  window.focus();
}

/** The dock (exact window, main frame, strict binding) asking for an editor. */
async function open(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<DockCaptureEditorOpenResult> {
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

  const generation = ++openGeneration;
  // Whether sending honors saved edits of this source (asked of the output owner),
  // and the person's last saved choice, the default for a new edit.
  const [output, rememberedChoice] = await Promise.all([
    rest.source
      ? dockMediaOutputReady(rest.source, rest.saved ?? null).catch(() => ({ ready: false }))
      : Promise.resolve(undefined),
    rest.kind === 'recording'
      ? getDockMediaChoiceLocalPref().catch(() => null)
      : Promise.resolve(null),
  ]);
  // Nothing may have changed meanwhile: no newer open or close, and the same dock
  // window, document and binding.
  if (
    generation !== openGeneration ||
    getDockWindow() !== dock ||
    event.sender.isDestroyed() ||
    event.sender.mainFrame !== event.senderFrame ||
    getStrictBackendBindingForWebContents(event.sender) !== binding
  )
    return unavailable();

  const openId = randomUUID();
  // Its owner gone (the dock's document or binding retired), a session ends: as the
  // current one, the editor closes; as a pending one, it is dropped.
  const stopWatching = onStrictBackendBindingRetired(event.sender, () => {
    if (session?.snapshot.openId === openId) closeEditor();
    else if (pending?.kind === 'retarget' && pending.next.snapshot.openId === openId) dropPending();
  });
  // A source without a canonical description opens read-only (no output at all).
  const next: Session = {
    snapshot: {
      ...rest,
      openId,
      mediaUrl,
      ...(output ? { output } : {}),
      ...(rememberedChoice ? { rememberedChoice } : {}),
    },
    backendId: binding.backendId,
    owner: { sender: event.sender, binding },
    candidates: new Map(),
    stopWatching,
  };
  // An open session is never replaced silently: the editor is asked (it answers at
  // once when it has no unsaved edits), and this opens on Discard.
  if (usable(editor) && session) askDiscard({ kind: 'retarget', next });
  else showSession(next);
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
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.GET, (event) => {
    if (!fromEditor(event) || !session) return null;
    // The page has loaded and is about to draw this session: show the window now.
    if (editor) setTimeout(() => editor && revealEditor(editor), 0);
    return session.snapshot;
  });
  // Closes only the session the page asked about: a Cancel queued from an earlier
  // attachment never closes the one the window was retargeted to.
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.CLOSE, (event, request: unknown) => {
    const parsed = DockCaptureEditorCloseSchema.safeParse(request);
    if (!parsed.success || !fromEditor(event)) return false;
    if (session?.snapshot.openId !== parsed.data.openId) return false;
    closeEditor();
    return true;
  });
  // The person's answer to main's question: Discard does what was waiting.
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.DISCARD, (event, request: unknown) => {
    const parsed = DockCaptureEditorAnswerSchema.safeParse(request);
    if (!parsed.success || !fromEditor(event) || !session || !pending) return false;
    if (session.snapshot.openId !== parsed.data.openId) return false;
    if (pending.requestId !== parsed.data.requestId) return false;
    const waiting = pending;
    pending = null;
    if (waiting.kind === 'close') closeEditor();
    else showSession(waiting.next);
    return true;
  });
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.KEEP, (event, request: unknown) => {
    const parsed = DockCaptureEditorAnswerSchema.safeParse(request);
    if (!parsed.success || !fromEditor(event) || !session || !pending) return false;
    if (session.snapshot.openId !== parsed.data.openId) return false;
    if (pending.requestId !== parsed.data.requestId) return false;
    dropPending();
    return true;
  });
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.RETAKE, (event, request: unknown) =>
    retake(event, request),
  );
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.RETAKE_RESULT, (event, value: unknown) => {
    const parsed = DockCaptureEditorRetakeResultSchema.safeParse(value);
    if (!parsed.success) return false;
    const pending = pendingRetakes.get(parsed.data.requestId);
    if (!pending || event.sender !== pending.owner.sender) return false;
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    if (getStrictBackendBindingForWebContents(event.sender) !== pending.owner.binding) return false;
    const current = session;
    if (!parsed.data.ok || !current || current.snapshot.openId !== pending.openId) {
      settleRetake(parsed.data.requestId, {
        ok: false,
        error: parsed.data.ok ? 'failed' : parsed.data.error,
      });
      return true;
    }
    const candidate = parsed.data.source;
    const path = canonicalDockAttachmentPath(candidate.path);
    const mediaUrl = path
      ? mediaUrlFor(current.snapshot.workspaceId, path, current.backendId)
      : null;
    if (candidate.kind !== 'screenshot' || !mediaUrl) {
      settleRetake(parsed.data.requestId, { ok: false, error: 'failed' });
      return true;
    }
    // Main's token for this candidate; the oldest goes once there are a few.
    const candidateToken = randomUUID();
    current.candidates.set(candidateToken, { source: candidate, mediaUrl });
    settleRetake(parsed.data.requestId, { ok: true, candidateToken, source: candidate, mediaUrl });
    return true;
  });
  // A newer transcript of the open session's source, from the dock that opened it.
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.TRANSCRIPT_UPDATE, (event, value: unknown) => {
    const parsed = DockCaptureEditorTranscriptUpdateSchema.safeParse(value);
    const current = session;
    if (!parsed.success || !current?.snapshot.source) return false;
    const { owner, snapshot } = current;
    const source = snapshot.source;
    if (!source) return false;
    if (event.sender !== owner.sender) return false;
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    if (getStrictBackendBindingForWebContents(event.sender) !== owner.binding) return false;
    const update = parsed.data;
    if (
      update.pair.workspaceId !== snapshot.workspaceId ||
      update.pair.agentId !== snapshot.agentId ||
      update.sourceId !== source.id ||
      update.sourceRevision !== source.revision
    )
      return false;
    if (snapshot.transcript && update.transcript.revision <= snapshot.transcript.revision)
      return false;
    current.snapshot = { ...snapshot, transcript: update.transcript };
    if (usable(editor)) editor.webContents.send(DOCK_CAPTURE_EDITOR_CHANNELS.CHANGED);
    return true;
  });
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.SAVE, (event, request: unknown) =>
    save(event, request),
  );
  // The owning dock's durable result, for a save main sent it.
  ipcMain.handle(DOCK_CAPTURE_EDITOR_CHANNELS.SAVE_RESULT, (event, value: unknown) => {
    const parsed = DockCaptureEditorSaveResultSchema.safeParse(value);
    if (!parsed.success) return false;
    const pending = pendingSaves.get(parsed.data.requestId);
    if (!pending || event.sender !== pending.owner.sender) return false;
    // The dock document itself, never one of its child frames.
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    if (getStrictBackendBindingForWebContents(event.sender) !== pending.owner.binding) return false;
    settleSave(parsed.data.requestId, parsed.data);
    return true;
  });
}

/**
 * A save from the editor: only when sending honors saved edits of this source, only
 * for this session's own source and pair, and only through the dock document that
 * opened it. The expected revision is the session's saved one (an edit's own
 * revision never moves the compare-and-set baseline); the outcome is the dock's
 * durable result, or failed when it does not answer in time.
 */
async function save(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<DockCaptureEditorSaveResult> {
  const failed = (requestId = randomUUID()): DockCaptureEditorSaveResult => ({
    requestId,
    result: 'failed',
  });
  const parsed = EditorSaveSchema.safeParse(request);
  if (!parsed.success || !fromEditor(event) || !session) return failed();
  const current = session;
  const { snapshot, owner } = current;
  if (snapshot.openId !== parsed.data.openId || !snapshot.source) return failed();
  if (snapshot.output?.ready !== true) return failed();
  // After a retake, the candidate is main's own (by token), never the editor's word.
  const token = parsed.data.replacement?.candidateToken;
  const stored = token ? current.candidates.get(token) : undefined;
  const candidate = stored?.source;
  if (token && !stored) return failed();
  const target = candidate ?? snapshot.source;
  if (
    parsed.data.edit.sourceId !== target.id ||
    parsed.data.edit.sourceRevision !== target.revision
  )
    return failed();
  if (owner.sender.isDestroyed()) return failed();
  if (getStrictBackendBindingForWebContents(owner.sender) !== owner.binding) return failed();
  const expectedEditRevision = snapshot.saved?.revision ?? 0;
  const canonical: DockMediaSaveRequest = {
    openId: snapshot.openId,
    sourceId: snapshot.source.id,
    sourceRevision: snapshot.source.revision,
    pair: { workspaceId: snapshot.workspaceId, agentId: snapshot.agentId },
    expectedEditRevision,
    edit: { ...parsed.data.edit, revision: expectedEditRevision },
    ...(candidate && token ? { replacement: { candidateToken: token, source: candidate } } : {}),
  };
  if (!DockMediaSaveRequestSchema.safeParse(canonical).success) return failed();
  const requestId = randomUUID();
  const result = await new Promise<DockCaptureEditorSaveResult>((resolve) => {
    pendingSaves.set(requestId, {
      openId: snapshot.openId,
      owner,
      resolve,
      timer: setTimeout(() => settleSave(requestId, failed(requestId)), SAVE_TIMEOUT_MS),
    });
    owner.sender.send(DOCK_CAPTURE_EDITOR_CHANNELS.SAVE_REQUESTED, {
      requestId,
      request: canonical,
    });
  });
  // The stored edit becomes this session's baseline (only if it is still this session).
  // The person's last saved choice becomes the default for the next recording.
  if (result.result === 'saved' && result.saved?.kind === 'recording')
    void setDockMediaChoiceLocalPref({
      video: result.saved.video,
      voice: result.saved.voice,
    }).catch((error: unknown) =>
      logger.warn('Could not remember the capture send choice', { error }),
    );
  if (result.result === 'saved' && result.saved && session === current) {
    current.snapshot = {
      ...current.snapshot,
      saved: result.saved,
      // The replacement is the session's source now: its file, size and URL too.
      ...(candidate && stored
        ? {
            source: candidate,
            mediaUrl: stored.mediaUrl,
            attachmentId: candidate.attachmentId,
            width: candidate.width,
            height: candidate.height,
            provenance: { ...current.snapshot.provenance, visuals: candidate.visuals },
          }
        : {}),
    };
    if (candidate) current.candidates.clear();
  }
  return result;
}

/**
 * Retake (screenshot): main hides the editor and asks the dock that opened it to
 * capture again in the same mode and place the result as a new file. The attachment
 * does not change; the editor gets main's token for the candidate, and Save swaps it
 * in. The editor comes back however it ends.
 */
async function retake(
  event: IpcMainInvokeEvent,
  request: unknown,
): Promise<DockCaptureEditorRetakeOutcome> {
  const parsed = DockCaptureEditorCloseSchema.safeParse(request);
  if (!parsed.success || !fromEditor(event) || !session) return { ok: false, error: 'failed' };
  const current = session;
  const { snapshot, owner } = current;
  const window = editor;
  if (snapshot.openId !== parsed.data.openId || snapshot.kind !== 'screenshot' || !snapshot.source)
    return { ok: false, error: 'failed' };
  if (current.candidates.size >= MAX_CANDIDATES) return { ok: false, error: 'failed' };
  if (owner.sender.isDestroyed()) return { ok: false, error: 'failed' };
  if (getStrictBackendBindingForWebContents(owner.sender) !== owner.binding)
    return { ok: false, error: 'failed' };
  const requestId = randomUUID();
  window?.hide();
  try {
    return await new Promise<DockCaptureEditorRetakeOutcome>((resolve) => {
      pendingRetakes.set(requestId, {
        openId: snapshot.openId,
        owner,
        resolve,
        timer: setTimeout(
          () => settleRetake(requestId, { ok: false, error: 'failed' }),
          RETAKE_TIMEOUT_MS,
        ),
      });
      owner.sender.send(DOCK_CAPTURE_EDITOR_CHANNELS.RETAKE_REQUESTED, {
        requestId,
        pair: { workspaceId: snapshot.workspaceId, agentId: snapshot.agentId },
        expected: { sourceId: snapshot.source!.id, sourceRevision: snapshot.source!.revision },
      });
    });
  } finally {
    if (window && editor === window && usable(window)) {
      noteDockCaptureEditorFocused();
      window.show();
      window.focus();
    }
  }
}
