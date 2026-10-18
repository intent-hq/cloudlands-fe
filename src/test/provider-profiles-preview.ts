import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import type {
  EnvEntryRead,
  EnvEntryWrite,
  ProviderProfile,
  ProviderProfileFieldError,
} from '$shared/provider-profiles';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { selectProviderProfilesRevision } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import {
  providerProfilesLoaded,
  providerSettingsSessionOpened,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { selectDaemonTransport } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { providerProfilesSaga } from '$store/renderer/slices/provider-settings/sagas/provider-profiles-saga';
import { setLabsProviderProfilesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { selectLabsProviderProfilesEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

/** Set Settings → Labs → Provider profiles for a preview; returns its restore. */
export function setProviderProfilesLabForPreview(enabled: boolean): () => void {
  const previous = selectLabsProviderProfilesEnabled.select(appStore.state);
  appStore.dispatch(setLabsProviderProfilesEnabled(enabled));
  return () => {
    appStore.dispatch(setLabsProviderProfilesEnabled(previous));
  };
}

const RESERVED = new Set(['PATH', 'CODEX_PATH', 'CLAUDE_CODE_EXECUTABLE', 'CODEX_CONFIG', 'HOME']);

function maskEnv(env: EnvEntryWrite[], previous: EnvEntryRead[] = []): EnvEntryRead[] {
  return env.map((entry) => {
    if (entry.kind === 'keep') return previous.find((saved) => saved.key === entry.key)!;
    if (entry.kind === 'unset') return { key: entry.key, kind: 'unset' };
    return { key: entry.key, kind: 'set', value: entry.value === '' ? '' : '********' };
  });
}

function validate(name: string, env: EnvEntryWrite[], others: ProviderProfile[]) {
  const fieldErrors: ProviderProfileFieldError[] = [];
  const trimmed = name.trim();
  if (!trimmed) fieldErrors.push({ field: 'name', code: 'name-blank', message: 'blank' });
  if (trimmed.toLowerCase() === 'default')
    fieldErrors.push({ field: 'name', code: 'name-reserved', message: 'reserved' });
  if (others.some((profile) => profile.name.toLowerCase() === trimmed.toLowerCase()))
    fieldErrors.push({ field: 'name', code: 'name-duplicate', message: 'duplicate' });
  env.forEach((entry, index) => {
    if (RESERVED.has(entry.key.toUpperCase()))
      fieldErrors.push({
        field: `env[${index}].key`,
        code: 'env-key-reserved',
        message: `${entry.key} is managed by Intent at launch and can't be overridden.`,
      });
    else if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entry.key))
      fieldErrors.push({ field: `env[${index}].key`, code: 'env-key-invalid', message: 'invalid' });
  });
  if (fieldErrors.length > 0)
    throw Object.assign(new Error('invalid'), {
      rpcCode: -32602,
      data: { code: 'invalid-params', fieldErrors },
    });
}

const previewProfiles: ProviderProfile[] = [
  {
    id: 'pwork00000001',
    providerRef: 'codex@pwork00000001',
    baseProviderId: 'codex',
    name: 'Work',
    env: [
      { key: 'CODEX_HOME', kind: 'set', value: '********' },
      { key: 'OPENAI_API_KEY', kind: 'unset' },
    ],
    settingsFingerprint: 'fp-work',
    createdAt: '2026-10-17T10:00:00Z',
    updatedAt: '2026-10-17T10:00:00Z',
  },
  {
    id: 'ppersonal0001',
    providerRef: 'codex@ppersonal0001',
    baseProviderId: 'codex',
    name: 'Personal',
    env: [{ key: 'CODEX_HOME', kind: 'set', value: '********' }],
    settingsFingerprint: 'fp-personal',
    createdAt: '2026-10-17T10:05:00Z',
    updatedAt: '2026-10-17T10:05:00Z',
  },
  {
    id: 'pproxy0000001',
    providerRef: 'claude-code@pproxy0000001',
    baseProviderId: 'claude-code',
    name: 'Proxy',
    env: [
      { key: 'ANTHROPIC_BASE_URL', kind: 'set', value: '********' },
      { key: 'ANTHROPIC_API_KEY', kind: 'set', value: '' },
    ],
    settingsFingerprint: 'fp-proxy',
    createdAt: '2026-10-17T10:10:00Z',
    updatedAt: '2026-10-17T10:10:00Z',
  },
];

const PREVIEW_AUTH: Record<string, boolean | undefined> = {
  'codex@pwork00000001': true,
  'codex@ppersonal0001': false,
};

/**
 * Run the production profiles saga against an isolated in-memory daemon:
 * masked reads, documented validation codes, and activation summaries.
 */
export function setupProviderProfilesPreview({
  appOwned = true,
  runningProcesses = 1,
  labsEnabled = true,
}: { appOwned?: boolean; runningProcesses?: number; labsEnabled?: boolean } = {}) {
  const restoreLab = setProviderProfilesLabForPreview(labsEnabled);
  const providers = appClient.providers;
  const original = {
    listProfiles: providers.listProfiles,
    createProfile: providers.createProfile,
    updateProfile: providers.updateProfile,
    deleteProfile: providers.deleteProfile,
  };
  const catalog = selectProviderCatalogEntries.select(appStore.state);
  const transport = selectDaemonTransport.select(appStore.state);
  let profiles = previewProfiles.map((profile) => ({ ...profile }));
  // Results older than the shown list are ignored, so continue from it.
  let revision = selectProviderProfilesRevision.select(appStore.state) + 1;

  providers.listProfiles = async () => ({ profiles, revision });
  providers.createProfile = async ({ baseProviderId, name, env = [] }) => {
    validate(
      name,
      env,
      profiles.filter((profile) => profile.baseProviderId === baseProviderId),
    );
    const id = `pnew${String(++revision).padStart(9, '0')}`;
    const profile: ProviderProfile = {
      id,
      providerRef: `${baseProviderId}@${id}`,
      baseProviderId,
      name: name.trim(),
      env: maskEnv(env),
      settingsFingerprint: `fp-${id}`,
      createdAt: '2026-10-17T11:00:00Z',
      updatedAt: '2026-10-17T11:00:00Z',
    };
    profiles = [...profiles, profile];
    return { profile, revision };
  };
  providers.updateProfile = async ({ profileId, name, env }) => {
    const current = profiles.find((profile) => profile.id === profileId);
    if (!current)
      throw Object.assign(new Error('not found'), { rpcCode: -32602, data: { code: 'not-found' } });
    validate(
      name ?? current.name,
      env ?? [],
      profiles.filter((p) => p.baseProviderId === current.baseProviderId && p.id !== profileId),
    );
    const envChanged = env !== undefined && env.some((entry) => entry.kind !== 'keep');
    const profile: ProviderProfile = {
      ...current,
      name: (name ?? current.name).trim(),
      env: env ? maskEnv(env, current.env) : current.env,
      settingsFingerprint: envChanged
        ? `${current.settingsFingerprint}+`
        : current.settingsFingerprint,
    };
    profiles = profiles.map((p) => (p.id === profileId ? profile : p));
    return {
      profile,
      revision: ++revision,
      activation: { envChanged, runningProcesses: envChanged ? runningProcesses : 0 },
    };
  };
  providers.deleteProfile = async (profileId) => {
    profiles = profiles.filter((profile) => profile.id !== profileId);
    return { profileId, revision: ++revision };
  };

  appStore.dispatch(
    providerCatalogLoaded({
      providers: catalog.map((entry) => ({
        ...entry,
        supportsProfiles: entry.id === 'codex' || entry.id === 'claude-code',
      })),
    }),
  );
  appStore.dispatch(
    connectionStatusChanged('connected', {
      mode: appOwned ? 'sidecar-uds' : 'external-ws',
      target: 'preview',
    }),
  );
  appStore.dispatch(providerSettingsSessionOpened('profiles-preview'));
  appStore.dispatch(providerProfilesLoaded(profiles, revision));
  const stop = appStore.runSaga(function* previewProfilesSaga() {
    yield* providerProfilesSaga({
      authStatus: async (providerRef: string) => PREVIEW_AUTH[providerRef],
    });
  });
  return () => {
    stop();
    restoreLab();
    Object.assign(providers, original);
    appStore.dispatch(providerCatalogLoaded({ providers: catalog }));
    appStore.dispatch(providerProfilesLoaded([], revision + 1));
    if (transport) appStore.dispatch(connectionStatusChanged('connected', transport));
  };
}
