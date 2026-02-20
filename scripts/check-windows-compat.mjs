#!/usr/bin/env node
/**
 * Windows Compatibility Lint Script
 *
 * Scans TypeScript/JavaScript files for patterns that commonly break on Windows.
 * Based on real issues found across 3 waves of Windows compatibility fixes.
 *
 * Usage:
 *   node scripts/check-windows-compat.mjs src/file.ts          # scan specific files
 *   node scripts/check-windows-compat.mjs src/                  # scan directory recursively
 *   node scripts/check-windows-compat.mjs --git-diff            # scan files changed vs HEAD
 *   node scripts/check-windows-compat.mjs --git-staged          # scan staged files only
 *   node scripts/check-windows-compat.mjs src/ --json           # JSON output for CI
 *   node scripts/check-windows-compat.mjs src/ --severity critical
 *   node scripts/check-windows-compat.mjs src/ --ignore "e2e/**"
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ─── Severity levels ───────────────────────────────────────────────────────────

const SEVERITY = {
  CRITICAL: { label: "🔴", name: "critical", exitCode: 1 },
  WARNING: { label: "🟡", name: "warning", exitCode: 0 },
  INFO: { label: "⚪", name: "info", exitCode: 0 },
};

// ─── Rule definitions ──────────────────────────────────────────────────────────

const UNIX_COMMANDS = [
  "pkill", "pgrep", "chmod", "ln", "sleep", "bash", "sh", "sed", "awk", "which",
  "kill", "grep", "xargs", "cat", "tail", "head", "wc", "tee", "nohup", "lsof",
];

const UNIX_COMMANDS_WITH_FLAGS = [
  "mkdir -p", "cp ", "rm -rf", "rm -r",
];

const NPM_BINARIES = ["npm", "npx", "pnpm", "yarn"];

const RULES = [
  // ─── 🔴 Critical ──────────────────────────────────────────────────────────
  {
    id: "unix-command",
    severity: SEVERITY.CRITICAL,
    description: "spawn/exec of Unix-only command (doesn't exist on Windows)",
    fix: "Use cross-platform alternative or add platform guard",
    skipInPlatformGuard: true,
    test(line, _ctx) {
      const spawnExecRe = /\b(?:spawn|exec|execSync|execFile|execFileSync)\s*\(\s*[`'"]/;
      if (!spawnExecRe.test(line)) {
        // Also check for backtick command strings like execSync(`pkill ...`)
        const templateRe = /\b(?:spawn|exec|execSync|execFile|execFileSync)\s*\(\s*`/;
        if (!templateRe.test(line)) return null;
      }
      for (const cmd of UNIX_COMMANDS) {
        const re = new RegExp(`\\b(?:spawn|exec|execSync|execFile|execFileSync)\\s*\\(\\s*['"\`]${cmd}\\b`);
        if (re.test(line)) return { matched: line.trim(), command: cmd };
      }
      for (const cmd of UNIX_COMMANDS_WITH_FLAGS) {
        const re = new RegExp(`\\b(?:spawn|exec|execSync|execFile|execFileSync)\\s*\\(\\s*['"\`]${cmd.replace(/ /g, "\\s+")}`);
        if (re.test(line)) return { matched: line.trim(), command: cmd.trim() };
      }
      return null;
    },
  },
  {
    id: "dev-null",
    severity: SEVERITY.CRITICAL,
    description: "/dev/null string literal in code",
    fix: "Use `process.platform === 'win32' ? 'NUL' : '/dev/null'`",
    skipInPlatformGuard: true,
    test(line, ctx) {
      // Skip comments
      const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      // Skip git diff format headers (--- /dev/null, +++ /dev/null)
      if (/^[+-]{3}\s+\/dev\/null/.test(stripped.trim())) return null;
      if (/---\s+\/dev\/null/.test(stripped) || /\+\+\+\s+\/dev\/null/.test(stripped)) return null;
      // Skip remote command patterns (SSH, find, grep, etc.) where /dev/null is used on remote host
      const remotePatterns = /\b(ssh|find\s|grep\s|ls\s|df\s|head\s|tail\s|sha1sum|source\s+~\/|\$SHELL|command\s+-v|launchctl)\b/;
      if (/\/dev\/null/.test(stripped) && remotePatterns.test(stripped)) return null;
      // Category A: Skip SSH/remote files — commands run on remote Linux servers
      if (ctx && ctx.filePath && /[/\\](ssh|remote-fs|remote-file-system)[/\\]|ssh-manager\./.test(ctx.filePath)) return null;
      // Category A: Skip lines near SSH execution context
      if (ctx && ctx.lines && ctx.lineNumber) {
        const idx = ctx.lineNumber - 1;
        const nearby = [ctx.lines[idx - 2], ctx.lines[idx - 1], line, ctx.lines[idx + 1], ctx.lines[idx + 2]].filter(Boolean).join(" ");
        if (/\b(sshManager|executeCommand|client\.exec\(|connection\.exec\()/.test(nearby)) return null;
      }
      // Category C1: Skip ternary guards that already check process.platform
      if (/process\.platform/.test(stripped)) return null;
      // Category C2: Skip lines using common platform guard variables
      if (/\b(isWindows|isWin32|IS_WINDOWS|isWin)\b/.test(stripped)) return null;
      if (/['"`]\/dev\/null['"`]/.test(stripped) || /['"`][^'"`]*\/dev\/null[^'"`]*['"`]/.test(stripped)) {
        return { matched: line.trim() };
      }
      // Also catch unquoted /dev/null in template literals or assignments
      if (/\/dev\/null/.test(stripped) && !/^\s*[\/*#]/.test(line)) {
        return { matched: line.trim() };
      }
      return null;
    },
  },
  {
    id: "shell-fallback-unix",
    severity: SEVERITY.CRITICAL,
    description: "Shell falls back to /bin/bash or /bin/sh (doesn't exist on Windows)",
    fix: "Use `process.platform === 'win32' ? true : (process.env.SHELL || '/bin/bash')`",
    skipInPlatformGuard: true,
    test(line, ctx) {
      if (/\/bin\/bash/.test(line) || /\/bin\/sh\b/.test(line)) {
        // Skip pure comments
        const stripped = line.replace(/\/\/.*$/, "");
        if (/\/bin\/bash/.test(stripped) || /\/bin\/sh\b/.test(stripped)) {
          // Skip ternary guards that already check process.platform
          if (/process\.platform/.test(stripped)) return null;
          // Category C2: Skip lines using common platform guard variables
          if (/\b(isWindows|isWin32|IS_WINDOWS|isWin)\b/.test(stripped)) return null;
          // Skip log/warn messages (just mentioning the path, not using it)
          if (/\b(logger\.warn|logger\.info|logger\.debug|console\.log|console\.warn|console\.error)\b/.test(stripped)) return null;
          // Category A: Skip SSH/remote files — commands run on remote Linux servers
          if (ctx && ctx.filePath && /[/\\](ssh|remote-fs|remote-file-system)[/\\]|ssh-manager\./.test(ctx.filePath)) return null;
          // Category A: Skip lines near SSH execution context
          if (ctx && ctx.lines && ctx.lineNumber) {
            const idx = ctx.lineNumber - 1;
            const nearby = [ctx.lines[idx - 2], ctx.lines[idx - 1], line, ctx.lines[idx + 1], ctx.lines[idx + 2]].filter(Boolean).join(" ");
            if (/\b(sshManager|executeCommand|client\.exec\(|connection\.exec\()/.test(nearby)) return null;
          }
          return { matched: line.trim() };
        }
      }
      return null;
    },
  },
  {
    id: "npm-spawn-no-shell",
    severity: SEVERITY.CRITICAL,
    description: "spawn of npm/npx/pnpm/yarn without shell:true (these are .cmd on Windows)",
    fix: "Add `shell: true` to spawn options, or use `cross-spawn`",
    skipInPlatformGuard: false,
    test(line, ctx) {
      for (const bin of NPM_BINARIES) {
        const re = new RegExp(`\\bspawn\\s*\\(\\s*['"\`]${bin}['"\`]`);
        if (re.test(line)) {
          // Check if shell: true is on the same line
          if (/shell\s*:\s*true/.test(line)) return null;
          // Category C3: Look ahead up to 5 lines for shell: true (multi-line spawn options)
          if (ctx && ctx.lines && ctx.lineNumber) {
            const idx = ctx.lineNumber - 1;
            for (let j = 1; j <= 5 && idx + j < ctx.lines.length; j++) {
              if (/shell\s*:\s*true/.test(ctx.lines[idx + j])) return null;
            }
          }
          return { matched: line.trim(), binary: bin };
        }
      }
      return null;
    },
  },
  // ─── 🟡 Warning ───────────────────────────────────────────────────────────
  {
    id: "missing-windowsHide",
    severity: SEVERITY.WARNING,
    description: "spawn/exec call missing windowsHide: true",
    fix: "Add `windowsHide: true` to options to prevent console window flash",
    skipInPlatformGuard: false,
    test(line, ctx) {
      const callRe = /\b(?:spawn|execSync|execFile|execFileSync|exec)\s*\(/;
      if (!callRe.test(line)) return null;
      // Skip imports, type annotations, comments
      if (/^\s*(import|from|type|interface|\/\/|\*)/.test(line)) return null;
      if (/windowsHide/.test(line)) return null;
      // Skip .exec( — covers regex.exec(), connection.client.exec(), rpcClient.exec(), etc.
      // Real child_process exec() is always called as standalone exec(, not obj.exec(
      if (/\.exec\s*\(/.test(line) && !/\b(?:spawn|execSync|execFile|execFileSync)\s*\(/.test(line)) return null;
      // Skip method definitions like "async exec(params: ExecParams)"
      if (/\b(async\s+)?exec\s*\(/.test(line) && /\b(function|class|async|public|private|protected)\b/.test(line)) return null;
      // Skip pty.spawn() calls — node-pty doesn't support windowsHide
      if (/pty\.spawn\s*\(/.test(line)) return null;
      // Skip method definitions with TypeScript type annotations (e.g., "spawn(prompt: string, ...)")
      if (/spawn\s*\(/.test(line) && /spawn\s*\([^)]*:\s*(string|number|boolean|void)/.test(line) &&
          !/spawn\s*\(\s*['"`]/.test(line)) return null;
      // Skip non-child_process method calls (e.g., "this.cortex!.spawn(...)")
      if (/this\.\w+[!?]?\.spawn\s*\(/.test(line)) return null;
      // Skip store/class exec methods (e.g., "exec(action: ...)")
      if (/exec\s*\(action\b/.test(line)) return null;

      // Skip calls where the function is a parameter (wrapper that likely injects windowsHide).
      // E.g., "execFile: ExecFileFn" as a function parameter means the caller passes a wrapper.
      if (ctx && ctx.lines && ctx.lineNumber) {
        const idx = ctx.lineNumber - 1;
        const fnMatch = line.match(/\b(execFile|execSync|execFileSync|exec|spawn)\s*\(/);
        if (fnMatch) {
          const fnName = fnMatch[1];
          const paramRe = new RegExp(`\\b${fnName}\\s*:\\s*[A-Z]\\w*`);
          for (let j = idx - 1; j >= Math.max(0, idx - 30); j--) {
            if (paramRe.test(ctx.lines[j])) return null;
            // Stop at function/class/method definition start
            if (/^\s*(?:export\s+)?(?:async\s+)?(?:private\s+|public\s+|protected\s+)?(?:function|class)\b/.test(ctx.lines[j])) break;
          }
        }
      }

      // Multi-line look-ahead: check if windowsHide appears in the options object
      if (ctx && ctx.lines && ctx.lineNumber) {
        const idx = ctx.lineNumber - 1;
        let depth = 0;
        for (let j = 0; j <= 20 && idx + j < ctx.lines.length; j++) {
          if (/windowsHide/.test(ctx.lines[idx + j])) return null;
          for (const ch of ctx.lines[idx + j]) {
            if (ch === '(' || ch === '{') depth++;
            if (ch === ')' || ch === '}') depth--;
          }
          if (j > 0 && depth <= 0) break;
        }

        // Check if spawn/exec uses a variable for options that has windowsHide defined earlier
        // e.g., spawn(cmd, args, spawnOpts) where spawnOpts = { ..., windowsHide: true }
        const varMatch = line.match(/(?:spawn|execSync|execFile|execFileSync)\s*\([^,]+,\s*(?:[^,]+,\s*)?(\w+)\s*[,)]/);
        if (varMatch) {
          const varName = varMatch[1];
          // Skip common non-variable-name matches
          if (!/^(true|false|null|undefined|this)$/.test(varName)) {
            for (let j = idx - 1; j >= Math.max(0, idx - 30); j--) {
              if (new RegExp(`\\b${varName}\\b`).test(ctx.lines[j])) {
                // Found the variable — check it and the next few lines for windowsHide
                for (let k = j; k < Math.min(j + 15, idx); k++) {
                  if (/windowsHide/.test(ctx.lines[k])) return null;
                }
                break;
              }
            }
          }
        }
      }

      return { matched: line.trim() };
    },
  },
  {
    id: "user-env-no-fallback",
    severity: SEVERITY.WARNING,
    description: "process.env.USER without USERNAME fallback",
    fix: "Use `process.env.USER || process.env.USERNAME` or `os.userInfo().username`",
    skipInPlatformGuard: true,
    test(line) {
      if (!/process\.env\.USER\b/.test(line)) return null;
      // Check it's not process.env.USERNAME or process.env.USERPROFILE
      if (/process\.env\.USER[A-Z]/.test(line)) return null;
      // Check for USERNAME fallback on same line
      if (/USERNAME/.test(line)) return null;
      if (/os\.userInfo/.test(line)) return null;
      return { matched: line.trim() };
    },
  },
  {
    id: "home-env-no-fallback",
    severity: SEVERITY.WARNING,
    description: "process.env.HOME without USERPROFILE or os.homedir() fallback",
    fix: "Use `process.env.HOME || process.env.USERPROFILE` or `os.homedir()`",
    skipInPlatformGuard: true,
    test(line) {
      if (!/process\.env\.HOME\b/.test(line)) return null;
      if (/process\.env\.HOMEPATH/.test(line) || /process\.env\.HOMEDRIVE/.test(line)) return null;
      if (/USERPROFILE/.test(line)) return null;
      if (/os\.homedir/.test(line)) return null;
      return { matched: line.trim() };
    },
  },
  {
    id: "path-split-slash",
    severity: SEVERITY.WARNING,
    description: "Path split on '/' only — misses Windows backslash paths",
    fix: "Use `.split(/[\\/\\\\]/)` or `path.sep`",
    skipInPlatformGuard: false,
    test(line) {
      // Look for .split('/') that looks like path splitting
      if (!/\.split\s*\(\s*['"]\/['"]\s*\)/.test(line)) return null;
      // Heuristic: skip if it's clearly a URL split or non-path context
      if (/url/i.test(line) || /http/i.test(line) || /route/i.test(line)) return null;
      // Pattern 2: Skip entirely if line contains URL/URI context keywords
      if (/\b(uri|href|pathname|URL|URI)\b/i.test(line)) return null;
      // Pattern 1: Detect display-only patterns — these extract display names from
      // paths that come from APIs/git/URLs which always use forward slashes.
      // Downgrade to INFO by returning a special flag.
      const displayPatternRe = /\.split\s*\(\s*['"]\/['"]\s*\)\s*\.\s*(pop|slice|at|length|filter)\s*\(/;
      const indexAccessRe = /\.split\s*\(\s*['"]\/['"]\s*\)\s*\[\s*\d+\s*\]/;
      const joinAfterSplitRe = /\.split\s*\(\s*['"]\/['"]\s*\)\s*\.\s*(join|map)\s*\(/;
      if (displayPatternRe.test(line) || indexAccessRe.test(line) || joinAfterSplitRe.test(line)) {
        return { matched: line.trim(), displayOnly: true };
      }
      // Pattern 1b: Assignment patterns — `const parts = X.split('/')` or destructuring
      // `const [a, ...b] = X.split('/')`. These store split results for later use,
      // typically in UI/display code processing paths from git/APIs.
      const assignSplitRe = /(?:const|let|var)\s+(?:\w+|\[[\w\s,\.]+\])\s*=\s*.*\.split\s*\(\s*['"]\/['"]\s*\)/;
      if (assignSplitRe.test(line)) {
        return { matched: line.trim(), displayOnly: true };
      }
      // Pattern 1c: Chained expression ending in .split('/') — e.g., `return x.split('/').length`
      // or standalone `.split('/')` as part of a larger expression (not caught above)
      const chainedSplitRe = /\.split\s*\(\s*['"]\/['"]\s*\)\s*\.\s*\w+/;
      if (chainedSplitRe.test(line)) {
        return { matched: line.trim(), displayOnly: true };
      }
      // Pattern 1d: Multi-line chain — `.split('/')` at end of line, with chained
      // method on the next line (e.g., `.split('/') \n .map(...)`)
      if (/\.split\s*\(\s*['"]\/['"]\s*\)\s*$/.test(line.trim())) {
        return { matched: line.trim(), displayOnly: true };
      }
      return { matched: line.trim() };
    },
  },
  {
    id: "npm-scripts-unix",
    severity: SEVERITY.WARNING,
    description: "Unix-only command in package.json scripts section",
    fix: "Use cross-platform alternatives (shx, cross-env, etc.) or platform-specific scripts",
    skipInPlatformGuard: false,
    // Special: only applies to package.json, handled in scanner
    test(line) {
      const unixCmds = /\b(mkdir\s+-p|cp\s+|rm\s+-rf|rm\s+-r|bash\s+|\/bin\/sh|sleep\s+|chmod\s+|ln\s+-s)/;
      if (unixCmds.test(line)) {
        return { matched: line.trim() };
      }
      return null;
    },
    packageJsonOnly: true,
  },
  {
    id: "hardcoded-unix-paths",
    severity: SEVERITY.WARNING,
    description: "Hardcoded Unix-specific path",
    fix: "Use platform-aware path resolution or add platform guard",
    skipInPlatformGuard: true,
    test(line) {
      const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      const unixPaths = /['"`](\/usr\/|\/opt\/|\/tmp\/|\/home\/)/;
      if (unixPaths.test(stripped)) {
        return { matched: line.trim() };
      }
      return null;
    },
  },
  // ─── ⚪ Info ───────────────────────────────────────────────────────────────
  {
    id: "signal-handling",
    severity: SEVERITY.INFO,
    description: "Signal that behaves differently on Windows",
    fix: "SIGHUP doesn't exist on Windows; SIGTERM is equivalent to SIGKILL (no graceful shutdown)",
    skipInPlatformGuard: true,
    test(line) {
      if (/\.kill\s*\(\s*['"]SIG(HUP|TERM)['"]\s*\)/.test(line)) {
        return { matched: line.trim() };
      }
      return null;
    },
  },
  {
    id: "path-delimiter",
    severity: SEVERITY.INFO,
    description: "PATH split on ':' instead of path.delimiter",
    fix: "Use `path.delimiter` (';' on Windows, ':' on Unix)",
    skipInPlatformGuard: false,
    test(line) {
      if (/PATH.*\.split\s*\(\s*['"]:['"]\s*\)/.test(line) || /\.split\s*\(\s*['"]:['"]\s*\).*PATH/i.test(line)) {
        return { matched: line.trim() };
      }
      // Also catch process.env.PATH?.split(':')
      if (/process\.env\.PATH.*split\s*\(\s*['"]:['"]\s*\)/.test(line)) {
        return { matched: line.trim() };
      }
      return null;
    },
  },
  {
    id: "fs-unix-apis",
    severity: SEVERITY.INFO,
    description: "fs API with Unix-specific behavior (symlink, chmod, permission octals)",
    fix: "fs.symlink needs admin on Windows; fs.chmod is limited; permission octals are ignored",
    skipInPlatformGuard: true,
    test(line) {
      if (/\bfs\.(symlinkSync|symlink|chmodSync|chmod)\s*\(/.test(line)) {
        return { matched: line.trim() };
      }
      // Permission octals like 0o755, 0o644
      if (/\b0o[0-7]{3}\b/.test(line)) {
        // Skip comments
        const stripped = line.replace(/\/\/.*$/, "");
        if (/\b0o[0-7]{3}\b/.test(stripped)) {
          return { matched: line.trim() };
        }
      }
      return null;
    },
  },
];

// ─── Platform guard detection ──────────────────────────────────────────────────

/**
 * Basic heuristic platform guard tracker.
 * Tracks brace depth to detect if we're inside a block like:
 *   if (process.platform === 'win32') { ... }
 *   if (process.platform !== 'win32') { ... }
 *
 * NOTE: This is a heuristic — AST-level analysis would be more accurate.
 */
