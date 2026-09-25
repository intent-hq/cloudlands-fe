type WebSocketApiStatusSnapshot = {
  enabled: boolean;
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

export type WebSocketApiIntent =
  | { kind: 'load'; connectionId: string }
  | { kind: 'toggle'; enabled: boolean; connectionId: string }
  | { kind: 'port'; port: number; connectionId: string }
  | { kind: 'listen'; ips: string[]; tunnel: boolean; connectionId: string }
  | { kind: 'tunnel'; connectionId: string }
  | { kind: 'rotate'; connectionId: string }
  | { kind: 'publish'; connectionId: string }
  | { kind: 'copy'; target: 'token' | 'fingerprint' | 'tc' | 'share'; connectionId: string }
  | { kind: 'qr'; connectionId: string }
  | { kind: 'closeQr'; connectionId: string };

export type WebSocketApiSnapshot = {
  enabled: boolean;
  persistedPort: number;
  port: number | null;
  certFingerprint: string;
  localIps: string[];
  availableIps: string[] | null;
  bindIps: string[];
  bindAddressSupported: boolean;
  tunnelEnabled: boolean;
  tunnelOnly: boolean;
  tunnelSupported: boolean;
  tcAddress: string;
};
