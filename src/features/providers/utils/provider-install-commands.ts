/**
 * Install command per provider. The onboarding card shows it and its Install
 * button runs it in the root terminal drawer. Only this renderer-owned
 * allowlist is ever executed, never a caller string.
 */
export const PROVIDER_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  auggie: 'npm install -g @augmentcode/auggie',
  'claude-code': 'curl -fsSL https://claude.ai/install.sh | bash',
  codex: 'npm i -g @openai/codex',
  opencode: 'curl -fsSL https://opencode.ai/install | bash',
  droid: 'curl -fsSL https://app.factory.ai/cli | sh',
  grok: 'npm i -g @xai-official/grok',
  // Unsloth runs local GGUF models through the opencode runtime — the daemon
  // manages the local server; only the opencode CLI is needed.
  unsloth: 'curl -fsSL https://opencode.ai/install | bash',
  cursor: 'curl https://cursor.com/install -fsS | bash',
  cortex: 'curl -LsS https://ai.snowflake.com/static/cc-scripts/install.sh | sh',
};

export function providerInstallCommand(providerId: string): string | undefined {
  return Object.hasOwn(PROVIDER_INSTALL_COMMANDS, providerId)
    ? PROVIDER_INSTALL_COMMANDS[providerId]
    : undefined;
}
