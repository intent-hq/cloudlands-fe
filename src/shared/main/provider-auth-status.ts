/**
 * Main-process client for the daemon's `host.providerAuthStatus` RPC
 * (intent-hq/intentd#339). The daemon owns all provider auth probing; RPC
 * failures fold to an empty verdict map (every provider reads as unknown, no
 * indicator) so availability aggregation degrades instead of throwing.
 */
import { Logger } from '../logger';
import { getBackendClient } from '../../features/backend/main/backend.ipc';
import {
  PROVIDER_AUTH_STATUS_METHOD,
  buildProviderAuthStatusParams,
  toAuthVerdictMap,
  type ProviderAuthStatusParams,
  type ProviderAuthStatusResponse,
} from '../provider-auth-status';

const logger = new Logger('ProviderAuthStatus');

/**
 * Sweep (or single-provider) auth status from the daemon as an id → verdict
 * map (`true` / `false` / `undefined` for the wire's `null` unknowns).
 */
export async function getProviderAuthVerdicts(
  options: ProviderAuthStatusParams = {},
): Promise<Record<string, boolean | undefined>> {
  try {
    const response = await getBackendClient().request<ProviderAuthStatusResponse>(
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
): Promise<boolean | undefined> {
  const verdicts = await getProviderAuthVerdicts({ providerId, force: options.force });
  return verdicts[providerId];
}
