/**
 * Main-process client for the daemon's `host.providerAuthStatus` RPC
 * (intent-hq/intentd#339). The daemon owns all provider auth probing; RPC
 * failures fold to an empty verdict map (every provider reads as unknown, no
 * indicator) so availability aggregation degrades instead of throwing.
 */
import { Logger } from '../logger';
import { getBackendClient } from '../../features/backend/main/backend.ipc';
import type { JsonRpcClient } from '../../features/backend/main/json-rpc-client';
import {
  PROVIDER_AUTH_STATUS_METHOD,
  buildProviderAuthStatusParams,
  toAuthVerdictMap,
  type ProviderAuthStatusParams,
  type ProviderAuthStatusResponse,
  type ProviderAuthVerdict,
} from '../provider-auth-status';

const logger = new Logger('ProviderAuthStatus');

/**
 * Sweep (or single-provider) auth status from the daemon as an id → verdict
 * map (`authenticated` is `true` / `false` / `undefined` for the wire's
 * `null` unknowns; `authDetails` carries the rendered identity when sent).
 */
export async function getProviderAuthVerdicts(
  options: ProviderAuthStatusParams = {},
  client?: JsonRpcClient,
): Promise<Record<string, ProviderAuthVerdict>> {
  try {
    const response = await (client ?? getBackendClient()).request<ProviderAuthStatusResponse>(
      PROVIDER_AUTH_STATUS_METHOD,
      buildProviderAuthStatusParams(options),
    );
    return toAuthVerdictMap(response);
  } catch (error) {
    logger.warn('host.providerAuthStatus RPC failed; auth verdicts degrade to unknown', {
      providerId: options.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/** Single-provider convenience over {@link getProviderAuthVerdicts}. */
export async function getProviderAuthVerdict(
  providerId: string,
  options: { force?: boolean } = {},
  client?: JsonRpcClient,
): Promise<ProviderAuthVerdict | undefined> {
  const verdicts = await getProviderAuthVerdicts({ providerId, force: options.force }, client);
  return verdicts[providerId];
}
