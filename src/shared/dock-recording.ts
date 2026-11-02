/**
 * Dock clip recording DTOs shared by the main-process recorder
 * (features/hud/main/dock-screen-recorder.ts) and the dock evidence session.
 *
 * The recorder is the native ScreenCaptureKit helper `intent-dock-recorder`
 * (resources/dock/screen-recorder.swift). JSON-serializable only.
 */
import type { DockClipFile, DockMarkGeometry, DockMarkTool } from './dock-evidence';
import { DOCK_EVIDENCE_LIMITS } from './dock-evidence';

/** Bumped whenever the helper's wire protocol or capture backend changes. */
export const DOCK_RECORDING_CAPTURE_API = 'sck-stream+avcapture-mic/1';
export const DOCK_RECORDING_MAX_MS = DOCK_EVIDENCE_LIMITS.clipMs;
export const DOCK_RECORDING_MAX_FPS = 30;
/**
 * Largest clip the app can play back: the workspace-file protocol refuses media beyond
 * this (`WORKSPACE_FILE_MAX_BYTES` in main/protocol-handlers.ts; a test pins them equal).
 */
export const DOCK_RECORDING_MAX_BYTES = 128 * 1024 * 1024;
/** The helper ends the clip ('size-limit') once the file reaches this share of the cap. */
export const DOCK_RECORDING_SIZE_STOP_RATIO = 0.9;
/**
 * Encoder ceiling (the helper scales H.264 with pixels × fps at 0.05 bit/pixel, at least
 * 3 Mb/s, capped here) plus AAC mono. A full 120 s clip at these rates is ≈ 106 MB, below
 * the size stop, so the stop only fires on encoder overshoot.
 */
export const DOCK_RECORDING_VIDEO_BITRATE = 7_000_000;
export const DOCK_RECORDING_AUDIO_BITRATE = 96_000;
/** Source pixels are kept up to this long edge (H.264 High limit), scaled beyond. */
export const DOCK_RECORDING_MAX_EDGE = 4096;

type DockRecordingUnsupportedReason = 'platform' | 'os-version' | 'helper-missing';

export type DockRecordingCapability =
  | {
      supported: true;
      micSupported: boolean;
      /** SCScreenshotManager still capture with exclusions (macOS 14+). */
      stillSupported: boolean;
      captureApi: string;
      osVersion: string;
      /** CGPreflightScreenCaptureAccess at query time; never prompts. */
      screenPermission: boolean;
      micPermission: 'authorized' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
    }
  | { supported: false; reason: DockRecordingUnsupportedReason; detail?: string };

/** One authoritative mark burned into the clip, in pixels of the image it was made on. */
export interface DockRecordingMark {
  n: number;
  tool: DockMarkTool;
  geometry: DockMarkGeometry;
  imageWidth: number;
  imageHeight: number;
}

export interface DockRecordingStartRequest {
  clipId: string;
  /** Electron `Display.id`, which is the CGDirectDisplayID on macOS. */
  displayId: number;
  /** CGWindowIDs to keep out of the clip: the dock and every visible control/overlay. */
  excludeWindowIds: number[];
  /** Open the microphone from the first frame (dictation already live). */
  includeMic: boolean;
  /** Clamped to `DOCK_RECORDING_MAX_MS`. */
  maxMs?: number;
  /** Directory the helper writes `<clipId>.mp4` into. */
  outputDir: string;
}

/** Still capture of the dock's display with the given windows excluded. */
export interface DockStillRequest {
  displayId: number;
  excludeWindowIds: number[];
}

export type DockRecordingEndReason = 'stopped' | 'limit' | 'size-limit' | 'interrupted';

export interface DockRecordedClip extends DockClipFile {
  clipId: string;
  /** Epoch ms when the first frame was written. */
  startedAt: number;
  endedReason: DockRecordingEndReason;
  captureApi: string;
}
