import type { StoreMiddleware } from '@augmentcode/themis/types';
import {
  setActiveProvider,
  setAtomicDefaultModel,
} from '../slices/provider-settings/provider-settings-slice';
import {
  backgroundProviderSwitchBlocked,
  type BackgroundAgentSettingsState,
} from '../slices/background-agent-settings/background-agent-settings-slice';

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

/** Reject an unrepresentable legacy snapshot before either optimistic slice changes.
 * settings.update forbids compound model values, even when settings reads return
 * them. Never strip their provider ownership or silently replace them on a switch.
 */
export function createQuickActionProviderSwitchMiddleware(): StoreMiddleware {
  return (store) => (next) => (action) => {
    let providerId: string;
    const type = (action as { type?: string } | null)?.type;
    if (type === setActiveProvider.type) {
      providerId = (action as ReturnType<typeof setActiveProvider>).payload[0];
    } else if (type === setAtomicDefaultModel.type) {
      providerId = (action as ReturnType<typeof setAtomicDefaultModel>).payload[0].providerId;
    } else return next(action);
    const state = store.getState() as { backgroundAgentSettings?: BackgroundAgentSettingsState };
    if (isQuickActionProviderSwitchBlocked(state.backgroundAgentSettings, providerId)) {
      return next(backgroundProviderSwitchBlocked(providerId));
    }
    return next(action);
  };
}
