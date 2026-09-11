// Scripts launched by `pnpm run` (including `corepack pnpm run`) must spawn nested pnpm
// commands through the pnpm that started them: the bare `pnpm` on PATH can be a different
// version, which refuses to run because it does not match the `packageManager` pin.
// pnpm exposes its own JS entry point as `npm_execpath` to every script it runs.
const JS_ENTRY_RE = /\.[cm]?js$/i;

export function pnpmInvocation(pnpmArgs, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const entry = env.npm_execpath;
  const launchedByPnpm = (env.npm_config_user_agent ?? '').startsWith('pnpm/');
  if (entry && launchedByPnpm && JS_ENTRY_RE.test(entry)) {
    return { executable: execPath, args: [entry, ...pnpmArgs], shell: false };
  }
  return { executable: 'pnpm', args: [...pnpmArgs], shell: platform === 'win32' };
}
