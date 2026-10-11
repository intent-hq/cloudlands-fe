export type VideoSource =
  | { kind: 'inline'; data: string; mimeType: string }
  | { kind: 'remote'; url: string; mimeType?: string }
  | { kind: 'workspace'; url: string; mimeType: 'video/mp4' | 'video/webm' };
