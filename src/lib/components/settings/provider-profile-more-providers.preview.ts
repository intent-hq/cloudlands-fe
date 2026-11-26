import type { ComponentProps } from 'svelte';
import { definePreview } from '$lib/component-catalog/preview-definition';
import ProviderProfileKindDialog from './profile-kinds/ProviderProfileKindDialog.svelte';
import { secretShapeError } from './profile-kinds/profile-kind-copy';

type Props = ComponentProps<typeof ProviderProfileKindDialog>;

// i18n-ignore (fake preview credentials, never real)
const PROVIDERS = {
  grok: { providerName: 'Grok Build', kind: 'apiKey', secret: 'xai-fakefakefakefakefakefake' },
  droid: { providerName: 'Factory Droid', kind: 'apiKey', secret: 'fk-fakefakefakefakefakefake' },
  auggie: {
    providerName: 'Augment Auggie',
    kind: 'token',
    secret: '{"accessToken":"fake","tenantURL":"https://fake.invalid/","scopes":["email"]}',
  },
  cursor: {
    providerName: 'Cursor',
    kind: 'apiKey',
    secret: 'key_fakefakefakefakefakefakefakefake',
  },
  dsh: { providerName: 'DeepSeek Harness', kind: 'apiKey', secret: 'sk-fakefakefakefakefakefake' },
} as const;

const states: Record<string, { props: Props }> = {};
for (const [provider, { providerName, kind, secret }] of Object.entries(PROVIDERS)) {
  const base = {
    open: true,
    static: true,
    provider: provider as keyof typeof PROVIDERS,
    providerName,
    folderSuffix: 'k3f9',
  } as const;
  const details = { ...base, mode: 'add', step: 'details', kind, name: 'Work' } as const;
  states[`${provider}-advanced`] = { props: { ...details, kind: 'advanced' } };
  states[`${provider}-add`] = { props: details };
  states[`${provider}-add-filled`] = { props: { ...details, secret } };
  states[`${provider}-key-works`] = {
    props: { ...details, secret, signIn: { status: 'keyWorks' } },
  };
  states[`${provider}-orchestrator-shape-error`] = {
    props: {
      ...details,
      keyCheck: false,
      differentLogin: false,
      secret: 'not-a-key',
      secretError: secretShapeError(base.provider, kind),
    },
  };
}

/** Add profile for Grok, Droid, Auggie and Cursor: no kind picker, the key screen first. */
export const preview = definePreview<Props>({
  id: 'provider-profile-more-providers',
  title: 'Provider profile: Grok, Droid, Auggie, Cursor',
  defaultState: 'grok-add',
  states,
});

export default ProviderProfileKindDialog;
