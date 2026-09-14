// Scripts launched by `pnpm run` (including `corepack pnpm run`) must spawn nested pnpm
// commands through the pnpm that started them: the bare `pnpm` on PATH can be a different
// version, which refuses to run because it does not match the `packageManager` pin.
// pnpm exposes its own JS entry point as `npm_execpath` to every script it runs.
//
// Without that entry, the PATH fallback on Windows must go through `cmd.exe` (Node refuses
// to spawn `pnpm.cmd` directly), and `shell: true` joins the arguments into one unquoted
// command line. Each argument is therefore quoted and caret-escaped for cmd.exe first, so
// spaces and metacharacters survive as a single argv entry.
const JS_ENTRY_RE = /\.[cm]?js$/i;
const CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g;

export function quoteForCmd(arg) {
  const value = String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  return `"${value}"`.replace(CMD_META_RE, '^$1');
}

export function pnpmInvocation(pnpmArgs, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const entry = env.npm_execpath;
  const launchedByPnpm = (env.npm_config_user_agent ?? '').startsWith('pnpm/');
  if (entry && launchedByPnpm && JS_ENTRY_RE.test(entry)) {
    return { executable: execPath, args: [entry, ...pnpmArgs], shell: false };
  }
  if (platform === 'win32') {
    return { executable: 'pnpm', args: pnpmArgs.map(quoteForCmd), shell: true };
  }
  return { executable: 'pnpm', args: [...pnpmArgs], shell: false };
}
