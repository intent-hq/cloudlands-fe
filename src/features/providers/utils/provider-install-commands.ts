/**
 * Install command per provider. The onboarding card shows it and its Install
 * button runs it in the root terminal drawer. Only this renderer-owned
 * allowlist is ever executed, never a caller string. List a provider only
 * when its one command makes the card ready (Unsloth also needs its own CLI,
 * so it has no entry and keeps the docs link).
 */
const PROVIDER_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  auggie: 'npm install -g @augmentcode/auggie',
  'claude-code': 'curl -fsSL https://claude.ai/install.sh | bash',
  codex: 'npm i -g @openai/codex',
  opencode: 'curl -fsSL https://opencode.ai/install | bash',
  droid: 'curl -fsSL https://app.factory.ai/cli | sh',
  grok: 'npm i -g @xai-official/grok',
  cursor: 'curl https://cursor.com/install -fsS | bash',
  cortex: 'curl -LsS https://ai.snowflake.com/static/cc-scripts/install.sh | sh',
};

export function providerInstallCommand(providerId: string): string | undefined {
  return Object.hasOwn(PROVIDER_INSTALL_COMMANDS, providerId)
    ? PROVIDER_INSTALL_COMMANDS[providerId]
    : undefined;
}
