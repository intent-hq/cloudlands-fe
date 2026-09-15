/**
 * Non-secret addresses accepted by `tailcat parse`. These contain only dummy
 * public keys, with no pre-shared keys or live relay endpoints.
 * The first two are Tailcat's TestAddr fixtures:
 * https://github.com/tailscale/tailcat/blob/main/tailcat_test.go
 */
export const TC_ADDRESS_KEY_ONLY = 'tcoWFwWCAAAQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHw';
export const TC_ADDRESS_REGION = 'tcomFwWCAAAQIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH2FpCg';

// CBOR {p: bytes([0xfb, 0xff] repeated 16 times), i: 10}; exercises both
// base64url punctuation characters as well as mixed-case payload bytes.
export const TC_ADDRESS = 'tcomFwWCD7__v_-__7__v_-__7__v_-__7__v_-__7__v_-__7_2FpCg';
