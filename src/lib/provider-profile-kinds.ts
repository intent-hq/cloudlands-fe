/**
 * Pure helpers for the add/edit provider-profile dialog's kinds (Different
 * login, API key, Token, Advanced) for Claude Code and Codex.
 *
 * A profile's kind is never stored: it is read from the profile's saved env
 * (PROTOCOL §5.54) with the matching table below, and every specialized kind
 * saves `unset` entries for the credentials that would otherwise be inherited
 * from the daemon or the login shell and override the profile.
 *
 * No UI, no daemon calls: the dialog and its sandbox previews share these.
 */
import type {
  EnvEntryRead,
  EnvEntryWrite,
  ProviderProfileCreateParams,
} from '$shared/provider-profiles';

/** The two profile-capable providers, named as in the folder path. */
export type ProfileProvider = 'claude' | 'codex';

export type ProfileKind = 'differentLogin' | 'apiKey' | 'token' | 'advanced';

/** Every kind with its own screen (Advanced is the raw env editor). */
export type SpecializedProfileKind = Exclude<ProfileKind, 'advanced'>;

/** The value a masked `set` entry reads as (protocol `EnvEntryRead`). */
export const MASKED_ENV_VALUE = '********';

const BASE_PROVIDER_IDS: Record<ProfileProvider, string> = {
  claude: 'claude-code',
  codex: 'codex',
};

const FOLDER_VARIABLES: Record<ProfileProvider, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

interface KindKeys {
  /** `set` keys the profile must have, exactly. */
  set: readonly string[];
  /** `set` keys the profile may also have. */
  optionalSet: readonly string[];
  /** Saved automatically; a matching profile's `unset` keys are a subset of these. */
  unset: readonly string[];
}

/**
 * The brief's "Edit opens the matching screen" and "Unset rows" tables.
 * Codex has no API-key kind.
 */
const PROFILE_KIND_TABLE: Record<
  ProfileProvider,
  Partial<Record<SpecializedProfileKind, KindKeys>>
> = {
  claude: {
    differentLogin: {
      set: ['CLAUDE_CONFIG_DIR'],
      optionalSet: [],
      unset: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    },
    apiKey: {
      set: ['ANTHROPIC_API_KEY'],
      optionalSet: ['ANTHROPIC_BASE_URL'],
      unset: ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    },
    token: {
      set: ['CLAUDE_CODE_OAUTH_TOKEN'],
      optionalSet: [],
      unset: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    },
  },
  codex: {
    differentLogin: {
      set: ['CODEX_HOME'],
      optionalSet: [],
      unset: ['CODEX_ACCESS_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'],
    },
    token: {
      set: ['CODEX_ACCESS_TOKEN'],
      optionalSet: [],
      unset: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    },
  },
};

const DETECTION_ORDER: readonly SpecializedProfileKind[] = ['differentLogin', 'apiKey', 'token'];

/** The table row a kind saves with; throws for a kind the provider lacks (Codex API key). */
function kindKeys(provider: ProfileProvider, kind: SpecializedProfileKind): KindKeys {
  const keys = PROFILE_KIND_TABLE[provider][kind];
  if (!keys) throw new Error(`No ${kind} kind for ${provider}`);
  return keys;
}

/** `providers.profiles.*` `baseProviderId` for a provider. */
export function baseProviderIdFor(provider: ProfileProvider): string {
  return BASE_PROVIDER_IDS[provider];
}

/** The provider for a profile's `baseProviderId`, or `undefined` for one without kinds. */
export function profileProviderFromBaseId(baseProviderId: string): ProfileProvider | undefined {
  if (baseProviderId === 'claude-code') return 'claude';
  if (baseProviderId === 'codex') return 'codex';
  return undefined;
}

/** The variable that picks a provider's account folder. */
export function folderVariableFor(provider: ProfileProvider): string {
  return FOLDER_VARIABLES[provider];
}

/** The folder new Different-login folders are created in (`~/` form; the daemon expands it). */
export function profileFoldersParent(provider: ProfileProvider): string {
  return `~/intent/profiles/${provider}`;
}

const upper = (key: string) => key.toUpperCase();

/**
 * The kind whose screen Edit opens for a saved env. `set` keys must equal the
 * kind's keys exactly (plus its optional keys), `unset` keys must be a subset of
 * the kind's unset list, and keys compare ignoring case. Anything else, no
 * variables, or a folder path the daemon masked (older daemon) is Advanced.
 */