class PlatformGuardTracker {
  constructor(guardVarNames = []) {
    this.guardStack = []; // stack of { type: 'win32'|'non-win32', braceDepth }
    this.braceDepth = 0;
    // Variable names that are known platform guard aliases (e.g., isWindows, isWin32)
    this.guardVarNames = guardVarNames;
  }

  processLine(line) {
    const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");

    // Detect platform guard starts
    // Match both `if (process.platform === 'win32')` and `if (process.platform === 'win32' && ...)`
    const win32Guard = /if\s*\(\s*process\.platform\s*===\s*['"]win32['"]/.test(stripped) && !(/else\s+if/.test(stripped));
    const notWin32Guard = /if\s*\(\s*process\.platform\s*!==\s*['"]win32['"]/.test(stripped) && !(/else\s+if/.test(stripped));
    const elseIfWin32 = /else\s+if\s*\(\s*process\.platform\s*===\s*['"]win32['"]/.test(stripped);
    const darwinGuard = /if\s*\(\s*process\.platform\s*===\s*['"]darwin['"]/.test(stripped);
    const linuxGuard = /if\s*\(\s*process\.platform\s*===\s*['"]linux['"]/.test(stripped);
    const elseIfDarwin = /else\s+if\s*\(\s*process\.platform\s*===\s*['"]darwin['"]/.test(stripped);
    const elseIfLinux = /else\s+if\s*\(\s*process\.platform\s*===\s*['"]linux['"]/.test(stripped);

    // Pattern 2: Detect variable-based platform guards like `if (isWindows)`
    let varWin32Guard = false;
    let varNotWin32Guard = false;
    let varElseIfWin32 = false;
    for (const varName of this.guardVarNames) {
      const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`else\\s+if\\s*\\(\\s*${escapedVar}\\s*\\)`).test(stripped)) {
        varElseIfWin32 = true;
      } else if (new RegExp(`if\\s*\\(\\s*!\\s*${escapedVar}\\s*\\)`).test(stripped)) {
        varNotWin32Guard = true;
      } else if (new RegExp(`if\\s*\\(\\s*${escapedVar}\\s*\\)`).test(stripped)) {
        varWin32Guard = true;
      }
    }

    // Detect `} else {` — if the closing brace ends a win32 guard, the else block is non-win32
    const elseBlock = /\}\s*else\s*\{/.test(stripped);
    if (elseBlock && !elseIfWin32 && !varElseIfWin32 && this.guardStack.length > 0) {
      const top = this.guardStack[this.guardStack.length - 1];
      // The closing brace before `else` will pop the guard at this depth,
      // so we record what type it was before brace counting removes it
      this._pendingElseType = top.type === "win32" ? "non-win32" : top.type === "non-win32" ? "win32" : null;
    }

    if (win32Guard || elseIfWin32 || varWin32Guard || varElseIfWin32) {
      this.guardStack.push({ type: "win32", braceDepth: this.braceDepth });
    } else if (notWin32Guard || varNotWin32Guard) {
      this.guardStack.push({ type: "non-win32", braceDepth: this.braceDepth });
    } else if (darwinGuard || linuxGuard || elseIfDarwin || elseIfLinux) {
      this.guardStack.push({ type: "non-win32", braceDepth: this.braceDepth });
    }

    // Count braces
    for (const ch of stripped) {
      if (ch === "{") this.braceDepth++;
      if (ch === "}") {
        this.braceDepth--;
        // Pop guards that have ended
        while (
          this.guardStack.length > 0 &&
          this.guardStack[this.guardStack.length - 1].braceDepth >= this.braceDepth
        ) {
          this.guardStack.pop();
        }
      }
    }

    // After brace counting, if we detected an else block following a platform guard,
    // push the inverted guard for the else block
    if (this._pendingElseType) {
      this.guardStack.push({ type: this._pendingElseType, braceDepth: this.braceDepth - 1 });
      this._pendingElseType = null;
    }
  }

  /** Returns true if current position is inside a win32 platform guard */
  isInWin32Guard() {
    return this.guardStack.some((g) => g.type === "win32");
  }

  /** Returns true if current position is inside a non-win32 platform guard */
  isInNonWin32Guard() {
    return this.guardStack.some((g) => g.type === "non-win32");
  }

  /** Returns true if current position is inside any platform guard */
  isInAnyGuard() {
    return this.guardStack.length > 0;
  }
}

// ─── File scanning ─────────────────────────────────────────────────────────────

const SCANNABLE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".svelte"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-electron", "__pycache__"]);

function shouldScanFile(filePath) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath);
  if (base === "package.json") return true;
  return SCANNABLE_EXTENSIONS.has(ext);
}

function isTestFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return /__tests__/.test(normalized) ||
    /\.test\.(ts|js|tsx|jsx)$/.test(normalized) ||
    /\.spec\.(ts|js|tsx|jsx)$/.test(normalized) ||
    /[/\\]test-setup\.(ts|js)$/.test(normalized) ||
    /[/\\]testing[/\\]/.test(normalized);
}

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return shouldScanFile(target) ? [target] : [];
  }
  if (stat.isDirectory()) {
    return collectFilesRecursive(target);
  }
  return [];
}

function collectFilesRecursive(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(fullPath));
    } else if (entry.isFile() && shouldScanFile(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function getGitDiffFiles(staged = false) {
  try {
    const cmd = staged
      ? "git diff --cached --name-only --diff-filter=ACMR"
      : "git diff --name-only --diff-filter=ACMR HEAD";
    const output = execSync(cmd, { encoding: "utf-8", windowsHide: true }).trim();
    if (!output) return [];
    return output.split("\n").filter((f) => shouldScanFile(f));
  } catch {
    console.error("Error: Failed to run git diff. Are you in a git repository?");
    process.exit(2);
  }
}

// ─── Package.json scripts section extraction ───────────────────────────────────

function extractScriptsSection(content) {
  // Returns array of { lineNumber, text } for lines inside "scripts": { ... }
  const lines = content.split("\n");
  const results = [];
  let inScripts = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inScripts) {
      if (/^\s*"scripts"\s*:\s*\{/.test(line)) {
        inScripts = true;
        braceDepth = 1;
        // Count any closing braces on the same line
        const afterOpen = line.slice(line.indexOf("{") + 1);
        for (const ch of afterOpen) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        if (braceDepth <= 0) inScripts = false;
        continue;
      }
    } else {
      results.push({ lineNumber: i + 1, text: line });
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0) {
        inScripts = false;
      }
    }
  }
  return results;
}


// ─── Core scanner ──────────────────────────────────────────────────────────────

function scanFile(filePath, rules) {
  const findings = [];
  const isPackageJson = path.basename(filePath) === "package.json";

  let content;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return findings;
  }

  if (isPackageJson) {
    // Only scan the "scripts" section
    const scriptLines = extractScriptsSection(content);
    const pkgRules = rules.filter((r) => r.packageJsonOnly);
    for (const { lineNumber, text } of scriptLines) {
      for (const rule of pkgRules) {
        const result = rule.test(text);
        if (result) {
          findings.push({
            file: filePath,
            line: lineNumber,
            severity: rule.severity,
            rule: rule.id,
            description: rule.description,
            found: result.matched,
            fix: rule.fix,
          });
        }
      }
    }
    return findings;
  }

  // Regular TS/JS/Svelte file scanning
  const lines = content.split("\n");
  const nonPkgRules = rules.filter((r) => !r.packageJsonOnly);

  // ─── Pre-scan: detect platform guard variable names (Pattern 2) ───
  const guardVarNames = [];
  for (const line of lines) {
    // Match: const isWindows = process.platform === 'win32'
    // Match: const isWindows = navigator.platform.startsWith('Win')
    const m = line.match(/\b(?:const|let|var)\s+(isWindows|isWin32|IS_WINDOWS|isWin)\s*=\s*(?:process\.platform\s*===\s*['"]win32['"]|navigator\.platform\.startsWith\s*\(\s*['"]Win['"]\s*\))/);
    if (m) guardVarNames.push(m[1]);
  }

  const guard = new PlatformGuardTracker(guardVarNames);

  // Helper: count unescaped backticks in a string
  function countUnescapedBackticks(str) {
    let count = 0;
    for (let k = 0; k < str.length; k++) {
      if (str[k] === '`' && (k === 0 || str[k - 1] !== '\\')) count++;
    }
    return count;
  }

  // ─── Pre-scan: contentWindows pairing (Pattern 1) ───
  // Find `content:` lines that have a `contentWindows:` sibling within ±50 lines
  const contentWindowsSkipLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*content\s*:\s*`/.test(lines[i]) || /^\s*content\s*:\s*['"]/.test(lines[i])) {
      // Look for contentWindows: within ±50 lines
      let hasContentWindows = false;
      for (let j = Math.max(0, i - 50); j < Math.min(lines.length, i + 50); j++) {
        if (/^\s*contentWindows\s*[:?]/.test(lines[j])) {
          hasContentWindows = true;
          break;
        }
      }
      if (hasContentWindows) {
        // Mark all lines from this content: property until the closing backtick/quote
        // (the template literal body)
        contentWindowsSkipLines.add(i);
        // Walk forward to find the end of the template literal
        const isTemplateLiteral = /`/.test(lines[i]);
        if (isTemplateLiteral) {
          // Count unescaped backticks: the content: line opens one, find the closing one
          let backtickCount = 0;
          for (let j = i; j < lines.length; j++) {
            backtickCount += countUnescapedBackticks(lines[j]);
            contentWindowsSkipLines.add(j);
            if (backtickCount >= 2) break; // opening + closing backtick
          }
        }
      }
    }
  }

  // ─── Pre-scan: multi-line ternary platform selection (Pattern 3) ───
  // Find `process.platform === 'win32' ?` or `process.platform === 'win32'\n  ?` ternaries
  // and mark the else-branch line ranges
  const ternaryElseSkipLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    // Check for ternary start: process.platform === 'win32' ? or ending with ?
    const ternaryMatch = /process\.platform\s*===\s*['"]win32['"]\s*\??/.test(lines[i]);
    if (!ternaryMatch) continue;
    // Check if the ? is on this line or the next
    let questionLine = i;
    if (!/\?/.test(lines[i].replace(/\/\/.*$/, ""))) {
      // Check next line for the ?
      if (i + 1 < lines.length && /^\s*\?/.test(lines[i + 1])) {
        questionLine = i + 1;
      } else {
        continue;
      }
    }
    // Now find the matching : for this ternary by tracking nesting
    // We need to find the colon at the same nesting level
    let depth = 0; // track parens, brackets, backtick nesting
    let inTemplateLiteral = false;
    let colonLine = -1;
    let endLine = -1;
    for (let j = questionLine; j < lines.length && j < i + 200; j++) {
      const lineStr = lines[j];
      for (let k = 0; k < lineStr.length; k++) {
        const ch = lineStr[k];
        if (ch === '`') inTemplateLiteral = !inTemplateLiteral;
        if (inTemplateLiteral) continue;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') {
          depth--;
          if (depth < 0) {
            // We've exited the containing expression
            endLine = j;
            break;
          }
        }
        if (ch === '?' && j === questionLine && colonLine === -1) {
          // Skip the initial ? of the ternary
          continue;
        }
        if (ch === '?' && depth === 0) depth++; // nested ternary
        if (ch === ':' && depth === 0 && colonLine === -1) {
          colonLine = j;
        }
      }
      if (endLine !== -1) break;
    }
    if (colonLine !== -1) {
      // Mark lines from colonLine to endLine (or colonLine + 100 if no end found) as ternary else
      const end = endLine !== -1 ? endLine : Math.min(lines.length - 1, colonLine + 100);
      for (let j = colonLine; j <= end; j++) {
        ternaryElseSkipLines.add(j);
      }
    }
  }

  // ─── Pre-scan: paired _BASH/_POWERSHELL constants (Pattern 4) ───
  // Find const SOMETHING_BASH = ... with a corresponding SOMETHING_POWERSHELL
  const bashConstSkipLines = new Set();
  const bashConstRanges = []; // { name, startLine, endLine }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\b(?:const|let|var)\s+(\w+_BASH)\s*=\s*/);
    if (!m) continue;
    const bashName = m[1];
    const psName = bashName.replace(/_BASH$/, '_POWERSHELL');
    // Check if the corresponding _POWERSHELL constant exists in the file
    const hasPowershell = lines.some(l => new RegExp(`\\b(?:const|let|var)\\s+${psName}\\s*=`).test(l));
    if (!hasPowershell) continue;
    // Also check for a platform selection between them (e.g., process.platform === 'win32' ? PS : BASH)
    const hasPlatformSelection = lines.some(l =>
      /process\.platform/.test(l) && (new RegExp(psName).test(l) || new RegExp(bashName).test(l))
    );
    if (!hasPlatformSelection) continue;
    // Find the range of the _BASH constant (from const to closing backtick/semicolon)
    let endLine = i;
    const hasTemplateLiteral = /`/.test(lines[i]);
    if (hasTemplateLiteral) {
      let backtickCount = 0;
      for (let j = i; j < lines.length; j++) {
        backtickCount += countUnescapedBackticks(lines[j]);
        endLine = j;
        if (backtickCount >= 2) break;
      }
    } else {
      // Find the semicolon
      for (let j = i; j < lines.length; j++) {
        endLine = j;
        if (/;\s*$/.test(lines[j])) break;
      }
    }
    for (let j = i; j <= endLine; j++) {
      bashConstSkipLines.add(j);
    }
  }

  // ─── Pre-scan: function-level caller guard (Pattern 5) ───
  // Find functions that contain unix commands but are only called from within non-win32 guards
  const callerGuardSkipLines = new Set();
  // First pass: find function definitions and their line ranges
  const functionDefs = []; // { name, startLine, endLine }
  for (let i = 0; i < lines.length; i++) {
    const fnMatch = lines[i].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
    if (!fnMatch) continue;
    const fnName = fnMatch[1];
    // Find the end of the function by brace counting
    let braceDepth = 0;
    let started = false;
    let endLine = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { braceDepth++; started = true; }
        if (ch === '}') braceDepth--;
      }
      if (started && braceDepth <= 0) {
        endLine = j;
        break;
      }
    }
    functionDefs.push({ name: fnName, startLine: i, endLine });
  }
  // Second pass: for each function, check if all call sites are inside non-win32 guards
  // We use a fresh PlatformGuardTracker to find guarded regions
  const callerGuard = new PlatformGuardTracker(guardVarNames);
  const lineGuardState = []; // per-line: { inWin32, inNonWin32 }
  for (let i = 0; i < lines.length; i++) {
    callerGuard.processLine(lines[i]);
    lineGuardState.push({
      inWin32: callerGuard.isInWin32Guard(),
      inNonWin32: callerGuard.isInNonWin32Guard(),
    });
  }
  for (const fn of functionDefs) {
    // Find all call sites of this function (outside its own definition)
    const callSites = [];
    const callRe = new RegExp(`\\b${fn.name}\\s*\\(`);
    for (let i = 0; i < lines.length; i++) {
      if (i >= fn.startLine && i <= fn.endLine) continue; // skip the function body itself
      if (callRe.test(lines[i])) {
        callSites.push(i);
      }
    }
    if (callSites.length === 0) continue;
    // Check if ALL call sites are inside non-win32 guards
    const allCallersGuarded = callSites.every(lineIdx => lineGuardState[lineIdx]?.inNonWin32);
    if (allCallersGuarded) {
      for (let j = fn.startLine; j <= fn.endLine; j++) {
        callerGuardSkipLines.add(j);
      }
    }
  }

  // ─── Pre-scan: isWindows ternary in nearby lines (Pattern 6) ───
  // Find multi-line ternaries using isWindows/isWin32 variables and mark else branches
  const isWindowsTernarySkipLines = new Set();
  const allGuardVarPattern = ['isWindows', 'isWin32', 'IS_WINDOWS', 'isWin', ...guardVarNames];
  const uniqueGuardVars = [...new Set(allGuardVarPattern)];
  for (let i = 0; i < lines.length; i++) {
    // Check for: isWindows ? or isWindows\n  ?
    let found = false;
    for (const varName of uniqueGuardVars) {
      const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escapedVar}\\s*\\??$`).test(lines[i].trim()) ||
          new RegExp(`\\b${escapedVar}\\s*\\?`).test(lines[i])) {
        // Verify there's actually a ? (on this line or next)
        if (/\?/.test(lines[i]) ||
            (i + 1 < lines.length && /^\s*\?/.test(lines[i + 1]))) {
          found = true;
          break;
        }
      }
    }
    if (!found) continue;
    // Find the ? line
    let questionLine = i;
    if (!/\?/.test(lines[i].replace(/\/\/.*$/, ""))) {
      if (i + 1 < lines.length && /^\s*\?/.test(lines[i + 1])) {
        questionLine = i + 1;
      } else {
        continue;
      }
    }
    // Find the matching : for this ternary
    let depth = 0;
    let inTL = false;
    let colonLine = -1;
    let endLine = -1;
    for (let j = questionLine; j < lines.length && j < i + 50; j++) {
      const lineStr = lines[j];
      for (let k = 0; k < lineStr.length; k++) {
        const ch = lineStr[k];
        if (ch === '`') inTL = !inTL;
        if (inTL) continue;
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') {
          depth--;
          if (depth < 0) { endLine = j; break; }
        }
        if (ch === '?' && j === questionLine && colonLine === -1) continue;
        if (ch === '?' && depth === 0) depth++;
        if (ch === ':' && depth === 0 && colonLine === -1) colonLine = j;
      }
      if (endLine !== -1) break;
    }
    if (colonLine !== -1) {
      const end = endLine !== -1 ? endLine : Math.min(lines.length - 1, colonLine + 30);
      for (let j = colonLine; j <= end; j++) {
        isWindowsTernarySkipLines.add(j);
      }
    }
  }

