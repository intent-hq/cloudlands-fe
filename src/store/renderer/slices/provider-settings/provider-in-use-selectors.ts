import { store } from '../../store';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { selectProviderModels } from '../model/model-selectors';
import { selectEffectiveDefaultProviderId } from '../provider-catalog/provider-catalog-selectors';
import { selectSpecialistFilePath, selectSpecialists } from '../specialists/specialists-selectors';
import { selectActiveProviderId } from './provider-settings-selectors';
import { m } from '$shared/paraglide/messages.js';
import { isProviderProfileRef } from '$shared/provider-profiles';
import { formatInteger } from '$lib/i18n/format';

/**
 * Saved provider references used to explain why a named profile cannot be
 * removed. These references do not prevent disabling the base provider.
 *
 * A provider counts as in use when it is explicitly pinned by:
 * - the global default model (the active selection in `model.providerModels`,
 *   pinning the default provider — the map key carries provenance), or
 * - a specialist's explicit `codingAgent`, or
 * - a specialist's explicit model id (legacy compound ids pin their prefix
 *   provider; bare ids pin the default provider unless an explicit coding
 *   agent covers them).
 *
 * A named profile reference (`codex@<id>`, §5.54) is additionally in use when
 * it is the default provider (with or without a default model), when quick
 * actions run on it, or when a specialist model option selects it. These are
 * the saved selections that must change before the profile can be removed.
 */
export const selectProviderInUseReasons = store.createSelector((state): Record<string, string> => {
  const reasons = new Map<string, Set<string>>();
  const addReason = (providerId: string, reason: string) => {
    const providerReasons = reasons.get(providerId) ?? new Set<string>();
    providerReasons.add(reason);
    reasons.set(providerId, providerReasons);
  };

  // Only an explicitly selected global model counts as a pin. The
  // catalog-derived default fallback used by selectSelectedModel is implicit.
  // providerModels
  // values are bare ids keyed by provider, so the pinned provider is the
  // default provider itself.
  const defaultProviderId = selectEffectiveDefaultProviderId.select(state);
  const activeProviderId = selectActiveProviderId.select(state);
  const globalModel = selectProviderModels.select(state)[activeProviderId];
  if (globalModel && activeProviderId) {
    addReason(
      activeProviderId,
      m.settings_providers_inUseDefaultModel_label({ model: globalModel }),
    );
  }

  if (isProviderProfileRef(activeProviderId) && !globalModel) {
    addReason(activeProviderId, m.settings_providers_inUseDefaultProvider_label());
  }
  const quickActionProviderId = state.backgroundAgentSettings?.providerId;
  if (quickActionProviderId && isProviderProfileRef(quickActionProviderId)) {
    addReason(quickActionProviderId, m.settings_providers_inUseQuickActions_label());
  }

  for (const specialist of selectSpecialists.select(state)) {
    // Both selectors use the winning file before the first bundled record.
    // Read from the same state so an overridden definition cannot supply the path.
    const path = selectSpecialistFilePath.select(state, specialist.id);
    const source = specialist.source
      ? {
          project: m.settings_providers_pinSourceProject_label(),
          user: m.settings_providers_pinSourceUser_label(),
          bundled: m.settings_providers_pinSourceBundled_label(),
          builtin: m.settings_providers_pinSourceBuiltin_label(),
          'electron-store': m.settings_providers_pinSourceLegacy_label(),
        }[specialist.source]
      : undefined;
    const withProvenance = (reason: string): string => {
      if (source && path) {
        return m.settings_providers_inUseSourcePath_label({ reason, source, path });
      }
      if (source) return m.settings_providers_inUseSource_label({ reason, source });
      if (path) return m.settings_providers_inUsePath_label({ reason, path });
      return reason;
    };
    if (specialist.codingAgent) {
      addReason(
        specialist.codingAgent,
        withProvenance(m.settings_providers_inUseSpecialistAgent_label({ name: specialist.name })),
      );
    }
    specialist.modelOptions?.forEach((option, index) => {
      if (option.provider && isProviderProfileRef(option.provider)) {
        addReason(
          option.provider,
          withProvenance(
            m.settings_providers_inUseSpecialistModelOption_label({
              name: specialist.name,
              position: formatInteger(index + 1),
            }),
          ),
        );
      }
    });
    // Explicit model pin.
    if (specialist.defaultModel) {
      if (specialist.defaultModel.includes(':')) {
        const providerId =
          splitLegacyCompoundId(specialist.defaultModel).providerId ?? defaultProviderId;
        addReason(
          providerId,
          withProvenance(
            m.settings_providers_inUseSpecialistModel_label({
              name: specialist.name,
              model: specialist.defaultModel,
            }),
          ),
        );
      } else if (!specialist.codingAgent) {
        // Bare model id with no explicit agent resolves to the default provider.
        addReason(
          defaultProviderId,
          withProvenance(
            m.settings_providers_inUseSpecialistModel_label({
              name: specialist.name,
              model: specialist.defaultModel,
            }),
          ),
        );
      }
    }
  }

  return Object.fromEntries(
    [...reasons].map(([providerId, entries]) => [providerId, [...entries].join('\n')]),
  );
});

/** Saved uses that block profile removal, or null when the reference is unused. */
export const selectProviderInUseReason = store.createSelector(
  (state, providerId: string): string | null => {
    return selectProviderInUseReasons.select(state)[providerId] ?? null;
  },
);
