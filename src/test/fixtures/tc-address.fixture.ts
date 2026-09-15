/**
 * Synthetic addresses accepted by `tailcat parse`. These contain dummy keys
 * and no live relay endpoints. Only WITH_PSK includes a dummy pre-shared key.
 * The first two are Tailcat's TestAddr fixtures:
 * https://github.com/tailscale/tailcat/blob/main/tailcat_test.go
 */
export const TC_ADDRESS_KEY_ONLY = 'tcoWFwWCAAAQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHw';
export const TC_ADDRESS_REGION = 'tcomFwWCAAAQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH2FpCg';

// CBOR {p: bytes([0xfb, 0xff] repeated 16 times), i: 10}; exercises both
// base64url punctuation characters as well as mixed-case payload bytes.
export const TC_ADDRESS = 'tcomFwWCD7__v_-__7__v_-__7__v_-__7__v_-__7__v_-__7_2FpCg';

// Same dummy public key and region, plus q: bytes("dummy-tailcat-psk" padded
// with ! to 32 bytes). Synthetic credential material for redaction tests only.
export const TC_ADDRESS_WITH_PSK =
  'tco2FwWCD7__v_-__7__v_-__7__v_-__7__v_-__7__v_-__7_2FpCmFxWCBkdW1teS10YWlsY2F0LXBzayEhISEhISEhISEhISEhIQ';
