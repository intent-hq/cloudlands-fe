export type WebSocketApiStatusSnapshot = {
  enabled: boolean;
  token: string;
  port: number | null;
  discoveryEnabled: boolean;
  discoveryExpiresAt: number | null;
  localIps: string[];
  certFingerprint: string;
};

export type WebSocketApiState = WebSocketApiStatusSnapshot & {
  loading: boolean;
  regenerating: boolean;
  error: string | null;
  discoveryCountdownNow: number | null;
};