  // ─── Pre-scan: resolver-style paired arrays with win32 conditional (New Pattern 3) ───
  // Files that have arrays of Unix paths AND `...(process.platform === 'win32' ? [`
  // in the same array literal — the Unix paths are paired with Windows alternatives.
  const resolverPairedSkipLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    // Look for the win32 conditional spread pattern in an array
    if (/\.\.\.\(\s*process\.platform\s*===\s*['"]win32['"]\s*\?\s*\[/.test(lines[i])) {
      // Found a win32 conditional spread. Walk backwards from the line BEFORE this one
      // to find the outer array start (skip the `[` in `? [` on this line).
      let arrayStartLine = -1;
      let braceDepth = 0;
      for (let j = i - 1; j >= Math.max(0, i - 50); j--) {
        for (let k = lines[j].length - 1; k >= 0; k--) {
          const ch = lines[j][k];
          if (ch === ']') braceDepth++;
          if (ch === '[') {
            braceDepth--;
            if (braceDepth < 0) {
              arrayStartLine = j;
              break;
            }
          }
        }
        if (arrayStartLine !== -1) break;
      }
      // Walk forward from the spread line to find the outer array end (closing ] at depth 0)
      let arrayEndLine = -1;
      braceDepth = 0;
      const searchStart = arrayStartLine !== -1 ? arrayStartLine : Math.max(0, i - 10);
      for (let j = searchStart; j < Math.min(lines.length, i + 50); j++) {
        for (const ch of lines[j]) {
          if (ch === '[') braceDepth++;
          if (ch === ']') {
            braceDepth--;
            if (braceDepth <= 0) {
              arrayEndLine = j;
              break;
            }
          }
        }
        if (arrayEndLine !== -1) break;
      }
      if (arrayStartLine !== -1 && arrayEndLine !== -1) {
        for (let j = arrayStartLine; j <= arrayEndLine; j++) {
          resolverPairedSkipLines.add(j);
        }
      }
    }
  }

  // ─── Pre-scan: ternary assignment platform guards (New Pattern 6) ───
  // Detect patterns like: const X = process.platform === 'win32' ? [...] : [...];
  // or: const X = process.platform === 'darwin' ? [...] : process.platform === 'win32' ? [...] : [...];
  // Mark the non-win32 branches as guarded
  const ternaryAssignmentSkipLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    // Look for variable assignment with platform ternary
    const assignTernary = /(?:const|let|var)\s+\w+\s*(?::\s*\w+(?:\[\])?\s*)?=\s*$/.test(lines[i].trim());
    if (assignTernary && i + 1 < lines.length) {
      // Check if next line starts with process.platform
      if (/^\s*process\.platform\s*===\s*['"](?:win32|darwin|linux)['"]\s*$/.test(lines[i + 1].trim()) ||
          /^\s*process\.platform\s*===\s*['"](?:win32|darwin|linux)['"]\s*\?/.test(lines[i + 1].trim())) {
        // This is a ternary assignment. Find the non-win32 branches.
        // Walk forward to find the structure
        let depth = 0;
        let inTL = false;
        let foundColon = false;
        let colonLine = -1;
        let endLine = -1;
        for (let j = i + 1; j < Math.min(lines.length, i + 100); j++) {
          for (const ch of lines[j]) {
            if (ch === '`') inTL = !inTL;
            if (inTL) continue;
            if (ch === '(' || ch === '[' || ch === '{') depth++;
            if (ch === ')' || ch === ']' || ch === '}') depth--;
            if (ch === ';' && depth <= 0) { endLine = j; break; }
          }
          if (endLine !== -1) break;
        }
        // If the ternary checks for darwin or linux first, the else branch may contain
        // another ternary for win32. Mark lines in non-win32 branches.
        if (/darwin|linux/.test(lines[i + 1])) {
          // The first branch (after ?) is darwin/linux-specific
          // Find the ? and the matching :
          let qLine = -1;
          for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
            if (/\?/.test(lines[j])) { qLine = j; break; }
          }
          if (qLine !== -1) {
            // Find the matching : at depth 0
            let d = 0;
            let cLine = -1;
            for (let j = qLine; j < Math.min(lines.length, i + 100); j++) {
              for (const ch of lines[j]) {
                if (ch === '`') inTL = !inTL;
                if (inTL) continue;
                if (ch === '(' || ch === '[' || ch === '{') d++;
                if (ch === ')' || ch === ']' || ch === '}') d--;
                if (ch === ':' && d === 0 && cLine === -1 && j > qLine) cLine = j;
              }
              if (cLine !== -1) break;
            }
            if (cLine !== -1) {
              // Mark the darwin/linux branch (from ? to :) as non-win32
              for (let j = qLine; j <= cLine; j++) {
                ternaryAssignmentSkipLines.add(j);
              }
            }
          }
        }
      }
    }
  }

  // ─── Main scan loop ───
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    guard.processLine(line);

    // Skip empty lines and pure comment lines for performance
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const rule of nonPkgRules) {
      // Skip rules that should be suppressed inside platform guards
      if (rule.skipInPlatformGuard) {
        // If we're in a win32 guard, skip unix-specific rules (the code handles win32)
        if (guard.isInWin32Guard()) continue;
        // If we're in a non-win32 guard, skip (the code is intentionally unix-only)
        if (guard.isInNonWin32Guard()) continue;
      }

      const result = rule.test(line, { filePath, lineNumber: i + 1, lines });
      if (result) {
        // ─── False positive filters (skip entirely) ───
        // Pattern 1: contentWindows pairing
        if (contentWindowsSkipLines.has(i) &&
            (rule.id === "shell-fallback-unix" || rule.id === "dev-null" || rule.id === "unix-command")) {
          continue;
        }
        // Pattern 3: multi-line ternary platform selection
        if (ternaryElseSkipLines.has(i) &&
            (rule.id === "shell-fallback-unix" || rule.id === "dev-null" || rule.id === "unix-command")) {
          continue;
        }
        // Pattern 4: paired _BASH/_POWERSHELL constants
        if (bashConstSkipLines.has(i) &&
            (rule.id === "shell-fallback-unix" || rule.id === "dev-null" || rule.id === "unix-command")) {
          continue;
        }
        // Pattern 5: function-level caller guard
        if (callerGuardSkipLines.has(i) && rule.skipInPlatformGuard) {
          continue;
        }
        // Pattern 6: isWindows ternary in nearby lines
        if (isWindowsTernarySkipLines.has(i) &&
            (rule.id === "shell-fallback-unix" || rule.id === "dev-null" || rule.id === "unix-command")) {
          continue;
        }
        // New Pattern 3: resolver-style paired arrays with win32 conditional
        if (resolverPairedSkipLines.has(i) && rule.id === "hardcoded-unix-paths") {
          continue;
        }
        // New Pattern 4: PATH fallback values (process.env.PATH || '/usr/...')
        if (rule.id === "hardcoded-unix-paths" &&
            /process\.env\.PATH/.test(line) && /\|\|/.test(line)) {
          continue;
        }
        // New Pattern 6: ternary assignment platform guards
        if (ternaryAssignmentSkipLines.has(i) && rule.skipInPlatformGuard) {
          continue;
        }
        // Ternary platform guards also apply to hardcoded-unix-paths
        if (ternaryElseSkipLines.has(i) && rule.id === "hardcoded-unix-paths") {
          continue;
        }
        if (isWindowsTernarySkipLines.has(i) && rule.id === "hardcoded-unix-paths") {
          continue;
        }
        // SSH remote context: paths in SSH files are for remote Linux servers
        if (rule.id === "hardcoded-unix-paths" && filePath &&
            /[/\\](ssh|remote-fs|remote-file-system)[/\\]|ssh-manager\.|ssh-test-manager\./.test(filePath)) {
          continue;
        }
        // Placeholder/example paths in HTML attributes (placeholder="...", value="...")
        if (rule.id === "hardcoded-unix-paths" &&
            /(?:placeholder|value)\s*=\s*["']\/(?:home|tmp)\//.test(line)) {
          continue;
        }
        // Default values for SSH workspace paths (display-only defaults)
        if (rule.id === "hardcoded-unix-paths" &&
            /workspacePath\s*[:=]\s*['"]\/home\//.test(line)) {
          continue;
        }
        // Tilde replacement for display normalization (e.g., filePath.replace(/^~/, '/home/user'))
        if (rule.id === "hardcoded-unix-paths" &&
            /\.replace\s*\(.*~.*,\s*['"]\/home\//.test(line)) {
          continue;
        }
        // /tmp/ paths in remote command contexts (SSH executeCommand, remote scripts)
        if (rule.id === "hardcoded-unix-paths" && /\/tmp\//.test(line)) {
          // Check nearby lines for SSH/remote context
          const idx = i;
          const nearby = [lines[idx - 5], lines[idx - 4], lines[idx - 3], lines[idx - 2], lines[idx - 1], line, lines[idx + 1], lines[idx + 2]].filter(Boolean).join(" ");
          if (/\b(sshManager|executeCommand|ssh|remote|connectionId|terminalId)\b/.test(nearby)) {
            continue;
          }
        }
        // Lines inside `else if (process.platform === 'linux')` or `else if (process.platform === 'darwin')`
        // blocks — the PlatformGuardTracker misses these due to brace-counting limitations with
        // `} else if` patterns. Check nearby lines for the platform guard.
        if (rule.id === "hardcoded-unix-paths") {
          const idx = i;
          // Look backwards up to 15 lines for a linux/darwin platform guard
          let inPlatformSpecificBlock = false;
          for (let j = idx; j >= Math.max(0, idx - 15); j--) {
            if (/process\.platform\s*===\s*['"](?:linux|darwin)['"]\s*\)/.test(lines[j])) {
              inPlatformSpecificBlock = true;
              break;
            }
            // Stop if we hit a win32 guard or another function/block boundary
            if (/process\.platform\s*===\s*['"]win32['"]\s*\)/.test(lines[j])) break;
            if (/^\s*(?:function|class|export\s+(?:async\s+)?function)\b/.test(lines[j])) break;
          }
          if (inPlatformSpecificBlock) {
            continue;
          }
        }
        // Functions with "Linux" or "macOS" in their name or nearby comments
        if (rule.id === "hardcoded-unix-paths") {
          const idx = i;
          // Look backwards for function definition or comment indicating platform-specific code
          for (let j = idx; j >= Math.max(0, idx - 30); j--) {
            if (/(?:function|const|async)\s+\w*(?:Linux|MacOS|Macos|Darwin|Unix)\w*/.test(lines[j]) ||
                /\/\*\*.*(?:Linux|macOS|Mac OS|darwin|Unix)/.test(lines[j]) ||
                /^\s*\*\s+.*\b(?:Linux|macOS|Mac OS|darwin|Unix)\b/.test(lines[j]) ||
                /\/\/.*(?:Linux|macOS|Mac OS|darwin|Unix)/.test(lines[j]) ||
                /\b\w*(?:Linux|MacOS|Macos|Darwin|Unix)\w*\s*\(/.test(lines[j])) {
              // Mark as platform-specific — will be downgraded to INFO below
              result._platformSpecificContext = true;
              break;
            }
            // Stop at function boundaries
            if (/^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/.test(lines[j]) && j < idx - 1) break;
          }
        }

        // ─── Severity downgrades ───
        let severity = rule.severity;
        // Downgrade certain rules to INFO in test files (fixture data is low priority)
        if (isTestFile(filePath) && (rule.id === "hardcoded-unix-paths" || rule.id === "dev-null" || rule.id === "shell-fallback-unix")) {
          severity = SEVERITY.INFO;
        }
        // New Pattern 7: home-env-no-fallback in test files → INFO
        if (isTestFile(filePath) && rule.id === "home-env-no-fallback") {
          severity = SEVERITY.INFO;
        }
        // New Pattern 1: path-split-slash display patterns → INFO
        if (rule.id === "path-split-slash" && result.displayOnly) {
          severity = SEVERITY.INFO;
        }
        // New Pattern 5: homebrew paths → INFO
        if (rule.id === "hardcoded-unix-paths" && /homebrew|\/opt\/homebrew/i.test(line)) {
          severity = SEVERITY.INFO;
        }
        // Platform-specific context (macOS/Linux function names, comments) → INFO
        if (rule.id === "hardcoded-unix-paths" && result._platformSpecificContext) {
          severity = SEVERITY.INFO;
        }
        // Symlink paths (/usr/local/bin/X) in assignment context — typically macOS/Linux CLI install
        if (rule.id === "hardcoded-unix-paths" && /symlinkPath\s*=\s*['"]\/usr\/local\/bin\//.test(line)) {
          severity = SEVERITY.INFO;
        }
        findings.push({
          file: filePath,
          line: i + 1,
          severity,
          rule: rule.id,
          description: rule.description,
          found: result.matched,
          fix: rule.fix,
        });
      }
    }
  }

  return findings;
}

// ─── Output formatting ────────────────────────────────────────────────────────

function formatFinding(finding) {
  return [
    `${finding.severity.label} ${finding.file}:${finding.line}`,
    `   Rule: ${finding.rule} — ${finding.description}`,
    `   Found: ${finding.found}`,
    `   Fix: ${finding.fix}`,
  ].join("\n");
}

function formatSummary(findings) {
  const critical = findings.filter((f) => f.severity.name === "critical").length;
  const warning = findings.filter((f) => f.severity.name === "warning").length;
  const info = findings.filter((f) => f.severity.name === "info").length;
  return [
    "",
    "─".repeat(60),
    `Summary: ${findings.length} finding(s)`,
    `  🔴 Critical: ${critical}`,
    `  🟡 Warning:  ${warning}`,
    `  ⚪ Info:     ${info}`,
    "",
  ].join("\n");
}

function formatLimitations() {
  return [
    "─".repeat(60),
    "⚠️  Limitations — What this tool CANNOT detect:",
    "",
    "  1. Full platform guard detection requires AST analysis.",
    "     This tool uses brace-counting heuristics which may miss",
    "     complex guard patterns (ternaries, early returns, etc.).",
    "",
    "  2. Dynamic command strings — exec(userProvidedCommand) can't",
    "     be checked statically.",
    "",
    "  3. Transitive dependency issues — if a library internally",
    "     uses Unix-only APIs, this tool can't detect it.",
    "",
    "  4. Shell script contents — .sh files referenced from code",
    "     or package.json are not analyzed.",
    "",
    "  5. Binary existence on PATH — whether git, node, cortex etc.",
    "     resolve correctly on Windows depends on installation.",
    "",
    "  6. Runtime path construction — path.join(baseDir, 'path')",
    "     is fine, but if baseDir comes from a config with hardcoded",
    "     Unix paths, this tool can't see that.",
    "─".repeat(60),
  ].join("\n");
}

// ─── Simple glob matching ──────────────────────────────────────────────────────

function matchGlob(filePath, pattern) {
  // Simple glob: supports * and ** and ?
  // Convert glob to regex
  const normalized = filePath.replace(/\\/g, "/");
  let regexStr = pattern
    .replace(/\\/g, "/")
    .replace(/[.+^${}()|[\]]/g, "\\$&")  // escape regex chars except * and ?
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(normalized) ||
    new RegExp(`(^|/)${regexStr}($|/)`).test(normalized);
}

// ─── CLI parsing ───────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
Windows Compatibility Lint Script
==================================

Scans TypeScript/JavaScript files for patterns that commonly break on Windows.
Based on real issues found across 3 waves of Windows compatibility fixes.

Usage:
  node scripts/check-windows-compat.mjs <path>           Scan file or directory
  node scripts/check-windows-compat.mjs --git-diff       Scan files changed vs HEAD
  node scripts/check-windows-compat.mjs --git-staged     Scan staged files only

Options:
  --json                Output JSON array of findings (for CI)
  --severity <level>    Filter by severity: critical, warning, info
  --ignore <pattern>    Glob pattern to exclude (can be repeated)
  --exclude-rules <ids> Comma-separated rule IDs to disable
  --help                Show this help message

Exit codes:
  0  No critical findings
  1  One or more critical findings
  2  Script error (e.g., git not available)

Rules (13 total):
  🔴 Critical (4):  unix-command, dev-null, shell-fallback-unix, npm-spawn-no-shell
  🟡 Warning  (6):  missing-windowsHide, user-env-no-fallback, home-env-no-fallback,
                     path-split-slash, npm-scripts-unix, hardcoded-unix-paths
  ⚪ Info     (3):  signal-handling, path-delimiter, fs-unix-apis
`);
}

function parseArgs(argv) {
  const args = {
    targets: [],
    gitDiff: false,
    gitStaged: false,
    json: false,
    severity: null,
    ignorePatterns: [],
    excludeRules: [],
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--git-diff":
        args.gitDiff = true;
        break;
      case "--git-staged":
        args.gitStaged = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--severity":
        i++;
        args.severity = argv[i];
        break;
      case "--ignore":
        i++;
        args.ignorePatterns.push(argv[i]);
        break;
      case "--exclude-rules":
        i++;
        args.excludeRules.push(...argv[i].split(",").map((s) => s.trim()));
        break;
      default:
        if (!arg.startsWith("--")) {
          args.targets.push(arg);
        } else {
          console.error(`Unknown option: ${arg}`);
          process.exit(2);
        }
    }
    i++;
  }

  return args;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Collect files to scan
  let files = [];

  if (args.gitDiff) {
    files = getGitDiffFiles(false);
  } else if (args.gitStaged) {
    files = getGitDiffFiles(true);
  } else if (args.targets.length > 0) {
    for (const target of args.targets) {
      if (!fs.existsSync(target)) {
        console.error(`Error: Path not found: ${target}`);
        process.exit(2);
      }
      files.push(...collectFiles(target));
    }
  } else {
    printHelp();
    process.exit(0);
  }

  // Apply ignore patterns
  if (args.ignorePatterns.length > 0) {
    files = files.filter((f) => {
      return !args.ignorePatterns.some((pattern) => matchGlob(f, pattern));
    });
  }

  if (files.length === 0) {
    if (!args.json) {
      console.log("No files to scan.");
    } else {
      console.log("[]");
    }
    process.exit(0);
  }

  // Filter rules by severity if requested
  let activeRules = RULES;
  if (args.severity) {
    activeRules = RULES.filter((r) => r.severity.name === args.severity);
    if (activeRules.length === 0) {
      console.error(`Error: Unknown severity "${args.severity}". Use: critical, warning, info`);
      process.exit(2);
    }
  }

  // Exclude specific rules if requested
  if (args.excludeRules.length > 0) {
    const excludeSet = new Set(args.excludeRules);
    activeRules = activeRules.filter((r) => !excludeSet.has(r.id));
  }

  // Scan all files
  let allFindings = [];
  for (const file of files) {
    const findings = scanFile(file, activeRules);
    allFindings.push(...findings);
  }

  // JSON output
  if (args.json) {
    const jsonFindings = allFindings.map((f) => ({
      file: f.file,
      line: f.line,
      severity: f.severity.name,
      rule: f.rule,
      description: f.description,
      found: f.found,
      fix: f.fix,
    }));
    console.log(JSON.stringify(jsonFindings, null, 2));
    const hasCritical = allFindings.some((f) => f.severity.name === "critical");
    process.exit(hasCritical ? 1 : 0);
  }

  // Human-readable output
  if (allFindings.length === 0) {
    console.log(`✅ No Windows compatibility issues found in ${files.length} file(s).`);
    console.log(formatLimitations());
    process.exit(0);
  }

  // Sort by severity (critical first), then by file
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  allFindings.sort((a, b) => {
    const sevDiff = severityOrder[a.severity.name] - severityOrder[b.severity.name];
    if (sevDiff !== 0) return sevDiff;
    return a.file.localeCompare(b.file) || a.line - b.line;
  });

  // Print findings
  for (const finding of allFindings) {
    console.log(formatFinding(finding));
    console.log("");
  }

  console.log(formatSummary(allFindings));
  console.log(`Scanned ${files.length} file(s).`);
  console.log(formatLimitations());

  const hasCritical = allFindings.some((f) => f.severity.name === "critical");
  process.exit(hasCritical ? 1 : 0);
}

main();