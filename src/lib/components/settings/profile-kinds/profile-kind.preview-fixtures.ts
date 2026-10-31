/** Fake data for the profile-kind dialog sandbox scenes (no daemon). */
import type { EnvEntryRead } from '$shared/provider-profiles';

/** Saved env as `providers.profiles.list` reads it (values masked). */
const env = (entries: EnvEntryRead[]): EnvEntryRead[] => entries;

export const claudeBase = {
  open: true,
  static: true,
  provider: 'claude',
  providerName: 'Claude Code',
  folderSuffix: 'k3f9',
} as const;

export const codexBase = {
  open: true,
  static: true,
  provider: 'codex',
  providerName: 'Codex',
  folderSuffix: 'k3f9',
} as const;

export const claudeAddDetails = {
  ...claudeBase,
  mode: 'add',
  step: 'details',
  kind: 'differentLogin',
  name: 'Work account',
} as const;

export const codexAddDetails = {
  ...codexBase,
  mode: 'add',
  step: 'details',
  kind: 'differentLogin',
  name: 'Work account',
} as const;

export const claudeEdit = {
  ...claudeBase,
  mode: 'edit',
  kind: 'differentLogin',
  name: 'Work account',
  savedName: 'Work account',
  savedFolderPath: '~/intent/profiles/claude/work-account-k3f9',
} as const;

export const codexEdit = {
  ...codexBase,
  mode: 'edit',
  kind: 'differentLogin',
  name: 'Personal',
  savedName: 'Personal',
  savedFolderPath: '~/intent/profiles/codex/personal-7h2m',
} as const;

export const FAKE_EMAIL = 'work@acme.com';

/** A fake key/token typed into a field (never a real credential). */
export const FAKE_SECRET = 'sk-ant-fake-0000000000';
/** A fake JWT-shaped Codex access token (three base64url parts). */
export const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.ZmFrZQ';

export const claudeApiKeyAdd = {
  ...claudeBase,
  mode: 'add',
  step: 'details',
  kind: 'apiKey',
  name: 'Anthropic key',
} as const;

export const claudeApiKeyEdit = {
  ...claudeBase,
  mode: 'edit',
  kind: 'apiKey',
  name: 'Anthropic key',
  savedName: 'Anthropic key',
  secretSaved: true,
  savedEnv: env([
    { key: 'ANTHROPIC_API_KEY', kind: 'set', value: '********' },
    { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
    { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
  ]),
} as const;

export const claudeApiKeyEditWithEndpoint = {
  ...claudeApiKeyEdit,
  baseUrlSaved: true,
  customEndpointOpen: true,
  savedEnv: env([
    ...claudeApiKeyEdit.savedEnv,
    { key: 'ANTHROPIC_BASE_URL', kind: 'set', value: '********' },
  ]),
} as const;

export const claudeTokenAdd = {
  ...claudeBase,
  mode: 'add',
  step: 'details',
  kind: 'token',
  name: 'Max plan token',
} as const;

export const claudeTokenEdit = {
  ...claudeBase,
  mode: 'edit',
  kind: 'token',
  name: 'Max plan token',
  savedName: 'Max plan token',
  secretSaved: true,
  savedEnv: env([
    { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'set', value: '********' },
    { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
    { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
  ]),
} as const;

export const codexTokenAdd = {
  ...codexBase,
  mode: 'add',
  step: 'details',
  kind: 'token',
  name: 'Team token',
} as const;

export const codexTokenEdit = {
  ...codexBase,
  mode: 'edit',
  kind: 'token',
  name: 'Team token',
  savedName: 'Team token',
  secretSaved: true,
  savedEnv: env([
    { key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: '********' },
    { key: 'CODEX_API_KEY', kind: 'unset' },
    { key: 'OPENAI_API_KEY', kind: 'unset' },
  ]),
} as const;

/** A profile no specialized screen matches (opens Advanced on Edit). */
export const claudeAdvancedEdit = {
  ...claudeBase,
  mode: 'edit',
  kind: 'advanced',
  name: 'Bedrock',
  savedName: 'Bedrock',
  savedEnv: env([
    { key: 'CLAUDE_CODE_USE_BEDROCK', kind: 'set', value: '********' },
    { key: 'AWS_REGION', kind: 'set', value: '********' },
    { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
  ]),
} as const;

export const codexAdvancedEdit = {
  ...codexBase,
  mode: 'edit',
  kind: 'advanced',
  name: 'Gateway',
  savedName: 'Gateway',
  savedEnv: env([
    { key: 'OPENAI_BASE_URL', kind: 'set', value: '********' },
    { key: 'OPENAI_API_KEY', kind: 'set', value: '********' },
  ]),
} as const;

/** Claude rows: Different login signed in and signed out, API key, Token, Advanced. */
export const claudeRows = [
  {
    id: 'work',
    name: 'Work account',
    kind: 'differentLogin',
    status: 'ready',
    email: 'work@acme.com',
    backup: true,
    folderPath: '~/intent/profiles/claude/work-account-k3f9',
  },
  {
    id: 'side',
    name: 'Side project',
    kind: 'differentLogin',
    status: 'error',
    folderPath: '~/.claude-side',
  },
  { id: 'key', name: 'Anthropic key', kind: 'apiKey', status: 'ready' },
  { id: 'token', name: 'Max plan token', kind: 'token', status: 'ready' },
  { id: 'bedrock', name: 'Bedrock', kind: 'advanced', status: 'configured' },
] as const;

/** Codex rows: Different login (no identity), API-key folder profile signed out, Token. */
export const codexRows = [
  {
    id: 'personal',
    name: 'Personal',
    kind: 'differentLogin',
    status: 'ready',
    folderPath: '~/intent/profiles/codex/personal-7h2m',
  },
  {
    id: 'openai-key',
    name: 'OpenAI key',
    kind: 'differentLogin',
    status: 'error',
    folderPath: '~/intent/profiles/codex/openai-key-p4x2',
  },
  { id: 'team', name: 'Team token', kind: 'token', status: 'ready' },
] as const;
