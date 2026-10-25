import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import type { ProviderDefaultConfig } from '$shared/provider-profiles';
import ProviderProfileDialog from './ProviderProfileDialog.svelte';

/** A renamed Codex Default with a masked key, an empty value and an unset variable. */
const savedDefault: ProviderDefaultConfig = {
  baseProviderId: 'codex',
  providerRef: 'codex',
  name: 'Personal',
  env: [
    { key: 'CODEX_HOME', kind: 'set', value: '********' },
    { key: 'OPENAI_BASE_URL', kind: 'set', value: '' },
    { key: 'OPENAI_API_KEY', kind: 'unset' },
  ],
  settingsFingerprint: 'fp-default',
  activation: { runningProcesses: 0 },
};

const base = {
  open: true,
  static: true,
  providerId: 'codex',
  providerName: 'Codex',
  isDefault: true,
} as const;

export const preview = definePreview<ComponentProps<typeof ProviderProfileDialog>>({
  id: 'provider-default-env-dialog',
  title: 'Provider Default environment dialog',
  defaultState: 'saved',
  states: {
    saved: { props: { ...base, defaultConfig: savedDefault, defaultsLoad: 'success' } },
    empty: { props: { ...base, defaultsLoad: 'success' } },
    loading: { props: { ...base, defaultsLoad: 'idle' } },
    'load-failed': { props: { ...base, defaultsLoad: 'failure' } },
  },
});

export default ProviderProfileDialog;
