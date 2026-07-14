/**
 * Live server domain backed by the intentd daemon.
 *
 * Exposes `server.pairingInfo` and `server.rotateToken` RPCs for WebSocket API
 * pairing. Both methods are **local-only** (UDS) — the daemon returns JSON-RPC
 * error -32001 when called over a remote transport. The desktop app talks over
 * UDS so this shouldn't occur, but the client propagates the error rather than
 * swallowing it.
 *
 * `pairingInfo` returns the full pairing credentials including token, TLS cert
 * fingerprint, port, and local network addresses for QR code generation.
 *
 * `rotateToken` mints a new 64-hex token and persists it. When INTENTD_AUTH_TOKEN
 * env var pins the token, the daemon rejects rotation with InvalidParams error.
 */
import type { AppClient, ServerClient, ServerPairingInfo } from "../app-client";
import { backendRequest } from "./backend-transport";

export class LiveServerClient implements ServerClient {
  async pairingInfo(): Promise<ServerPairingInfo> {
    const result = await backendRequest<{
      token?: string;
      certFingerprint?: string;
      port?: number | null;
      path?: string;
      localIps?: string[];
      hostname?: string;
    }>("server.pairingInfo");

    // Validate required fields
    if (
      typeof result?.token !== "string" ||
      typeof result?.certFingerprint !== "string" ||
      typeof result?.path !== "string" ||
      !Array.isArray(result?.localIps) ||
      typeof result?.hostname !== "string"
    ) {
      throw new Error("Invalid server.pairingInfo response shape");
    }

    return {
      token: result.token,
      certFingerprint: result.certFingerprint,
      port: result.port ?? null,
      path: result.path,
      localIps: result.localIps,
      hostname: result.hostname,
    };
  }

  async rotateToken(): Promise<{ token: string }> {
    const result = await backendRequest<{ token?: string }>("server.rotateToken");

    if (typeof result?.token !== "string") {
      throw new Error("Invalid server.rotateToken response shape");
    }

    return { token: result.token };
  }
}

// Tied to AppClient["server"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["server"] | undefined = undefined as
  | LiveServerClient
  | undefined;
void _interfaceCheck;
