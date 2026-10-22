import type { BackgroundAgentSettingsState } from './background-agent-settings-slice';

/** Reads stay backward compatible; switching must not rewrite invalid legacy models. */
export function isQuickActionProviderSwitchBlocked(
  background: BackgroundAgentSettingsState | undefined,
  providerId: string,
): boolean {
  if (!background || !providerId || providerId === background.providerId) return false;
  const snapshot = background.providerSettings[providerId];
  return Boolean(
    snapshot &&
    [snapshot.defaultModel, ...Object.values(snapshot.typeOverrides ?? {})].some(
      (model) => typeof model === 'string' && model.includes(':'),
    ),
  );
}
