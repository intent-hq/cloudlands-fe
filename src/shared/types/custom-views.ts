export const customViewIcons = ['globe', 'code', 'chart', 'book', 'terminal', 'grid'] as const;
export type CustomViewIcon = (typeof customViewIcons)[number];

export interface CustomViewInput {
  id?: string;
  name: string;
  directory: string;
  command: string;
  port: number;
  icon: CustomViewIcon;
}

export interface CustomView extends CustomViewInput {
  id: string;
}

export type CustomViewErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'port-in-use'
  | 'directory-unavailable'
  | 'start-failed'
  | 'server-exited'
  | 'startup-timeout'
  | 'storage-failed'
  | 'desktop-only';

export interface CustomViewRuntime {
  id: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  external?: boolean;
  url?: string;
  errorCode?: CustomViewErrorCode;
  logs: string;
}

export interface CustomViewsSnapshot {
  views: CustomView[];
  runtimes: CustomViewRuntime[];
}

export type CustomViewsResponse =
  | { success: true; data: CustomViewsSnapshot }
  | { success: false; error: { code: CustomViewErrorCode; message: string } };

export const customViewsChannels = {
  list: 'custom-views:list',
  save: 'custom-views:save',
  remove: 'custom-views:remove',
  start: 'custom-views:start',
  stop: 'custom-views:stop',
} as const;
