import type { BrowserCaptureRect } from './element-picker-coordinates';

export type EmbeddedBrowserWebview = HTMLElement & {
  src: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  loadURL: (url: string) => Promise<void>;
  executeJavaScript: (code: string) => Promise<unknown>;
  addEventListener: (event: string, handler: (event: any) => void) => void;
  removeEventListener?: (event: string, handler: (event: any) => void) => void;
  openDevTools: () => void;
  closeDevTools: () => void;
  isDevToolsOpened: () => boolean;
  getURL?: () => string;
  getWebContentsId: () => number;
  getZoomLevel: () => number;
  setZoomLevel: (level: number) => void;
  getZoomFactor: () => number;
  setZoomFactor: (factor: number) => void;
  setAudioMuted?: (muted: boolean) => void;
  reloadIgnoringCache?: () => void;
  capturePage?: (rect?: BrowserCaptureRect) => Promise<{ toDataURL: () => string }>;
};
