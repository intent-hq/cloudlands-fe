/**
 * Live providers domain backed by the intentd daemon (PROTOCOL §5.38, §5.54).
 *
 * `providers.catalog` is daemon-owned (optional `workspaceId` routing context) and
 * returns the full static provider registry — every registered row (gated-off
 * included, `visible` carries the daemon-evaluated verdict) in registry
 * order. The data is compiled into the daemon, so the result only changes
 * when the daemon binary does.
 *
 * `providers.profiles.*` manage named Codex/Claude Code profiles. Reads are
 * masked by the daemon; write params carry literal values only to the daemon
 * and are never logged here.
 *
 * Responses are validated against the Zod schemas at the wire boundary; a
 * divergent payload THROWS (never silently absorbed — the BE or PROTOCOL.md
 * is the fix-site). Transport failures and daemon rejections also THROW so
 * callers decide the fallback.
 */
import {
  PROVIDERS_CATALOG_METHOD,
  ProviderCatalogRequestSchema,
  ProviderCatalogResponseSchema,
  type ProviderCatalogResult,
} from '$shared/provider-catalog';
import {
  PROVIDER_PROFILES_CREATE_METHOD,
  PROVIDER_PROFILES_DELETE_METHOD,
  PROVIDER_PROFILES_LIST_METHOD,
  PROVIDER_PROFILES_REORDER_METHOD,
  PROVIDER_PROFILES_UPDATE_METHOD,
  ProviderProfileCreateResponseSchema,
  ProviderProfileDeleteResponseSchema,
  ProviderProfileReorderResponseSchema,
  ProviderProfilesListResponseSchema,
  ProviderProfileUpdateResponseSchema,
  type ProviderProfileCreateParams,
  type ProviderProfileCreateResult,
  type ProviderProfileDeleteResult,
  type ProviderProfileReorderParams,
  type ProviderProfileReorderResult,
  type ProviderProfilesListResult,
  type ProviderProfileUpdateParams,
  type ProviderProfileUpdateResult,
} from '$shared/provider-profiles';
import type { AppClient, ProvidersClient } from '../app-client';
import { backendRequest } from './backend-transport';

export class LiveProvidersClient implements ProvidersClient {
  async catalog(workspaceId?: string): Promise<ProviderCatalogResult> {
    const params = ProviderCatalogRequestSchema.parse(workspaceId ? { workspaceId } : {});
    const result = await backendRequest<unknown>(PROVIDERS_CATALOG_METHOD, params);
    return ProviderCatalogResponseSchema.parse(result);
  }

  async listProfiles(baseProviderId?: string): Promise<ProviderProfilesListResult> {
    const result = await backendRequest<unknown>(
      PROVIDER_PROFILES_LIST_METHOD,
      baseProviderId ? { baseProviderId } : {},
    );
    return ProviderProfilesListResponseSchema.parse(result);
  }

  async createProfile(params: ProviderProfileCreateParams): Promise<ProviderProfileCreateResult> {
    const result = await backendRequest<unknown>(PROVIDER_PROFILES_CREATE_METHOD, {
      baseProviderId: params.baseProviderId,
      name: params.name,
      ...(params.env ? { env: params.env } : {}),
      ...(params.backup !== undefined ? { backup: params.backup } : {}),
    });
    return ProviderProfileCreateResponseSchema.parse(result);
  }

  async updateProfile(params: ProviderProfileUpdateParams): Promise<ProviderProfileUpdateResult> {
    const result = await backendRequest<unknown>(PROVIDER_PROFILES_UPDATE_METHOD, {
      profileId: params.profileId,
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.env ? { env: params.env } : {}),
      ...(params.backup !== undefined ? { backup: params.backup } : {}),
    });
    return ProviderProfileUpdateResponseSchema.parse(result);
  }

  async deleteProfile(profileId: string): Promise<ProviderProfileDeleteResult> {
    const result = await backendRequest<unknown>(PROVIDER_PROFILES_DELETE_METHOD, { profileId });
    return ProviderProfileDeleteResponseSchema.parse(result);
  }

  async reorderProfiles(
    params: ProviderProfileReorderParams,
  ): Promise<ProviderProfileReorderResult> {
    const result = await backendRequest<unknown>(PROVIDER_PROFILES_REORDER_METHOD, {
      baseProviderId: params.baseProviderId,
      profileIds: params.profileIds,
    });
    return ProviderProfileReorderResponseSchema.parse(result);
  }
}

// Tied to AppClient["providers"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['providers'] | undefined = undefined as
  LiveProvidersClient | undefined;
void _interfaceCheck;