export function detectProfileKind(
  provider: ProfileProvider,
  env: readonly EnvEntryRead[],
): ProfileKind {
  if (env.length === 0) return 'advanced';
  const setKeys = new Set<string>();
  const unsetKeys = new Set<string>();
  for (const entry of env) {
    const key = upper(entry.key);
    if (setKeys.has(key) || unsetKeys.has(key)) return 'advanced';
    (entry.kind === 'set' ? setKeys : unsetKeys).add(key);
  }
  for (const kind of DETECTION_ORDER) {
    const keys = PROFILE_KIND_TABLE[provider][kind];
    if (!keys || !matches(keys, setKeys, unsetKeys)) continue;
    if (kind === 'differentLogin' && !hasUsableFolder(provider, env)) return 'advanced';
    return kind;
  }
  return 'advanced';
}

function matches(keys: KindKeys, setKeys: Set<string>, unsetKeys: Set<string>): boolean {
  const required = keys.set.map(upper);
  const allowed = new Set([...required, ...keys.optionalSet.map(upper)]);
  if (!required.every((key) => setKeys.has(key))) return false;
  if (![...setKeys].every((key) => allowed.has(key))) return false;
  const allowedUnset = new Set(keys.unset.map(upper));
  return [...unsetKeys].every((key) => allowedUnset.has(key));
}

function hasUsableFolder(provider: ProfileProvider, env: readonly EnvEntryRead[]): boolean {
  const folder = savedFolderPath(provider, env);
  return folder !== undefined && folder !== '' && folder !== MASKED_ENV_VALUE;
}

/** The saved folder path of a Different-login profile, exactly as read. */
export function savedFolderPath(
  provider: ProfileProvider,
  env: readonly EnvEntryRead[],
): string | undefined {
  const variable = upper(folderVariableFor(provider));
  const entry = env.find((item) => item.kind === 'set' && upper(item.key) === variable);
  return entry?.kind === 'set' ? entry.value : undefined;
}

const SLUG_MAX_LENGTH = 32;

/**
 * The folder-name slug of a profile name: strip accents, lowercase, every run
 * of characters other than a–z/0–9 becomes one `-`, trim `-`, cut to 32, trim
 * `-` again; an empty result is `profile`.
 */
export function slugifyProfileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'profile';
}

/** Returns a number in [0, 1). */
export type RandomSource = () => number;

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 4;

function defaultRandom(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

/** Four random lowercase letters/digits. */
export function randomSuffix(rng: RandomSource = defaultRandom): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    const index = Math.min(SUFFIX_ALPHABET.length - 1, Math.floor(rng() * SUFFIX_ALPHABET.length));
    suffix += SUFFIX_ALPHABET[index];
  }
  return suffix;
}

const MAX_FOLDER_ATTEMPTS = 64;

/**
 * A new, unused `~/intent/profiles/<claude|codex>/<slug>-<suffix>` path.
 * `existingEntries` are the names already in that folder (from
 * `host.listDirectory`; a missing folder is `[]`). Names compare ignoring case
 * so a case-insensitive file system cannot alias an existing folder. Throws
 * when no free suffix turns up, which only a broken `rng` can cause.
 */
export function pickUnusedFolder(
  provider: ProfileProvider,
  name: string,
  existingEntries: Iterable<string>,
  rng: RandomSource = defaultRandom,
): string {
  const taken = new Set([...existingEntries].map((entry) => entry.toLowerCase()));
  const slug = slugifyProfileName(name);
  for (let attempt = 0; attempt < MAX_FOLDER_ATTEMPTS; attempt++) {
    const folderName = `${slug}-${randomSuffix(rng)}`;
    if (!taken.has(folderName)) return `${profileFoldersParent(provider)}/${folderName}`;
  }
  throw new Error(`No unused profile folder found for "${slug}"`);
}

/** What a specialized add screen collects. Fields a kind doesn't use are ignored. */
export interface ProfileKindForm {
  name: string;
  backup?: boolean;
  /** Different login: the `~/…` path from `pickUnusedFolder`. */
  folder?: string;
  /** Claude API key. */
  apiKey?: string;
  /** Claude API key's optional Custom endpoint; sent only when filled in. */
  baseUrl?: string;
  /** Claude OAuth token or Codex access token. */
  token?: string;
}

function unsetEntries(keys: readonly string[]): EnvEntryWrite[] {
  return keys.map((key) => ({ key, kind: 'unset' }));
}

function requireValue(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw new Error(`Missing ${field}`);
  return trimmed;
}

