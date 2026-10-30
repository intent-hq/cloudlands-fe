/** Fake data for the profile-kind dialog sandbox scenes (no daemon). */
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

export const codexApiKeyAdd = {
  ...codexBase,
  mode: 'add',
  step: 'details',
  kind: 'apiKey',
  name: 'OpenAI key',
} as const;

export const FAKE_EMAIL = 'work@acme.com';
