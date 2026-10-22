import { put } from 'typed-redux-saga';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { selectBgSettings } from '../background-agent-settings-selectors';
import {
  backgroundFields,
  backgroundSettingsSaveSettled,
  reconcileBackgroundSettings,
  type BackgroundSettingsValues,
} from '../background-agent-settings-slice';

/** Settle under the shared write lock, before the next writer reads its bundle. */
export function* settleBackgroundSettings(
  ack: Parameters<typeof backgroundSettingsSaveSettled>[0],
  saved?: BackgroundSettingsValues,
  applied: readonly AppliedSettingChange[] = [],
) {
  const current = yield* selectBgSettings.effect();
  const savedValues = saved
    ? (Object.fromEntries(
        backgroundFields.map((field) => {
          const change = applied.find(({ path }) => path === `quickActions.${field}`);
          return [field, change ? change.value : saved[field]];
        }),
      ) as BackgroundSettingsValues)
    : undefined;
  const settlement = { ...ack, savedValues };
  const reconciled = current ? reconcileBackgroundSettings(current, settlement) : undefined;
  yield* put(
    backgroundSettingsSaveSettled({
      ...settlement,
      ...(reconciled && !reconciled.persistencePending
        ? { authoritativeProviderId: reconciled.providerId }
        : {}),
    }),
  );
}