/**
 * The `providers.profiles.create` params for a specialized kind, including the
 * kind's automatic `unset` entries. Callers validate required fields first;
 * a missing one throws.
 */
export function buildCreatePayload(
  kind: SpecializedProfileKind,
  provider: ProfileProvider,
  form: ProfileKindForm,
): ProviderProfileCreateParams {
  const keys = kindKeys(provider, kind);
  const set: EnvEntryWrite[] = [];
  if (kind === 'differentLogin') {
    set.push({
      key: folderVariableFor(provider),
      kind: 'set',
      value: requireValue(form.folder, 'folder'),
    });
  } else if (kind === 'apiKey') {
    set.push({
      key: 'ANTHROPIC_API_KEY',
      kind: 'set',
      value: requireValue(form.apiKey, 'API key'),
    });
    const baseUrl = form.baseUrl?.trim();
    if (baseUrl) set.push({ key: 'ANTHROPIC_BASE_URL', kind: 'set', value: baseUrl });
  } else {
    set.push({ key: keys.set[0], kind: 'set', value: requireValue(form.token, 'token') });
  }
  return {
    baseProviderId: baseProviderIdFor(provider),
    name: form.name.trim(),
    backup: form.backup ?? false,
    env: [...set, ...unsetEntries(keys.unset)],
  };
}

/**
 * Edits on a specialized screen. A secret left `undefined` keeps its saved
 * value (`keep`); a string replaces it. `baseUrl: null` removes a saved
 * Custom endpoint.
 */
export interface ProfileKindEdits {
  apiKey?: string;
  baseUrl?: string | null;
  token?: string;
}

/**
 * The complete `env` for `providers.profiles.update` from a specialized edit
 * screen: the kind's `set` keys (saved secrets not replaced → `keep`; the
 * folder path is read-only → `keep`) plus every unset of the kind, re-adding
 * any that are missing. Saved key spelling is kept so `keep` names the saved
 * entry.
 */
export function buildUpdateEnv(
  kind: SpecializedProfileKind,
  provider: ProfileProvider,
  saved: readonly EnvEntryRead[],
  edits: ProfileKindEdits = {},
): EnvEntryWrite[] {
  const keys = kindKeys(provider, kind);
  const savedKey = (key: string, kind: EnvEntryRead['kind']) =>
    saved.find((entry) => entry.kind === kind && upper(entry.key) === upper(key))?.key;
  const secret = (key: string, replacement: string | undefined): EnvEntryWrite => {
    const existing = savedKey(key, 'set');
    if (replacement !== undefined) {
      return { key: existing ?? key, kind: 'set', value: requireValue(replacement, key) };
    }
    if (!existing) throw new Error(`Missing ${key}`);
    return { key: existing, kind: 'keep' };
  };

  const env: EnvEntryWrite[] = [];
  if (kind === 'differentLogin') {
    env.push(secret(folderVariableFor(provider), undefined));
  } else if (kind === 'apiKey') {
    env.push(secret('ANTHROPIC_API_KEY', edits.apiKey));
    const savedBaseUrl = savedKey('ANTHROPIC_BASE_URL', 'set');
    const baseUrl = edits.baseUrl;
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      env.push({ key: savedBaseUrl ?? 'ANTHROPIC_BASE_URL', kind: 'set', value: baseUrl.trim() });
    } else if (baseUrl === undefined && savedBaseUrl) {
      env.push({ key: savedBaseUrl, kind: 'keep' });
    }
  } else {
    env.push(secret(keys.set[0], edits.token));
  }
  for (const key of keys.unset) env.push({ key: savedKey(key, 'unset') ?? key, kind: 'unset' });
  return env;
}

const BASE64URL_PART = '[A-Za-z0-9_-]+';
const JWT_SHAPE = new RegExp(`^${BASE64URL_PART}\\.${BASE64URL_PART}\\.${BASE64URL_PART}$`);

/** Three dot-separated, non-empty base64url parts (the Codex access-token check). */
export function isJwtShaped(value: string): boolean {
  return JWT_SHAPE.test(value.trim());
}

/**
 * The plain terminal sign-in command; the folder variable goes in the
 * terminal's `env`, never in this string. Codex ChatGPT sign-in uses device
 * auth unless the daemon is the app's own sidecar (the browser callback to the
 * daemon host's localhost can't reach a remote daemon).
 */
export function loginCommand(provider: ProfileProvider, isDaemonAppOwned: boolean): string {
  if (provider === 'claude') return 'claude auth login';
  return isDaemonAppOwned ? 'codex login' : 'codex login --device-auth';
}
