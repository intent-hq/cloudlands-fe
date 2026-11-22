/**
 * Pure helpers for the add/edit provider-profile dialog's kinds (Different
 * login, API key, Token, Advanced) for every provider with profile kinds:
 * Claude Code, Codex, Grok, Factory Droid, Auggie and Cursor. Each provider
 * offers only the kinds in its row of the table below.
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

/** The providers with profile kinds, named as in the folder path. */
export type ProfileProvider = 'claude' | 'codex' | 'grok' | 'droid' | 'auggie' | 'cursor';

export type ProfileKind = 'differentLogin' | 'apiKey' | 'token' | 'advanced';

/** Every kind with its own screen (Advanced is the raw env editor). */
export type SpecializedProfileKind = Exclude<ProfileKind, 'advanced'>;

/** The value a masked `set` entry reads as (protocol `EnvEntryRead`). */
export const MASKED_ENV_VALUE = '********';

const BASE_PROVIDER_IDS: Record<ProfileProvider, string> = {
  claude: 'claude-code',
  codex: 'codex',
  grok: 'grok',
  droid: 'droid',
  auggie: 'auggie',
  cursor: 'cursor',
};

/** Account folders of the providers with a Different login kind. */
const FOLDER_VARIABLES: Partial<Record<ProfileProvider, string>> = {
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
 * Codex's API key is `CODEX_API_KEY`: the Codex adapter reads it first, and
 * other tools that read `OPENAI_API_KEY` do not pick it up. The daemon signs
 * Codex in with it at launch (Codex ignores a key that is only in the env).
 */
/*
 * Grok, Droid, Auggie and Cursor (PROTOCOL §5.54 "Profile-capable bases"):
 * one credential each. Grok and Cursor prefer a saved login over the key,
 * so the daemon runs their key profiles in a home of their own; Auggie's
 * token is the JSON `auggie token print` prints (AUGMENT_SESSION_AUTH).
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
    apiKey: {
      set: ['CODEX_API_KEY'],
      optionalSet: [],
      unset: ['CODEX_ACCESS_TOKEN', 'OPENAI_API_KEY'],
    },
    token: {
      set: ['CODEX_ACCESS_TOKEN'],
      optionalSet: [],
      unset: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    },
  },
  grok: {
    apiKey: { set: ['XAI_API_KEY'], optionalSet: [], unset: [] },
  },
  droid: {
    apiKey: { set: ['FACTORY_API_KEY'], optionalSet: [], unset: [] },
  },
  auggie: {
    token: { set: ['AUGMENT_SESSION_AUTH'], optionalSet: [], unset: [] },
  },
  cursor: {
    apiKey: { set: ['CURSOR_API_KEY'], optionalSet: [], unset: ['CURSOR_AUTH_TOKEN'] },
  },
};

const DETECTION_ORDER: readonly SpecializedProfileKind[] = ['differentLogin', 'apiKey', 'token'];

function kindKeys(provider: ProfileProvider, kind: SpecializedProfileKind): KindKeys {
  const keys = PROFILE_KIND_TABLE[provider][kind];
  if (!keys) throw new Error(`${provider} has no ${kind} profile kind`);
  return keys;
}

/** The specialized kinds a provider offers, in dialog order (Advanced is always offered too). */
export function profileKindsFor(provider: ProfileProvider): SpecializedProfileKind[] {
  return DETECTION_ORDER.filter((kind) => PROFILE_KIND_TABLE[provider][kind] !== undefined);
}

/** The provider's only specialized kind, or `undefined` when it offers a choice. */
export function singleProfileKind(provider: ProfileProvider): SpecializedProfileKind | undefined {
  const kinds = profileKindsFor(provider);
  return kinds.length === 1 ? kinds[0] : undefined;
}

/** Whether `provider` offers `kind`. */
export function hasProfileKind(provider: ProfileProvider, kind: SpecializedProfileKind): boolean {
  return PROFILE_KIND_TABLE[provider][kind] !== undefined;
}

/** The variable of Claude's optional Custom endpoint (Codex API keys have none). */
const CLAUDE_BASE_URL = 'ANTHROPIC_BASE_URL';

/** `providers.profiles.*` `baseProviderId` for a provider. */
export function baseProviderIdFor(provider: ProfileProvider): string {
  return BASE_PROVIDER_IDS[provider];
}

/** The provider for a profile's `baseProviderId`, or `undefined` for one without kinds. */
export function profileProviderFromBaseId(baseProviderId: string): ProfileProvider | undefined {
  return (Object.keys(BASE_PROVIDER_IDS) as ProfileProvider[]).find(
    (provider) => BASE_PROVIDER_IDS[provider] === baseProviderId,
  );
}

/**
 * A catalog row with profile kinds (key and token screens): Claude Code,
 * Codex, Grok, Droid, Auggie and Cursor, when the daemon offers profiles
 * for them (`supportsProfiles`; an older daemon offers them for Claude Code
 * and Codex only).
 */
export function hasProfileKinds(entry: { id?: string; supportsProfiles?: boolean }): boolean {
  return (
    entry.supportsProfiles === true &&
    entry.id !== undefined &&
    profileProviderFromBaseId(entry.id) !== undefined
  );
}

/** The variable an API key / Token profile saves its secret in. */
export function secretKeyFor(kind: 'apiKey' | 'token', provider: ProfileProvider): string {
  return kindKeys(provider, kind).set[0];
}

/** The providers with a Different login kind: an account folder signed in from a terminal. */
export type FolderLoginProvider = 'claude' | 'codex';

/** Whether `provider` has a Different login (an account folder). */
export function hasFolderLogin(provider: ProfileProvider): provider is FolderLoginProvider {
  return FOLDER_VARIABLES[provider] !== undefined;
}

/** The variable that picks a provider's account folder (Claude Code and Codex). */
export function folderVariableFor(provider: ProfileProvider): string {
  const variable = FOLDER_VARIABLES[provider];
  if (!variable) throw new Error(`${provider} has no account folder`);
  return variable;
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
  for (const kind of profileKindsFor(provider)) {
    if (!matches(kindKeys(provider, kind), setKeys, unsetKeys)) continue;
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
  if (!FOLDER_VARIABLES[provider]) return false;
  const folder = savedFolderPath(provider, env);
  return folder !== undefined && folder !== '' && folder !== MASKED_ENV_VALUE;
}

/** The saved folder path of a Different-login profile, exactly as read. */
export function savedFolderPath(
  provider: ProfileProvider,
  env: readonly EnvEntryRead[],
): string | undefined {
  const folderVariable = FOLDER_VARIABLES[provider];
  if (!folderVariable) return undefined;
  const variable = upper(folderVariable);
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
  /** Claude or Codex API key. */
  apiKey?: string;
  /** Claude API key's optional Custom endpoint; sent only when filled in. Codex ignores it. */
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
      key: keys.set[0],
      kind: 'set',
      value: savedSecretValue(provider, kind, requireValue(form.apiKey, 'API key')),
    });
    const baseUrl = form.baseUrl?.trim();
    if (baseUrl && provider === 'claude') {
      set.push({ key: CLAUDE_BASE_URL, kind: 'set', value: baseUrl });
    }
  } else {
    set.push({
      key: keys.set[0],
      kind: 'set',
      value: savedSecretValue(provider, kind, requireValue(form.token, 'token')),
    });
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
      const value = requireValue(replacement, key);
      return {
        key: existing ?? key,
        kind: 'set',
        value: kind === 'differentLogin' ? value : savedSecretValue(provider, kind, value),
      };
    }
    if (!existing) throw new Error(`Missing ${key}`);
    return { key: existing, kind: 'keep' };
  };

  const env: EnvEntryWrite[] = [];
  if (kind === 'differentLogin') {
    env.push(secret(folderVariableFor(provider), undefined));
  } else if (kind === 'apiKey') {
    env.push(secret(keys.set[0], edits.apiKey));
    const savedBaseUrl = provider === 'claude' ? savedKey(CLAUDE_BASE_URL, 'set') : undefined;
    const baseUrl = provider === 'claude' ? edits.baseUrl : undefined;
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      env.push({ key: savedBaseUrl ?? CLAUDE_BASE_URL, kind: 'set', value: baseUrl.trim() });
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
 * Auggie's access token: the JSON `auggie token print` prints. Auggie ignores
 * an `AUGMENT_SESSION_AUTH` without a string `accessToken`, a `tenantURL` and
 * a `scopes` array (auggie 0.35.0), so all three are required.
 */
function isAuggieSessionJson(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(auggieSessionJson(value));
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const session = parsed as Record<string, unknown>;
  return (
    typeof session.accessToken === 'string' &&
    session.accessToken.trim() !== '' &&
    typeof session.tenantURL === 'string' &&
    /^https:\/\/\S+$/.test(session.tenantURL) &&
    Array.isArray(session.scopes)
  );
}

/**
 * The session JSON in a paste of `auggie token print`: the value after
 * `SESSION=`, else the outermost `{…}`, else the paste trimmed. Users may
 * paste the whole output (banner and usage lines included).
 */
function auggieSessionJson(value: string): string {
  const trimmed = value.trim();
  const line = trimmed.split(/\r?\n/).find((item) => item.trim().startsWith('SESSION='));
  if (line) return line.trim().slice('SESSION='.length).trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/** The value a pasted key or token is saved as (Auggie: just the session JSON). */
function savedSecretValue(
  provider: ProfileProvider,
  kind: 'apiKey' | 'token',
  value: string,
): string {
  return provider === 'auggie' && kind === 'token' ? auggieSessionJson(value) : value.trim();
}

type SecretShape = RegExp | ((value: string) => boolean);

const SECRET_SHAPES: Record<ProfileProvider, Partial<Record<'apiKey' | 'token', SecretShape>>> = {
  claude: {
    apiKey: /^sk-ant-api\d*-[A-Za-z0-9_-]{16,}$/,
    token: /^sk-ant-oat\d*-[A-Za-z0-9_-]{16,}$/,
  },
  codex: {
    apiKey: /^sk-(?!ant-)[A-Za-z0-9_-]{20,}$/,
    token: JWT_SHAPE,
  },
  grok: { apiKey: /^xai-[A-Za-z0-9]{20,}$/ },
  droid: { apiKey: /^fk-[A-Za-z0-9_-]{20,}$/ },
  auggie: { token: isAuggieSessionJson },
  // Cursor documents no prefix: one word of at least 32 characters.
  cursor: { apiKey: /^\S{32,}$/ },
};

/**
 * Whether a pasted key or token has its provider's shape. On an orchestrator
 * this is the whole check: it runs no provider, so no test prompt can run.
 * A Claude key for a Custom endpoint may come from any gateway, so it only
 * needs to be one word.
 */
export function isSecretWellFormed(
  provider: ProfileProvider,
  kind: 'apiKey' | 'token',
  value: string,
  options: { customEndpoint?: boolean } = {},
): boolean {
  const trimmed = value.trim();
  if (provider === 'claude' && kind === 'apiKey' && options.customEndpoint) {
    return /^\S+$/.test(trimmed);
  }
  const shape = SECRET_SHAPES[provider][kind];
  if (!shape) return false;
  return typeof shape === 'function' ? shape(trimmed) : shape.test(trimmed);
}

/**
 * The plain terminal sign-in command; the folder variable goes in the
 * terminal's `env`, never in this string. Codex ChatGPT sign-in always uses
 * device auth: the browser flow's localhost callback can't reach a remote daemon.
 */
export function loginCommand(provider: ProfileProvider): string {
  if (provider === 'claude') return 'claude auth login';
  if (provider === 'codex') return 'codex login --device-auth';
  throw new Error(`${provider} has no Different login sign-in`);
}
