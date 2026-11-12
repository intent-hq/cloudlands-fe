/**
 * Output fixtures modelled on the real `intentd pair` / `intentd pair --node`
 * printers (`cmd_pair` / `cmd_pair_node` in intentd's main.rs) and the
 * installer's `info` lines and link marker (intentd `scripts/install.sh`).
 */

export const PAIR_TOKEN = 'itk_0f9e8d7c6b5a49382716abcdefSECRET';
export const PAIR_FINGERPRINT = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
export const PAIR_URI = `intent://pair?v=1&h=10.0.0.5&p=7443&fp=ABCDEF0123456789&t=${PAIR_TOKEN}&tc=k3x9.tailcat.net:443`;
export const NODE_SECRET = 'nsec_77aa88bb99ccSECRET';
export const NODE_URI = `intent://node?v=1&h=10.0.0.5&p=7443&fp=ABCDEF0123456789&id=inv_1&s=${NODE_SECRET}&tc=k3x9.tailcat.net:443`;

/** A few rows of a Dense1x2 QR code with its quiet zone. */
const QR = [
  '█████████████████████████████████',
  '██ ▄▄▄▄▄ █▀▄▀ ▄█▄▀▀▄▄█ ▄▄▄▄▄ ██',
  '██ █   █ █▄ ▀▄▀▀▄ █▀▄█ █   █ ██',
  '██ █▄▄▄█ █ ▄▀█ ▄ ▀▄▀ █ █▄▄▄█ ██',
  '██▄▄▄▄▄▄▄█▄▀ █▄█▄█ █▄█▄▄▄▄▄▄▄██',
  '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀',
];

/** `intentd pair --yes --tunnel` (full daemon). */
export const PAIR_OUTPUT = [
  ...QR,
  '',
  '  Scan with the Intent iOS app to pair this device automatically.',
  '',
  `URL:         ${PAIR_URI}`,
  "             Same payload as the QR code — paste it into a client that can't scan.",
  'Host:        10.0.0.5',
  'Port:        7443',
  "             Host and port to enter in the desktop app's remote-connection dialog.",
  `Token:       ${PAIR_TOKEN}`,
  "             Bearer token — enter it (with host + port) in the desktop app's remote-connection dialog.",
  `Fingerprint: ${PAIR_FINGERPRINT}`,
  '             TLS certificate fingerprint — confirm the client shows this exact value before trusting the connection.',
  'Tunnel:      k3x9.tailcat.net:443',
  '             Tailcat tunnel address — reachable from other networks; embedded in the QR payload as tc=.',
  '',
].join('\n');

/** `intentd pair --node --tunnel --yes`. */
export const PAIR_NODE_OUTPUT = [
  ...QR,
  '',
  '  Open this link in Intent on the computer that should run agents here.',
  '',
  `URL:         ${NODE_URI}`,
  '             Same link as the QR code — it lets one backend run agents on this machine, nothing else.',
  '',
  'This link works once and expires at 2026-11-13T05:00:00Z. Run `intentd pair --node` to make another.',
  '',
].join('\n');

/** The installer with `INTENTD_LINK_MARKER=1` (full daemon, Linux). */
export function installerOutput(
  uri: string | null,
  extra: { node?: boolean; withPairOutput?: boolean } = {},
): string {
  return [
    'install.sh: downloading intentd 0.42.0 (linux-x86_64)...',
    'install.sh: installed /home/dev/.local/bin/intentd',
    'install.sh: waiting for the daemon to respond (first start downloads the daemon binary)...',
    extra.node
      ? 'install.sh: node mode on — pair this computer with the Intent that will run agents here'
      : 'install.sh: pairing — the link below adds this computer to the Intent desktop app',
    ...(extra.withPairOutput ? [PAIR_OUTPUT] : []),
    ...(uri ? [`INTENT_LINK=${uri}`] : []),
    'install.sh: done',
    '',
  ].join('\n');
}

/** Split text into chunks of `size` bytes, cutting lines and characters. */
export function chunked(text: string, size: number): Buffer[] {
  const bytes = Buffer.from(text, 'utf8');
  const chunks: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.subarray(at, at + size));
  return chunks;
}
