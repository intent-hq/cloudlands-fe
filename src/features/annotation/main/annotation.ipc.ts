import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { ANNOTATION_CHANNELS } from '../../../shared/ipc/channels';
import { ANNOTATION_TOOLS } from '../../../shared/annotation';
import type { AnnotationStartFailureCode, AnnotationStartResult } from '../../../shared/annotation';
import { getDockWindow } from '../../../main/dock-window';
import { m } from '../../../shared/paraglide/messages.js';
import {
  appendAnnotationTranscript,
  closeAnnotationMode,
  getAnnotationState,
  isAnnotationWindow,
  isAnnotationOverlayWindow,
  setAnnotationDestination,
  requestAnnotationSend,
  reportAnnotationDelivery,
  setAnnotationToolbarLayout,
  reviewAnnotation,
  setAnnotationTool,
  startAnnotationMode,
} from './annotation-window';

const StartSchema = z.object({
  workspaceId: z.string().trim().min(1),
  workspaceTitle: z.string().trim().min(1),
});
const ToolSchema = z.object({ tool: z.enum(ANNOTATION_TOOLS) });
const TranscriptSchema = z.object({
  text: z.string().trim().min(1),
  startedAt: z.number().finite().nonnegative().optional(),
});
const EmptySchema = z.object({}).passthrough();
const SessionIdentitySchema = z.object({ startedAt: z.number().finite().nonnegative() });
const SendRequestSchema = SessionIdentitySchema.extend({
  retryRequestId: z.string().uuid().optional(),
});
const ToolbarLayoutSchema = SessionIdentitySchema.extend({
  expanded: z.boolean(),
  interactiveRects: z
    .array(
      z.object({
        x: z.number().finite().min(0).max(1200),
        y: z.number().finite().min(0).max(1200),
        width: z.number().finite().min(0).max(1200),
        height: z.number().finite().min(0).max(1200),
      }),
    )
    .max(16),
});
const DestinationSchema = SessionIdentitySchema.extend({
  destination: z.object({
    workspaceId: z.string().trim().min(1),
    workspaceTitle: z.string().trim().min(1),
    agentId: z.string().trim().min(1).nullable(),
  }),
});
const DeliveryReportSchema = SessionIdentitySchema.extend({
  requestId: z.string().uuid(),
  status: z.enum(['failed', 'uncertain', 'sent']),
  error: z.string().max(2000).optional(),
});
const SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
const INVALID_SENDER_CODE: AnnotationStartFailureCode = 'invalid-sender';

function senderIsAnnotationWindow(sender: Electron.WebContents): boolean {
  return isAnnotationWindow(BrowserWindow.fromWebContents(sender));
}

async function showStartFailure(result: Extract<AnnotationStartResult, { success: false }>) {
  if (result.code === 'session-replaced') return;
  const dock = getDockWindow();
  const parent = dock && !dock.isDestroyed() ? dock : undefined;
  if (result.code === 'screen-capture-permission-denied' && process.platform === 'darwin') {
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      title: m.annotation_startPermission_title(),
      message: m.annotation_startPermission_description({ appName: app.getName() }),
      buttons: [
        m.annotation_startPermission_openSettings_label(),
        m.annotation_startPermission_cancel_label(),
      ],
      defaultId: 0,
      cancelId: 1,
    };
    const response = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response.response === 0) {
      try {
        await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL);
      } catch {
        dialog.showErrorBox(
          m.annotation_startFailed_title(),
          m.annotation_startFailed_description(),
        );
      }
    }
    return;
  }

  const options: Electron.MessageBoxOptions = {
    type: 'error',
    title: m.annotation_startFailed_title(),
    message: m.annotation_startFailed_description(),
    detail: result.error,
  };
  if (parent) await dialog.showMessageBox(parent, options);
  else await dialog.showMessageBox(options);
}

export function setupAnnotationIPC(): void {
  ipcMain.handle(
    ANNOTATION_CHANNELS.SET_TOOLBAR_LAYOUT,
    createSafeValidatedHandler(
      ToolbarLayoutSchema,
      async (event, request) => ({
        success: setAnnotationToolbarLayout(BrowserWindow.fromWebContents(event.sender), request),
      }),
      ANNOTATION_CHANNELS.SET_TOOLBAR_LAYOUT,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.SET_DESTINATION,
    createSafeValidatedHandler(
      DestinationSchema,
      async (event, request) => ({
        success: senderIsAnnotationWindow(event.sender) && setAnnotationDestination(request),
      }),
      ANNOTATION_CHANNELS.SET_DESTINATION,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.REQUEST_SEND,
    createSafeValidatedHandler(
      SendRequestSchema,
      async (event, request) => ({
        success: senderIsAnnotationWindow(event.sender) && (await requestAnnotationSend(request)),
      }),
      ANNOTATION_CHANNELS.REQUEST_SEND,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.REPORT_DELIVERY,
    createSafeValidatedHandler(
      DeliveryReportSchema,
      async (event, request) => ({
        success:
          isAnnotationOverlayWindow(BrowserWindow.fromWebContents(event.sender)) &&
          reportAnnotationDelivery(request),
      }),
      ANNOTATION_CHANNELS.REPORT_DELIVERY,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.START,
    createSafeValidatedHandler(
      StartSchema,
      async (event, request) => {
        if (BrowserWindow.fromWebContents(event.sender) !== getDockWindow()) {
          return {
            success: false,
            code: INVALID_SENDER_CODE,
            error: 'Use a workspace right-click in the dock to start annotation mode.',
          } satisfies AnnotationStartResult;
        }
        const result = await startAnnotationMode(request);
        if (!result.success) await showStartFailure(result);
        return result;
      },
      ANNOTATION_CHANNELS.START,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.GET_STATE,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        if (!senderIsAnnotationWindow(event.sender)) return { success: false };
        const state = getAnnotationState();
        return state ? { success: true, state } : { success: false };
      },
      ANNOTATION_CHANNELS.GET_STATE,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.SET_TOOL,
    createSafeValidatedHandler(
      ToolSchema,
      async (event, { tool }) => ({
        success: senderIsAnnotationWindow(event.sender) && (await setAnnotationTool(tool)),
      }),
      ANNOTATION_CHANNELS.SET_TOOL,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.ADD_TRANSCRIPT,
    createSafeValidatedHandler(
      TranscriptSchema,
      async (event, { text, startedAt }) => ({
        success:
          senderIsAnnotationWindow(event.sender) && appendAnnotationTranscript(text, startedAt),
      }),
      ANNOTATION_CHANNELS.ADD_TRANSCRIPT,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.REVIEW,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => ({
        success: senderIsAnnotationWindow(event.sender) && (await reviewAnnotation()),
      }),
      ANNOTATION_CHANNELS.REVIEW,
    ),
  );
  ipcMain.handle(
    ANNOTATION_CHANNELS.CLOSE,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        if (!senderIsAnnotationWindow(event.sender)) return { success: false };
        closeAnnotationMode();
        return { success: true };
      },
      ANNOTATION_CHANNELS.CLOSE,
    ),
  );
}
