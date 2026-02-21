#!/usr/bin/env node
'use strict';

/**
 * intent-server.js — Remote daemon for managing auggie on SSH hosts.
 *
 * Plain JavaScript, no npm dependencies. Uses only Node.js built-ins.
 *
 * Commands:
 *   start    --workspace <id> --command <cmd> [--args <json>] [--auggie-path <path>]
 *   serve    --workspace <id>
 *   relay    --workspace <id>
 *   status   --workspace <id>
 *   stop     --workspace <id>
 *   discover                   (finds auggie on this host; no --workspace needed)
 *   watch    --workspace <id> [--base-path <path>]
 *
 * Layout on remote host:
 *   ~/.intent-server/workspaces/{id}/
 *     acp.sock      — Unix domain socket for ACP JSON-RPC (auggie relay)
 *     rpc.sock      — Unix domain socket for general-purpose RPC
 *     auggie.pid    — PID of the auggie child process
 *     daemon.pid    — PID of the daemon (this script in "start" mode)
 *     rpc-serve.pid — PID of the serve-only daemon (this script in "serve" mode)
 *     crash.log     — last crash info (if any)
 *     status.json   — machine-readable status
 */

const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const BASE_DIR = path.join(os.homedir(), '.intent-server');

function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function workspaceDir(workspaceId) {
  return path.join(BASE_DIR, 'workspaces', workspaceId);
}

function socketPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'acp.sock');
}

function rpcSocketPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'rpc.sock');
}

function auggiePidPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'auggie.pid');
}

function daemonPidPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'daemon.pid');
}

function rpcServePidPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'rpc-serve.pid');
}

function crashLogPath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'crash.log');
}

function statusFilePath(workspaceId) {
  return path.join(workspaceDir(workspaceId), 'status.json');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readPid(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeStatus(workspaceId, status) {
  const filePath = statusFilePath(workspaceId);
  fs.writeFileSync(filePath, JSON.stringify(status, null, 2) + '\n');
}

function log(msg) {
  const ts = new Date().toISOString();
  fs.appendFileSync(
    path.join(BASE_DIR, 'intent-server.log'),
    `[${ts}] ${msg}\n`
  );
}

// ---------------------------------------------------------------------------
// Argument parsing (minimal, no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// JSON-RPC newline-delimited framing
// ---------------------------------------------------------------------------

/**
 * Creates a line-based message parser.
 * Calls `onMessage(line)` for each complete newline-delimited line.
 * Handles partial reads and multiple messages in a single chunk.
 */
function createLineParser(onMessage) {
  let buffer = '';
  return function feed(chunk) {
    buffer += chunk;
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        onMessage(line);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// RPC method handlers
// ---------------------------------------------------------------------------

/**
 * exec — Run a shell command and return stdout/stderr/exitCode.
 * params: { command: string, cwd?: string, env?: object, timeout?: number }
 */
function rpcExec(params) {
  return new Promise((resolve) => {
    if (!params || typeof params.command !== 'string') {
      return resolve({ error: { code: -32602, message: 'Invalid params: "command" (string) is required' } });
    }

    let cwd = params.cwd || process.cwd();
    if (cwd.startsWith('~')) {
      cwd = cwd.replace(/^~/, os.homedir());
    }

    const timeout = typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout : 30000;
    const env = params.env ? { ...process.env, ...params.env } : process.env;

    const child = spawn('sh', ['-c', params.command], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let bufferExceeded = false;
    const MAX_OUTPUT = 10 * 1024 * 1024; // 10 MB

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeout);

    child.stdout.on('data', (chunk) => {
      if (!bufferExceeded) {
        stdout += chunk.toString();
        if (stdout.length > MAX_OUTPUT) {
          bufferExceeded = true;
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      if (!bufferExceeded) {
        stderr += chunk.toString();
        if (stderr.length > MAX_OUTPUT) {
          bufferExceeded = true;
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ error: { code: -32000, message: `Exec error: ${err.message}`, data: { stdout, stderr, exitCode: -1 } } });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (bufferExceeded) {
        resolve({ error: { code: -32000, message: 'Output exceeded 10 MB limit', data: { stdout: stdout.slice(0, 1000), stderr: stderr.slice(0, 1000), exitCode: -1, bufferExceeded: true } } });
      } else if (killed) {
        resolve({ error: { code: -32000, message: 'Command timed out', data: { stdout, stderr, exitCode: -1, timedOut: true } } });
      } else if (code !== 0) {
        resolve({ error: { code: -32000, message: `Command exited with code ${code}`, data: { stdout, stderr, exitCode: code } } });
      } else {
        resolve({ result: { stdout, stderr, exitCode: 0 } });
      }
    });
  });
}

/**
 * readFile — Read a file's contents.
 * params: { path: string, encoding?: "utf-8"|"base64", maxSize?: number }
 */
function rpcReadFile(params) {
  if (!params || typeof params.path !== 'string') {
    return { error: { code: -32602, message: 'Invalid params: "path" (string) is required' } };
  }

  let filePath = params.path;
  if (filePath.startsWith('~')) {
    filePath = filePath.replace(/^~/, os.homedir());
  }

  const encoding = params.encoding === 'base64' ? 'base64' : 'utf-8';
  const maxSize = typeof params.maxSize === 'number' && params.maxSize > 0 ? params.maxSize : 10 * 1024 * 1024; // 10MB default

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { error: { code: -32000, message: 'Not a file', data: { path: filePath } } };
    }

    const truncated = stat.size > maxSize;
    let content;
    if (truncated) {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(maxSize);
      fs.readSync(fd, buf, 0, maxSize, 0);
      fs.closeSync(fd);
      content = encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8');
    } else {
      const buf = fs.readFileSync(filePath);
      content = encoding === 'base64' ? buf.toString('base64') : buf.toString('utf8');
    }

    return { result: { content, size: stat.size, truncated } };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { error: { code: -32000, message: 'File not found', data: { path: filePath } } };
    }
    return { error: { code: -32000, message: err.message, data: { path: filePath } } };
  }
}

/**
 * writeFile — Write content to a file.
 * params: { path: string, content: string, encoding?: "utf-8"|"base64", mkdirp?: boolean }
 */
function rpcWriteFile(params) {
  if (!params || typeof params.path !== 'string' || typeof params.content !== 'string') {
    return { error: { code: -32602, message: 'Invalid params: "path" (string) and "content" (string) are required' } };
  }

  let filePath = params.path;
  if (filePath.startsWith('~')) {
    filePath = filePath.replace(/^~/, os.homedir());
  }

  const encoding = params.encoding === 'base64' ? 'base64' : 'utf-8';

  try {
    if (params.mkdirp) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    const buf = encoding === 'base64' ? Buffer.from(params.content, 'base64') : params.content;
    fs.writeFileSync(filePath, buf);
    return { result: { ok: true } };
  } catch (err) {
    return { error: { code: -32000, message: err.message, data: { path: filePath } } };
  }
}

/**
 * fileExists — Check if a path exists and its type.
 * params: { path: string }
 */
function rpcFileExists(params) {
  if (!params || typeof params.path !== 'string') {
    return { error: { code: -32602, message: 'Invalid params: "path" (string) is required' } };
  }

  let filePath = params.path;
  if (filePath.startsWith('~')) {
    filePath = filePath.replace(/^~/, os.homedir());
  }

  try {
    const stat = fs.statSync(filePath);
    return { result: { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() } };
  } catch {
    return { result: { exists: false, isFile: false, isDirectory: false } };
  }
}

/**
 * stat — Get file/directory metadata.
 * params: { path: string }
 */
function rpcStat(params) {
  if (!params || typeof params.path !== 'string') {
    return { error: { code: -32602, message: 'Invalid params: "path" (string) is required' } };
  }

  let filePath = params.path;
  if (filePath.startsWith('~')) {
    filePath = filePath.replace(/^~/, os.homedir());
  }

  try {
    const lstat = fs.lstatSync(filePath);
    const isSymlink = lstat.isSymbolicLink();
    const stat = isSymlink ? fs.statSync(filePath) : lstat;
    return {
      result: {
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymlink,
        permissions: '0' + (stat.mode & 0o777).toString(8),
      },
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { error: { code: -32000, message: 'Path not found', data: { path: filePath } } };
    }
    return { error: { code: -32000, message: err.message, data: { path: filePath } } };
  }
}

/**
 * listDir — List directory entries.
 * params: { path: string, includeHidden?: boolean }
 */
function rpcListDir(params) {
  if (!params || typeof params.path !== 'string') {
    return { error: { code: -32602, message: 'Invalid params: "path" (string) is required' } };
  }

  let dirPath = params.path;
  if (dirPath.startsWith('~')) {
    dirPath = dirPath.replace(/^~/, os.homedir());
  }

  const includeHidden = params.includeHidden === true;

  try {
    const names = fs.readdirSync(dirPath);
    const entries = [];
    for (const name of names) {
      if (!includeHidden && name.startsWith('.')) continue;
      try {
        const fullPath = path.join(dirPath, name);
        const stat = fs.statSync(fullPath);
        entries.push({
          name,
          type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other',
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      } catch {
        // Skip entries we can't stat (e.g. broken symlinks)
        entries.push({ name, type: 'unknown', size: 0, mtime: null });
      }
    }
    return { result: { entries } };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { error: { code: -32000, message: 'Directory not found', data: { path: dirPath } } };
    }
    if (err.code === 'ENOTDIR') {
      return { error: { code: -32000, message: 'Not a directory', data: { path: dirPath } } };
    }
    return { error: { code: -32000, message: err.message, data: { path: dirPath } } };
  }
}

/**
 * search — Search for text in files using ripgrep (preferred) or grep (fallback).
 * params: { query: string, path: string, options?: { caseSensitive?: boolean, regex?: boolean, maxResults?: number, includePattern?: string, excludePattern?: string, contextLines?: number } }
 */
function rpcSearch(params) {
  const { execSync } = require('child_process');

  if (!params || typeof params.query !== 'string' || !params.query) {
    return { error: { code: -32602, message: 'Invalid params: "query" (non-empty string) is required' } };
  }
  if (!params.path || typeof params.path !== 'string') {
    return { error: { code: -32602, message: 'Invalid params: "path" (string) is required' } };
  }

  let searchPath = params.path;
  if (searchPath.startsWith('~')) {
    searchPath = searchPath.replace(/^~/, os.homedir());
  }

  const opts = params.options || {};
  const caseSensitive = opts.caseSensitive === true;
  const useRegex = opts.regex === true;
  const maxResults = typeof opts.maxResults === 'number' && opts.maxResults > 0 ? opts.maxResults : 200;
  const includePattern = typeof opts.includePattern === 'string' ? opts.includePattern : null;
  const excludePattern = typeof opts.excludePattern === 'string' ? opts.excludePattern : null;
  const contextLines = typeof opts.contextLines === 'number' && opts.contextLines >= 0 ? opts.contextLines : 0;



  // --- Try ripgrep first ---
  try {
    const rgArgs = ['--json'];
    rgArgs.push('--max-count', String(maxResults));
    rgArgs.push(caseSensitive ? '--case-sensitive' : '--ignore-case');
    if (!useRegex) {
      rgArgs.push('--fixed-strings');
    }
    if (includePattern) {
      rgArgs.push('-g', includePattern);
    }
    if (excludePattern) {
      rgArgs.push('-g', '!' + excludePattern);
    } else {
      // Default exclusions
      rgArgs.push('-g', '!.git', '-g', '!node_modules', '-g', '!bazel-*', '-g', '!.bazel');
    }
    if (contextLines > 0) {
      rgArgs.push('-C', String(contextLines));
    }
    rgArgs.push('--', shellEscape(params.query), shellEscape(searchPath));

    const rgCmd = 'rg ' + rgArgs.join(' ');
    let stdout;
    try {
      stdout = execSync(rgCmd, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (execErr) {
      // Exit code 1 = no matches (not an error)
      if (execErr.status === 1 && execErr.stdout !== undefined) {
        return { result: { results: [], truncated: false } };
      }
      // ENOENT or command not found — fall through to grep
      if (execErr.code === 'ENOENT' || (execErr.stderr && execErr.stderr.includes('not found'))) {
        throw new Error('rg not found');
      }
      // Other rg error
      throw execErr;
    }

    // Parse ripgrep JSON output
    const results = [];
    const contextMap = new Map(); // path:line -> { before: [], after: [] }
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type === 'match' && entry.data) {
        const d = entry.data;
        const filePath = d.path && d.path.text ? d.path.text : '';
        const relFile = path.relative(searchPath, filePath);
        const lineNumber = d.line_number || 0;
        const lineText = d.lines && d.lines.text ? d.lines.text.replace(/\n$/, '') : '';
        // Get column from first submatch
        const column = d.submatches && d.submatches.length > 0 ? (d.submatches[0].start || 0) + 1 : 1;
        const result = {
          file: relFile,
          line: lineNumber,
          column: column,
          match: lineText.trim(),
        };
        if (contextLines > 0) {
          result.context = { before: [], after: [] };
        }
        results.push(result);
      } else if (contextLines > 0 && entry.type === 'context' && entry.data) {
        // Context lines come before/after match entries — we'll handle them simply
        // by attaching to the nearest match. Ripgrep JSON context handling is complex,
        // so we skip detailed context assembly for now and rely on the match lines.
      }
    }

    const truncated = results.length >= maxResults;
    return { result: { results: results.slice(0, maxResults), truncated } };
  } catch (rgError) {
    // ripgrep not available — fall through to grep
  }

  // --- Fallback to grep ---
  try {
    const grepArgs = ['-rn'];
    grepArgs.push('--max-count=' + String(maxResults));
    if (!caseSensitive) {
      grepArgs.push('-i');
    }
    if (useRegex) {
      grepArgs.push('-E');
    } else {
      grepArgs.push('-F');
    }
    if (includePattern) {
      grepArgs.push("--include=" + shellEscape(includePattern));
    }
    if (excludePattern) {
      grepArgs.push("--exclude=" + shellEscape(excludePattern));
    }
    // Always exclude common dirs
    grepArgs.push("--exclude-dir='.git'", "--exclude-dir='node_modules'", "--exclude-dir='bazel-*'", "--exclude-dir='.bazel'");
    if (contextLines > 0) {
      grepArgs.push('-C', String(contextLines));
    }
    grepArgs.push('--', shellEscape(params.query), shellEscape(searchPath));

    const grepCmd = 'grep ' + grepArgs.join(' ');
    let stdout;
    try {
      stdout = execSync(grepCmd, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (execErr) {
      // Exit code 1 = no matches
      if (execErr.status === 1) {
        return { result: { results: [], truncated: false } };
      }
      throw execErr;
    }

    // Parse grep output: file:line:content (or file-line-content for context)
    const results = [];
    const grepLines = stdout.split('\n');
    for (const grepLine of grepLines) {
      if (!grepLine) continue;
      // Skip context separators
      if (grepLine === '--') continue;
      // Match pattern: file:line:content
      const match = grepLine.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        const filePath = match[1];
        const lineNumber = parseInt(match[2], 10);
        const content = match[3];
        const relFile = path.relative(searchPath, filePath);

        // Find column (first occurrence of query in the line)
        let column = 1;
        if (!useRegex) {
          const idx = caseSensitive
            ? content.indexOf(params.query)
            : content.toLowerCase().indexOf(params.query.toLowerCase());
          if (idx >= 0) column = idx + 1;
        }

        results.push({
          file: relFile,
          line: lineNumber,
          column: column,
          match: content.trim(),
        });

        if (results.length >= maxResults) break;
      }
    }

    const truncated = results.length >= maxResults;
    return { result: { results, truncated } };
  } catch (grepError) {
    return { error: { code: -32000, message: 'Search failed: both rg and grep unavailable or errored', data: { message: grepError.message } } };
  }
}

// ---------------------------------------------------------------------------
// RPC dispatch and server
// ---------------------------------------------------------------------------

/**
 * Dispatch a JSON-RPC 2.0 request to the appropriate handler.
 * Returns a JSON-RPC 2.0 response object (or null for notifications).
 */
async function handleRpcRequest(request) {
  // Validate JSON-RPC 2.0 structure
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return {
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Invalid Request' },
      id: (request && request.id) || null,
    };
  }

  const { method, params, id } = request;

  // Notifications (no id) — we don't support any, but don't error
  if (id === undefined || id === null) {
    return null;
  }

  let response;
  switch (method) {
    case 'exec':
      response = await rpcExec(params);
      break;
    case 'readFile':
      response = rpcReadFile(params);
      break;
    case 'writeFile':
      response = rpcWriteFile(params);
      break;
    case 'fileExists':
      response = rpcFileExists(params);
      break;
    case 'stat':
      response = rpcStat(params);
      break;
    case 'listDir':
      response = rpcListDir(params);
      break;
    case 'search':
      response = rpcSearch(params);
      break;
    case 'watchSubscribe':
      response = rpcWatchSubscribe(params);
      break;
    case 'gitStatus':
      response = rpcGitStatus(params);
      break;
    case 'gitDiff':
      response = rpcGitDiff(params);
      break;
    case 'initialize':
      response = rpcInitialize();
      break;
    default:
      response = { error: { code: -32601, message: `Method not found: ${method}` } };
      break;
  }

  if (response.error) {
    return { jsonrpc: '2.0', error: response.error, id };
  }
  return { jsonrpc: '2.0', result: response.result, id };
}

// ---------------------------------------------------------------------------
// RPC: watchSubscribe — file-watcher subscription via notifications
// ---------------------------------------------------------------------------

/** Active watch subscriptions keyed by subscriptionId. */
const watchSubscriptions = new Map();

function rpcWatchSubscribe(params) {
  if (!params || typeof params.basePath !== 'string') {
    return { error: { code: -32602, message: 'Missing required param: basePath' } };
  }

  const { execSync } = require('child_process');
  const basePath = params.basePath.startsWith('~')
    ? params.basePath.replace(/^~/, os.homedir())
    : path.resolve(params.basePath);

  if (!fs.existsSync(basePath)) {
    return { error: { code: -32602, message: `basePath does not exist: ${basePath}` } };
  }

  const subscriptionId = `watch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // --- Patterns to ignore (same as cmdWatch) ---
  const IGNORE_PATTERNS = [
    /^\.git\//,
    /[\/\\]\.git[\/\\]/,
    /^node_modules\//,
    /[\/\\]node_modules[\/\\]/,
    /^\.bazel\//,
    /[\/\\]\.bazel[\/\\]/,
    /^bazel-/,
  ];

  function shouldIgnore(filePath) {
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(filePath)) return true;
    }
    return false;
  }

  function statusToAction(code) {
    switch (code) {
      case 'A': return 'Create';
      case 'M': return 'Modify';
      case 'D': return 'Delete';
      case 'R': return 'Rename';
      case '??': return 'Create';
      case '!!': return null;
      default: return 'Modify';
    }
  }

  function gitExec(args) {
    try {
      return execSync(`git ${args}`, {
        cwd: basePath,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  }

  function parseNumstat(output) {
    const stats = {};
    if (!output) return stats;
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      let filePath = parts.slice(2).join('\t');
      const renameMatch = filePath.match(/\{(.+?) => (.+?)\}/);
      if (renameMatch) {
        filePath = filePath.replace(/\{.+? => (.+?)\}/, '$1');
      } else if (filePath.includes(' => ')) {
        filePath = filePath.split(' => ').pop();
      }
      stats[filePath] = { additions: adds, deletions: dels };
    }
    return stats;
  }

  function countLines(filePath) {
    try {
      const fullPath = path.join(basePath, filePath);
      const content = fs.readFileSync(fullPath, 'utf8');
      return content.split('\n').length;
    } catch {
      return 0;
    }
  }

  function emitChanges() {
    const porcelain = gitExec('status --porcelain');
    if (porcelain == null) return;
    if (porcelain.trim() === '') return;

    // IMPORTANT: Use trimEnd() not trim() — trim() strips leading whitespace which
    // corrupts the first status line's index/workTree status characters (e.g. " M" → "M").
    const statusLines = porcelain.trimEnd().split('\n');
    const fileEntries = [];

    for (const line of statusLines) {
      if (!line || line.length < 4) continue;
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      let filePath = line.slice(3);

      // DEBUG: Log raw RPC watcher git status parsing
      log(`[rpcWatch] Parsing git status line: raw="${line}", len=${line.length}, indexStatus="${indexStatus}", workTreeStatus="${workTreeStatus}", filePath="${filePath}"`);

      if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop();
      if (shouldIgnore(filePath)) continue;

      if (indexStatus !== ' ' && indexStatus !== '?') {
        fileEntries.push({ path: filePath, code: indexStatus, stage: 'staged' });
      }
      if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
        fileEntries.push({ path: filePath, code: workTreeStatus, stage: 'unstaged' });
      }
      if (indexStatus === '?' && workTreeStatus === '?') {
        fileEntries.push({ path: filePath, code: '??', stage: 'unstaged' });
      }
    }

    if (fileEntries.length === 0) return;

    const unstagedNumstat = parseNumstat(gitExec('diff --numstat'));
    const stagedNumstat = parseNumstat(gitExec('diff --numstat --cached'));

    const files = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const entry of fileEntries) {
      const action = statusToAction(entry.code);
      if (!action) continue;

      let additions = 0;
      let deletions = 0;

      if (entry.stage === 'staged') {
        const stats = stagedNumstat[entry.path];
        if (stats) { additions = stats.additions; deletions = stats.deletions; }
      } else {
        const stats = unstagedNumstat[entry.path];
        if (stats) { additions = stats.additions; deletions = stats.deletions; }
        else if (entry.code === '??' || action === 'Create') { additions = countLines(entry.path); }
      }

      files.push({ path: entry.path, action, additions, deletions, stage: entry.stage });
      totalAdditions += additions;
      totalDeletions += deletions;
    }

    if (files.length === 0) return;

    // DEBUG: Log RPC watcher emitting files
    if (files.length > 0) {
      log(`[rpcWatch] Emitting watch/changes: ${files.length} files, first file path: "${files[0]?.path}"`);
    }

    sendNotification('watch/changes', {
      subscriptionId,
      files,
      summary: { filesChanged: files.length, additions: totalAdditions, deletions: totalDeletions },
      timestamp: new Date().toISOString(),
    });
  }

  // Debounce mechanism
  let debounceTimer = null;
  function scheduleEmit() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; emitChanges(); }, 300);
  }

  // Try fs.watch with recursive option; fall back to polling
  let watcher = null;
  let pollInterval = null;

  function startFsWatch() {
    try {
      watcher = fs.watch(basePath, { recursive: true }, (eventType, filename) => {
        if (filename && shouldIgnore(filename)) return;
        scheduleEmit();
      });
      watcher.on('error', () => {
        try { watcher.close(); } catch { /* ignore */ }
        watcher = null;
        startPolling();
      });
      return true;
    } catch {
      return false;
    }
  }

  function startPolling() {
    let lastStatus = '';
    pollInterval = setInterval(() => {
      const currentStatus = gitExec('status --porcelain');
      if (currentStatus != null && currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        emitChanges();
      }
    }, 2000);
  }

  function cleanup() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
    if (pollInterval) clearInterval(pollInterval);
    watchSubscriptions.delete(subscriptionId);
  }

  // Start watching
  if (!startFsWatch()) {
    startPolling();
  }

  watchSubscriptions.set(subscriptionId, { cleanup });

  // Emit initial state
  emitChanges();

  return { result: { subscriptionId } };
}

// ---------------------------------------------------------------------------
// RPC: gitStatus — structured git status
// ---------------------------------------------------------------------------

function rpcGitStatus(params) {
  if (!params || typeof params.cwd !== 'string') {
    return { error: { code: -32602, message: 'Missing required param: cwd' } };
  }

  const { execSync } = require('child_process');
  const cwd = params.cwd.startsWith('~')
    ? params.cwd.replace(/^~/, os.homedir())
    : path.resolve(params.cwd);

  function gitExec(args) {
    try {
      return execSync(`git ${args}`, {
        cwd,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  }

  // Parse branch + tracking info from `git status --porcelain -b`
  const raw = gitExec('status --porcelain -b');
  if (raw == null) {
    return { error: { code: -32603, message: 'git status failed' } };
  }

  const lines = raw.split('\n');
  let branch = '';
  let ahead = 0;
  let behind = 0;
  const files = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Parse branch header: "## main...origin/main [ahead 1, behind 2]"
      const branchLine = line.slice(3);
      const dotIndex = branchLine.indexOf('...');
      if (dotIndex !== -1) {
        branch = branchLine.slice(0, dotIndex);
        const tracking = branchLine.slice(dotIndex + 3);
        const aheadMatch = tracking.match(/ahead (\d+)/);
        const behindMatch = tracking.match(/behind (\d+)/);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) behind = parseInt(behindMatch[1], 10);
      } else {
        branch = branchLine.trim();
      }
      continue;
    }

    if (!line || line.length < 4) continue;
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    let filePath = line.slice(3);
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop();

    files.push({ path: filePath, indexStatus, workTreeStatus });
  }

  return { result: { branch, ahead, behind, files } };
}

// ---------------------------------------------------------------------------
// RPC: gitDiff — structured git diff --numstat
// ---------------------------------------------------------------------------

function rpcGitDiff(params) {
  if (!params || typeof params.cwd !== 'string') {
    return { error: { code: -32602, message: 'Missing required param: cwd' } };
  }

  const { execSync } = require('child_process');
  const cwd = params.cwd.startsWith('~')
    ? params.cwd.replace(/^~/, os.homedir())
    : path.resolve(params.cwd);

  let args = 'diff --numstat';
  if (params.cached) args += ' --cached';
  if (params.path) args += ` -- ${shellEscape(params.path)}`;

  let output;
  try {
    output = execSync(`git ${args}`, {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return { error: { code: -32603, message: 'git diff failed' } };
  }

  const files = [];
  if (output && output.trim()) {
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      let filePath = parts.slice(2).join('\t');
      const renameMatch = filePath.match(/\{(.+?) => (.+?)\}/);
      if (renameMatch) {
        filePath = filePath.replace(/\{.+? => (.+?)\}/, '$1');
      } else if (filePath.includes(' => ')) {
        filePath = filePath.split(' => ').pop();
      }
      files.push({ path: filePath, additions, deletions });
    }
  }

  return { result: { files } };
}

// ---------------------------------------------------------------------------
// RPC: initialize — capability negotiation
// ---------------------------------------------------------------------------

function rpcInitialize() {
  return {
    result: {
      serverVersion: '1.0',
      capabilities: {
        methods: [
          'exec', 'readFile', 'writeFile', 'fileExists', 'stat', 'listDir',
          'search', 'watchSubscribe', 'gitStatus', 'gitDiff', 'initialize',
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Notification plumbing + RPC server
// ---------------------------------------------------------------------------

/** The currently connected RPC client socket (single-client model). */
let rpcClientSocket = null;

/**
 * Send a JSON-RPC 2.0 notification (no `id` field) to the connected client.
 * Silently no-ops if no client is connected.
 */
function sendNotification(method, params) {
  if (!rpcClientSocket) return;
  const msg = { jsonrpc: '2.0', method, params };
  try { rpcClientSocket.write(JSON.stringify(msg) + '\n'); } catch { /* ignore */ }
}

function createRpcServer(rpcSock) {
  const rpcServer = net.createServer((client) => {
    log(`RPC client connected`);
    rpcClientSocket = client;

    const parser = createLineParser(async (line) => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        const errResp = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null };
        try { client.write(JSON.stringify(errResp) + '\n'); } catch { /* ignore */ }
        return;
      }

      const response = await handleRpcRequest(request);
      if (response !== null) {
        try { client.write(JSON.stringify(response) + '\n'); } catch { /* ignore */ }
      }
    });

    client.on('data', (chunk) => {
      parser(chunk.toString());
    });

    client.on('close', () => {
      log('RPC client disconnected');
      if (rpcClientSocket === client) rpcClientSocket = null;
    });

    client.on('error', (err) => {
      log(`RPC client error: ${err.message}`);
      if (rpcClientSocket === client) rpcClientSocket = null;
    });
  });

  rpcServer.on('error', (err) => {
    log(`RPC server error: ${err.message}`);
  });

  return rpcServer;
}

// ---------------------------------------------------------------------------
// COMMAND: start
// ---------------------------------------------------------------------------

function cmdStart(workspaceId, opts) {
  const command = opts.command;
  if (!command) {
    process.stderr.write('Error: --command is required for start\n');
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Double-spawn daemon pattern
  // -----------------------------------------------------------------------
  // When run without --daemonize (the normal case via SSH), we are the
  // "parent" process inside the SSH channel.  We spawn a detached child copy
  // of ourselves with --daemonize, wait for its first stdout line (the JSON
  // status), relay that line to our own stdout, then exit(0) so the SSH
  // channel closes promptly.
  //
  // The child (--daemonize) runs the real daemon logic below.
  // -----------------------------------------------------------------------

  if (!opts.daemonize) {
    const childArgs = [__filename, ...process.argv.slice(2), '--daemonize'];
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let responded = false;

    // 15-second timeout waiting for the daemon's JSON response
    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        process.stderr.write('Error: Daemon failed to start within 15 seconds\n');
        try { child.kill(); } catch { /* ignore */ }
        process.exit(1);
      }
    }, 15000);

    // Read the first complete line from child stdout (the JSON response)
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      if (responded) return;
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        responded = true;
        clearTimeout(timeout);
        const line = buffer.slice(0, newlineIdx + 1);
        process.stdout.write(line);
        child.stdout.destroy();
        child.unref();
        process.exit(0);
      }
    });

    child.on('error', (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        process.stderr.write(`Error: Failed to spawn daemon: ${err.message}\n`);
        process.exit(1);
      }
    });

    child.on('exit', (code, signal) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        process.stderr.write(
          `Error: Daemon exited unexpectedly: code=${code}, signal=${signal}\n`
        );
        process.exit(1);
      }
    });

    return;
  }

  // -----------------------------------------------------------------------
  // Daemon mode (--daemonize) — runs detached from the SSH channel
  // -----------------------------------------------------------------------

  const dir = workspaceDir(workspaceId);
  mkdirp(dir);
  mkdirp(BASE_DIR);

  // If a serve-only daemon is running, kill it — full start supersedes serve
  const existingServePid = readPid(rpcServePidPath(workspaceId));
  if (isProcessAlive(existingServePid)) {
    log(`Killing serve daemon (pid ${existingServePid}) before full start`);
    try { process.kill(existingServePid, 'SIGTERM'); } catch { /* ignore */ }
    // Wait up to 5 seconds for serve daemon to exit
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && isProcessAlive(existingServePid)) {
      const { execSync } = require('child_process');
      try { execSync('sleep 0.1', { stdio: 'ignore' }); } catch { /* ignore */ }
    }
    if (isProcessAlive(existingServePid)) {
      log(`Force-killing serve daemon (pid ${existingServePid})`);
      try { process.kill(existingServePid, 'SIGKILL'); } catch { /* ignore */ }
    }
    // Clean up stale PID file
    try { fs.unlinkSync(rpcServePidPath(workspaceId)); } catch { /* ignore */ }
  }

  // Check if daemon is already running for this workspace
  const existingDaemonPid = readPid(daemonPidPath(workspaceId));
  if (isProcessAlive(existingDaemonPid)) {
    process.stderr.write(
      `Daemon already running for workspace ${workspaceId} (pid ${existingDaemonPid})\n`
    );
    process.exit(1);
  }

  // Clean up stale sockets
  const sock = socketPath(workspaceId);
  const rpcSock = rpcSocketPath(workspaceId);
  try { fs.unlinkSync(sock); } catch { /* ignore */ }
  try { fs.unlinkSync(rpcSock); } catch { /* ignore */ }

  // Parse auggie args
  let augArgs = [];
  if (opts.args) {
    try {
      augArgs = JSON.parse(opts.args);
      if (!Array.isArray(augArgs)) augArgs = [opts.args];
    } catch {
      // Treat as space-separated string
      augArgs = opts.args.split(/\s+/);
    }
  }

  // Resolve auggie command — use --auggie-path if provided, else use --command as-is
  let auggieBin = opts['auggie-path'] || command;

  // Resolve ~ to home directory (Node.js spawn doesn't expand ~)
  if (auggieBin.startsWith('~')) {
    auggieBin = auggieBin.replace(/^~/, os.homedir());
  }

  let cwd = opts.cwd || process.cwd();
  if (cwd.startsWith('~')) {
    cwd = cwd.replace(/^~/, os.homedir());
  }

  log(`Starting auggie: ${auggieBin} ${augArgs.join(' ')} (workspace: ${workspaceId})`);

  // Spawn auggie as a detached child with piped stdio
  const auggie = spawn(auggieBin, augArgs, {
    cwd,
    env: { ...process.env, NODE_NO_READLINE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  if (!auggie.pid) {
    const msg = `Failed to spawn auggie: ${auggieBin}`;
    log(msg);
    fs.writeFileSync(crashLogPath(workspaceId), `${new Date().toISOString()} ${msg}\n`);
    writeStatus(workspaceId, { running: false, error: msg });
    process.stderr.write(msg + '\n');
    process.exit(1);
  }

  // Write PID files
  fs.writeFileSync(auggiePidPath(workspaceId), String(auggie.pid));
  fs.writeFileSync(daemonPidPath(workspaceId), String(process.pid));

  log(`Auggie spawned with pid ${auggie.pid}, daemon pid ${process.pid}`);

  // Track connected relay clients
  const clients = new Set();

  // Buffer for auggie stdout — parse newline-delimited JSON-RPC
  const auggieParser = createLineParser((line) => {
    // Forward each complete message to all connected relay clients
    const msg = line + '\n';
    for (const client of clients) {
      try {
        client.write(msg);
      } catch {
        // Client disconnected, will be cleaned up on 'close'
      }
    }
  });

  auggie.stdout.on('data', (chunk) => {
    auggieParser(chunk.toString());
  });

  // Log auggie stderr to crash log
  auggie.stderr.on('data', (chunk) => {
    fs.appendFileSync(crashLogPath(workspaceId), chunk.toString());
  });

  // Handle auggie exit
  auggie.on('exit', (code, signal) => {
    const msg = `Auggie exited: code=${code}, signal=${signal}`;
    log(msg);
    fs.appendFileSync(crashLogPath(workspaceId), `${new Date().toISOString()} ${msg}\n`);
    writeStatus(workspaceId, {
      running: false,
      exitCode: code,
      signal: signal,
      exitedAt: new Date().toISOString(),
    });

    // Close all relay connections
    for (const client of clients) {
      try { client.destroy(); } catch { /* ignore */ }
    }
    clients.clear();

    // Close RPC server
    try { rpcServer.close(); } catch { /* ignore */ }

    // Clean up sockets and PID files
    try { fs.unlinkSync(sock); } catch { /* ignore */ }
    try { fs.unlinkSync(rpcSock); } catch { /* ignore */ }
    try { fs.unlinkSync(auggiePidPath(workspaceId)); } catch { /* ignore */ }
    try { fs.unlinkSync(daemonPidPath(workspaceId)); } catch { /* ignore */ }

    // Exit the daemon
    process.exit(code || 0);
  });

  auggie.on('error', (err) => {
    const msg = `Auggie spawn error: ${err.message}`;
    log(msg);
    fs.appendFileSync(crashLogPath(workspaceId), `${new Date().toISOString()} ${msg}\n`);
    writeStatus(workspaceId, { running: false, error: msg });
  });

  // Create Unix domain socket server
  const server = net.createServer((client) => {
    log(`Relay client connected (workspace: ${workspaceId})`);
    clients.add(client);

    // Parse newline-delimited JSON-RPC from relay → auggie stdin
    const clientParser = createLineParser((line) => {
      if (auggie.stdin && auggie.stdin.writable) {
        auggie.stdin.write(line + '\n');
      }
    });

    client.on('data', (chunk) => {
      clientParser(chunk.toString());
    });

    client.on('close', () => {
      log(`Relay client disconnected (workspace: ${workspaceId})`);
      clients.delete(client);
    });

    client.on('error', (err) => {
      log(`Relay client error: ${err.message}`);
      clients.delete(client);
    });
  });

  server.on('error', (err) => {
    log(`Socket server error: ${err.message}`);
    writeStatus(workspaceId, { running: false, error: `Socket error: ${err.message}` });
    process.exit(1);
  });

  // Create RPC server
  const rpcServer = createRpcServer(rpcSock);

  server.listen(sock, () => {
    log(`Socket server listening at ${sock}`);

    // Start RPC server after ACP server is ready
    rpcServer.listen(rpcSock, () => {
      const startedAt = new Date().toISOString();
      writeStatus(workspaceId, {
        running: true,
        pid: auggie.pid,
        daemonPid: process.pid,
        socketPath: sock,
        rpcSocketPath: rpcSock,
        startedAt,
        command: auggieBin,
        args: augArgs,
      });

      log(`RPC server listening at ${rpcSock}`);

      // Print status to stdout so the caller knows we're ready
      process.stdout.write(
        JSON.stringify({
          ok: true,
          pid: auggie.pid,
          daemonPid: process.pid,
          socketPath: sock,
          rpcSocketPath: rpcSock,
          startedAt,
        }) + '\n'
      );

      // Detach from parent — close stdio so the SSH channel / parent can exit
      // without killing us. We keep the event loop alive via the socket servers.
      if (typeof process.stdin.unref === 'function') process.stdin.unref();
      if (typeof process.stdout.unref === 'function') process.stdout.unref();
      if (typeof process.stderr.unref === 'function') process.stderr.unref();
    });
  });

  // Handle daemon signals
  process.on('SIGTERM', () => {
    log('Daemon received SIGTERM, shutting down');
    cleanup(workspaceId, auggie, server, rpcServer);
  });

  process.on('SIGINT', () => {
    log('Daemon received SIGINT, shutting down');
    cleanup(workspaceId, auggie, server, rpcServer);
  });
}

function cleanup(workspaceId, auggie, server, rpcServer) {
  // Close socket servers
  try { server.close(); } catch { /* ignore */ }
  try { rpcServer.close(); } catch { /* ignore */ }

  // Kill auggie
  if (auggie && auggie.pid && isProcessAlive(auggie.pid)) {
    try {
      process.kill(auggie.pid, 'SIGTERM');
    } catch { /* ignore */ }

    // Give auggie 5 seconds to exit, then SIGKILL
    setTimeout(() => {
      if (isProcessAlive(auggie.pid)) {
        try { process.kill(auggie.pid, 'SIGKILL'); } catch { /* ignore */ }
      }
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}


// ---------------------------------------------------------------------------
// COMMAND: serve
// ---------------------------------------------------------------------------

function cmdServe(workspaceId, opts) {
  // -----------------------------------------------------------------------
  // Double-spawn daemon pattern (same as cmdStart)
  // -----------------------------------------------------------------------
  if (!opts.daemonize) {
    const childArgs = [__filename, ...process.argv.slice(2), '--daemonize'];
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        process.stderr.write('Error: Serve daemon failed to start within 15 seconds\n');
        try { child.kill(); } catch { /* ignore */ }
        process.exit(1);
      }
    }, 15000);

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      if (responded) return;
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        responded = true;
        clearTimeout(timeout);
        const line = buffer.slice(0, newlineIdx + 1);
        process.stdout.write(line);
        child.stdout.destroy();
        child.unref();
        process.exit(0);
      }
    });

    child.on('error', (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        process.stderr.write(`Error: Failed to spawn serve daemon: ${err.message}\n`);
        process.exit(1);
      }
    });

    child.on('exit', (code, signal) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        process.stderr.write(
          `Error: Serve daemon exited unexpectedly: code=${code}, signal=${signal}\n`
        );
        process.exit(1);
      }
    });

    return;
  }

  // -----------------------------------------------------------------------
  // Daemon mode (--daemonize)
  // -----------------------------------------------------------------------

  const dir = workspaceDir(workspaceId);
  mkdirp(dir);
  mkdirp(BASE_DIR);

  // 1. Check for existing full daemon (daemon.pid + auggie.pid alive) → no-op
  const existingDaemonPid = readPid(daemonPidPath(workspaceId));
  const existingAuggiePid = readPid(auggiePidPath(workspaceId));
  if (isProcessAlive(existingDaemonPid) && isProcessAlive(existingAuggiePid)) {
    log(`[serve] Full daemon already running for workspace ${workspaceId}, no-op`);
    process.stdout.write(
      JSON.stringify({ ok: true, alreadyRunning: true, mode: 'full' }) + '\n'
    );
    process.exit(0);
  }

  // 2. Check for existing serve daemon (rpc-serve.pid alive) → idempotent no-op
  const existingServePid = readPid(rpcServePidPath(workspaceId));
  if (isProcessAlive(existingServePid)) {
    log(`[serve] Serve daemon already running for workspace ${workspaceId}, no-op`);
    process.stdout.write(
      JSON.stringify({ ok: true, alreadyRunning: true, mode: 'serve' }) + '\n'
    );
    process.exit(0);
  }

  // 3. Clean stale rpc.sock if exists
  const rpcSock = rpcSocketPath(workspaceId);
  try { fs.unlinkSync(rpcSock); } catch { /* ignore */ }

  // 4. Create workspace directory (already done above via mkdirp)

  // 5. Create RPC server
  const rpcServer = createRpcServer(rpcSock);

  // 6. Start RPC server listening on rpc.sock
  rpcServer.listen(rpcSock, () => {
    log(`[serve] RPC server listening at ${rpcSock}`);

    // 7. Write PID to rpc-serve.pid
    fs.writeFileSync(rpcServePidPath(workspaceId), String(process.pid));

    // 9. Output status to stdout
    process.stdout.write(
      JSON.stringify({ ok: true, mode: 'serve', pid: process.pid }) + '\n'
    );

    // Detach from parent — close stdio so the SSH channel / parent can exit
    if (typeof process.stdin.unref === 'function') process.stdin.unref();
    if (typeof process.stdout.unref === 'function') process.stdout.unref();
    if (typeof process.stderr.unref === 'function') process.stderr.unref();
  });

  rpcServer.on('error', (err) => {
    log(`[serve] RPC server error: ${err.message}`);
    process.exit(1);
  });

  // 8. Set up SIGTERM/SIGINT handler: close RPC server, unlink rpc.sock and rpc-serve.pid, exit
  function serveCleanup() {
    log(`[serve] Shutting down serve daemon for workspace ${workspaceId}`);
    try { rpcServer.close(); } catch { /* ignore */ }
    try { fs.unlinkSync(rpcSock); } catch { /* ignore */ }
    try { fs.unlinkSync(rpcServePidPath(workspaceId)); } catch { /* ignore */ }
    process.exit(0);
  }

  process.on('SIGTERM', serveCleanup);
  process.on('SIGINT', serveCleanup);
}

// ---------------------------------------------------------------------------
// COMMAND: relay
// ---------------------------------------------------------------------------

function cmdRelay(workspaceId) {
  const sock = socketPath(workspaceId);

  if (!fs.existsSync(sock)) {
    process.stderr.write(
      `Error: No socket found for workspace ${workspaceId}. Is the daemon running?\n`
    );
    process.exit(1);
  }

  const client = net.createConnection({ path: sock }, () => {
    // Connected to daemon socket — pipe stdin ↔ socket ↔ stdout

    // stdin → socket: parse newline-delimited to preserve message boundaries
    const stdinParser = createLineParser((line) => {
      client.write(line + '\n');
    });

    process.stdin.on('data', (chunk) => {
      stdinParser(chunk.toString());
    });

    // socket → stdout: parse newline-delimited to preserve message boundaries
    const socketParser = createLineParser((line) => {
      process.stdout.write(line + '\n');
    });

    client.on('data', (chunk) => {
      socketParser(chunk.toString());
    });
  });

  // When stdin closes (SSH channel dropped), close the socket connection and exit
  process.stdin.on('end', () => {
    client.end();
  });

  process.stdin.on('close', () => {
    client.end();
  });

  // When socket closes, exit the relay
  client.on('end', () => {
    process.exit(0);
  });

  client.on('close', () => {
    process.exit(0);
  });

  client.on('error', (err) => {
    process.stderr.write(`Relay connection error: ${err.message}\n`);
    process.exit(1);
  });

  // Keep stdin in flowing mode
  process.stdin.resume();
}

// ---------------------------------------------------------------------------
// COMMAND: status
// ---------------------------------------------------------------------------

function cmdStatus(workspaceId) {
  const dir = workspaceDir(workspaceId);

  // Read PIDs
  const auggiePid = readPid(auggiePidPath(workspaceId));
  const daemonPid = readPid(daemonPidPath(workspaceId));
  const running = isProcessAlive(auggiePid) && isProcessAlive(daemonPid);

  // Read status file for additional info
  let statusInfo = {};
  try {
    statusInfo = JSON.parse(fs.readFileSync(statusFilePath(workspaceId), 'utf8'));
  } catch { /* ignore */ }

  const startedAt = statusInfo.startedAt || null;
  const uptime = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0;

  const status = {
    running,
    pid: auggiePid,
    daemonPid,
    uptime,
    socketPath: socketPath(workspaceId),
    socketExists: fs.existsSync(socketPath(workspaceId)),
    rpcSocketPath: rpcSocketPath(workspaceId),
    rpcSocketExists: fs.existsSync(rpcSocketPath(workspaceId)),
    startedAt,
    workspaceDir: dir,
  };

  process.stdout.write(JSON.stringify(status, null, 2) + '\n');
  process.exit(running ? 0 : 1);
}

// ---------------------------------------------------------------------------
// COMMAND: stop
// ---------------------------------------------------------------------------

function cmdStop(workspaceId) {
  const auggiePid = readPid(auggiePidPath(workspaceId));
  const daemonPid = readPid(daemonPidPath(workspaceId));

  let stopped = false;

  // First, try to stop the daemon (which will clean up auggie)
  if (isProcessAlive(daemonPid)) {
    log(`Sending SIGTERM to daemon pid ${daemonPid}`);
    try {
      process.kill(daemonPid, 'SIGTERM');
      stopped = true;
    } catch (err) {
      process.stderr.write(`Warning: Failed to signal daemon: ${err.message}\n`);
    }
  }

  // Also directly signal auggie in case daemon is unresponsive
  if (isProcessAlive(auggiePid)) {
    log(`Sending SIGTERM to auggie pid ${auggiePid}`);
    try {
      process.kill(auggiePid, 'SIGTERM');
      stopped = true;
    } catch (err) {
      process.stderr.write(`Warning: Failed to signal auggie: ${err.message}\n`);
    }
  }

  if (!stopped) {
    process.stderr.write(`No running processes found for workspace ${workspaceId}\n`);
  }

  // Wait briefly, then force-kill if still alive
  setTimeout(() => {
    if (isProcessAlive(auggiePid)) {
      log(`Force-killing auggie pid ${auggiePid}`);
      try { process.kill(auggiePid, 'SIGKILL'); } catch { /* ignore */ }
    }
    if (isProcessAlive(daemonPid)) {
      log(`Force-killing daemon pid ${daemonPid}`);
      try { process.kill(daemonPid, 'SIGKILL'); } catch { /* ignore */ }
    }

    // Clean up files
    const sock = socketPath(workspaceId);
    const rpcSock = rpcSocketPath(workspaceId);
    try { fs.unlinkSync(sock); } catch { /* ignore */ }
    try { fs.unlinkSync(rpcSock); } catch { /* ignore */ }
    try { fs.unlinkSync(auggiePidPath(workspaceId)); } catch { /* ignore */ }
    try { fs.unlinkSync(daemonPidPath(workspaceId)); } catch { /* ignore */ }

    writeStatus(workspaceId, {
      running: false,
      stoppedAt: new Date().toISOString(),
    });

    process.stdout.write(JSON.stringify({ ok: true, stopped: true }) + '\n');
    process.exit(0);
  }, 3000);
}

// ---------------------------------------------------------------------------
// COMMAND: discover
// ---------------------------------------------------------------------------

// Discover the path to the auggie CLI on this host.
//
// Strategy (mirrors findAuggieAsync / getAuggieCommonPaths from async-utils.ts):
//   0. Check cached config (~/.intent-server/config.json → auggiePath)
//   1. Try `command -v auggie` via the user's login shell ($SHELL or /bin/sh)
//   2. Check common hardcoded paths
//   3. Scan nvm directories (~/.nvm/versions/node/*/bin/auggie)
//   4. Scan fnm directories (~/.fnm/node-versions/*/installation/bin/auggie)
//
// Prints JSON to stdout: { ok: true, auggiePath } or { ok: false, error }
// Caches the discovered path in ~/.intent-server/config.json.
function cmdDiscover() {
  const configPath = path.join(BASE_DIR, 'config.json');
  const homeDir = os.homedir();

  // --- Step 0: Check cached config ---
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    if (config.auggiePath && typeof config.auggiePath === 'string') {
      if (isExecutable(config.auggiePath)) {
        log(`[discover] Using cached auggie path: ${config.auggiePath}`);
        process.stdout.write(JSON.stringify({ ok: true, auggiePath: config.auggiePath }) + '\n');
        process.exit(0);
      } else {
        log(`[discover] Cached path no longer valid: ${config.auggiePath}`);
      }
    }
  } catch {
    // No config or invalid JSON — continue discovery
  }

  // --- Step 1: Try `command -v auggie` via user's login shell ---
  let auggiePath = null;
  try {
    const { execSync } = require('child_process');
    const shell = process.env.SHELL || '/bin/sh';
    const result = execSync(`${shell} -l -c "command -v auggie"`, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const candidate = result.trim().split('\n').pop().trim();
    if (candidate && isExecutable(candidate)) {
      auggiePath = candidate;
      log(`[discover] Found auggie via login shell (${shell}): ${auggiePath}`);
    }
  } catch {
    log('[discover] Login shell "command -v auggie" failed, trying common paths');
  }

  // --- Step 2: Check common hardcoded paths ---
  if (!auggiePath) {
    const commonPaths = [
      '/usr/local/bin/auggie',
      '/opt/homebrew/bin/auggie',
      path.join(homeDir, '.npm-global', 'bin', 'auggie'),
      path.join(homeDir, '.npm-packages', 'bin', 'auggie'),
      path.join(homeDir, '.local', 'bin', 'auggie'),
      path.join(homeDir, 'npm', 'bin', 'auggie'),
      path.join(homeDir, '.volta', 'bin', 'auggie'),
      path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', 'auggie'),
      path.join(homeDir, '.asdf', 'shims', 'auggie'),
      path.join(homeDir, 'n', 'bin', 'auggie'),
      '/usr/local/n/bin/auggie',
      '/usr/local/opt/node/bin/auggie',
      '/opt/homebrew/opt/node/bin/auggie',
      '/usr/local/opt/node@18/bin/auggie',
      '/usr/local/opt/node@20/bin/auggie',
      '/usr/local/opt/node@22/bin/auggie',
      '/opt/homebrew/opt/node@18/bin/auggie',
      '/opt/homebrew/opt/node@20/bin/auggie',
      '/opt/homebrew/opt/node@22/bin/auggie',
    ];

    for (const p of commonPaths) {
      if (isExecutable(p)) {
        auggiePath = p;
        log(`[discover] Found auggie at common path: ${auggiePath}`);
        break;
      }
    }
  }

  // --- Step 3: Scan nvm directories ---
  if (!auggiePath) {
    const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
    try {
      const nodeDirs = fs.readdirSync(nvmDir)
        .filter(function (d) { return d.startsWith('v'); })
        .sort(function (a, b) {
          const va = a.replace('v', '').split('.').map(Number);
          const vb = b.replace('v', '').split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            if ((va[i] || 0) !== (vb[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
          }
          return 0;
        });
      for (const dir of nodeDirs) {
        const candidate = path.join(nvmDir, dir, 'bin', 'auggie');
        if (isExecutable(candidate)) {
          auggiePath = candidate;
          log(`[discover] Found auggie in nvm: ${auggiePath}`);
          break;
        }
      }
    } catch {
      // nvm directory doesn't exist
    }
  }

  // --- Step 4: Scan fnm directories ---
  if (!auggiePath) {
    const fnmDir = path.join(homeDir, '.fnm', 'node-versions');
    try {
      const nodeDirs = fs.readdirSync(fnmDir);
      for (const dir of nodeDirs) {
        const candidate = path.join(fnmDir, dir, 'installation', 'bin', 'auggie');
        if (isExecutable(candidate)) {
          auggiePath = candidate;
          log(`[discover] Found auggie in fnm: ${auggiePath}`);
          break;
        }
      }
    } catch {
      // fnm directory doesn't exist
    }
  }

  // --- Output result ---
  if (auggiePath) {
    // Cache the discovered path
    try {
      mkdirp(BASE_DIR);
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch { /* start fresh */ }
      config.auggiePath = auggiePath;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      log(`[discover] Cached auggie path: ${auggiePath}`);
    } catch (err) {
      log(`[discover] Warning: failed to cache config: ${err.message}`);
    }
    process.stdout.write(JSON.stringify({ ok: true, auggiePath: auggiePath }) + '\n');
    process.exit(0);
  } else {
    const msg = 'auggie not found on this host';
    log(`[discover] ${msg}`);
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    process.exit(1);
  }
}

/**
 * Check if a path exists and is executable.
 */
function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// COMMAND: watch
// ---------------------------------------------------------------------------

/**
 * Watch a workspace directory for file changes and output newline-delimited
 * JSON to stdout with git status + diff information.
 *
 * Usage: node intent-server.cjs watch --workspace <id> --base-path /path/to/worktree
 *
 * Output format (one JSON object per line):
 *   {"type":"ready"}
 *   {"type":"changes","files":[...],"summary":{...},"timestamp":"..."}
 */
function cmdWatch(workspaceId, opts) {
  const { execSync } = require('child_process');

  const basePath = opts['base-path'] || process.cwd();
  const resolvedBase = basePath.startsWith('~')
    ? basePath.replace(/^~/, os.homedir())
    : path.resolve(basePath);

  if (!fs.existsSync(resolvedBase)) {
    process.stderr.write(`Error: base-path does not exist: ${resolvedBase}\n`);
    process.exit(1);
  }

  log(`[watch] Starting watcher for workspace ${workspaceId} at ${resolvedBase}`);

  // Patterns to ignore
  const IGNORE_PATTERNS = [
    /^\.git\//,
    /[\/\\]\.git[\/\\]/,
    /^node_modules\//,
    /[\/\\]node_modules[\/\\]/,
    /^\.bazel\//,
    /[\/\\]\.bazel[\/\\]/,
    /^bazel-/,
  ];

  function shouldIgnore(filePath) {
    for (const pattern of IGNORE_PATTERNS) {
      if (pattern.test(filePath)) return true;
    }
    return false;
  }

  // Map git status codes to action names
  function statusToAction(code) {
    switch (code) {
      case 'A': return 'Create';
      case 'M': return 'Modify';
      case 'D': return 'Delete';
      case 'R': return 'Rename';
      case '??': return 'Create'; // untracked
      case '!!': return null;     // ignored
      default: return 'Modify';
    }
  }

  // Run a git command and return stdout, or null on error
  function gitExec(args) {
    try {
      return execSync(`git ${args}`, {
        cwd: resolvedBase,
        encoding: 'utf8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return null;
    }
  }

  // Parse `git diff --numstat` output into a map of path → {additions, deletions}
  function parseNumstat(output) {
    const stats = {};
    if (!output) return stats;
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const adds = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const dels = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      // For renames, git shows "old => new" or "{old => new}" in the path
      let filePath = parts.slice(2).join('\t');
      // Handle rename paths like "a/{old => new}/b" or "old => new"
      const renameMatch = filePath.match(/\{(.+?) => (.+?)\}/);
      if (renameMatch) {
        filePath = filePath.replace(/\{.+? => (.+?)\}/, '$1');
      } else if (filePath.includes(' => ')) {
        filePath = filePath.split(' => ').pop();
      }
      stats[filePath] = { additions: adds, deletions: dels };
    }
    return stats;
  }

  // Count lines in a file (for untracked files)
  function countLines(filePath) {
    try {
      const fullPath = path.join(resolvedBase, filePath);
      const content = fs.readFileSync(fullPath, 'utf8');
      return content.split('\n').length;
    } catch {
      return 0;
    }
  }

  // Collect changes from git and emit a JSON event
  function emitChanges() {
    const porcelain = gitExec('status --porcelain');
    if (porcelain == null) {
      log('[watch] git status failed');
      return;
    }

    if (porcelain.trim() === '') return; // no changes

    // Parse git status --porcelain
    // IMPORTANT: Use trimEnd() not trim() — trim() strips leading whitespace which
    // corrupts the first status line's index/workTree status characters (e.g. " M" → "M").
    const statusLines = porcelain.trimEnd().split('\n');
    const fileEntries = [];

    for (const line of statusLines) {
      if (!line || line.length < 4) continue;
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      let filePath = line.slice(3);

      // DEBUG: Log raw line parsing for path truncation issue
      log(`[watch] Parsing git status line: raw="${line}", indexStatus="${indexStatus}", workTreeStatus="${workTreeStatus}", filePath="${filePath}"`);

      // Handle renames: "R  old -> new"
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ').pop();
      }

      if (shouldIgnore(filePath)) continue;

      // Determine staged vs unstaged entries
      // Index status (column 0): staged changes
      // Work-tree status (column 1): unstaged changes
      if (indexStatus !== ' ' && indexStatus !== '?') {
        fileEntries.push({ path: filePath, code: indexStatus, stage: 'staged' });
      }
      if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
        fileEntries.push({ path: filePath, code: workTreeStatus, stage: 'unstaged' });
      }
      // Untracked files (both columns are '?')
      if (indexStatus === '?' && workTreeStatus === '?') {
        fileEntries.push({ path: filePath, code: '??', stage: 'unstaged' });
      }
    }

    if (fileEntries.length === 0) return;

    // Get numstat for unstaged and staged diffs
    const unstagedNumstat = parseNumstat(gitExec('diff --numstat'));
    const stagedNumstat = parseNumstat(gitExec('diff --numstat --cached'));

    // Build file change objects
    const files = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const entry of fileEntries) {
      const action = statusToAction(entry.code);
      if (!action) continue;

      let additions = 0;
      let deletions = 0;

      if (entry.stage === 'staged') {
        const stats = stagedNumstat[entry.path];
        if (stats) {
          additions = stats.additions;
          deletions = stats.deletions;
        }
      } else {
        const stats = unstagedNumstat[entry.path];
        if (stats) {
          additions = stats.additions;
          deletions = stats.deletions;
        } else if (entry.code === '??' || action === 'Create') {
          // Untracked new file — count lines
          additions = countLines(entry.path);
        }
      }

      files.push({
        path: entry.path,
        action,
        additions,
        deletions,
        stage: entry.stage,
      });

      totalAdditions += additions;
      totalDeletions += deletions;
    }

    if (files.length === 0) return;

    const event = {
      type: 'changes',
      files,
      summary: {
        filesChanged: files.length,
        additions: totalAdditions,
        deletions: totalDeletions,
      },
      timestamp: new Date().toISOString(),
    };

    // DEBUG: Log the event for tracing path truncation issues
    if (files.length > 0) {
      log(`[watch] Emitting changes event: ${files.length} files, first file path: "${files[0]?.path}"`);
    }
    process.stdout.write(JSON.stringify(event) + '\n');
  }

  // Debounce mechanism
  let debounceTimer = null;

  function scheduleEmit() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      emitChanges();
    }, 300);
  }

  // Try fs.watch with recursive option; fall back to polling
  let watcher = null;
  let pollInterval = null;

  function startFsWatch() {
    try {
      watcher = fs.watch(resolvedBase, { recursive: true }, (eventType, filename) => {
        if (filename && shouldIgnore(filename)) return;
        scheduleEmit();
      });

      watcher.on('error', (err) => {
        log(`[watch] fs.watch error: ${err.message}, falling back to polling`);
        try { watcher.close(); } catch { /* ignore */ }
        watcher = null;
        startPolling();
      });

      return true;
    } catch (err) {
      log(`[watch] fs.watch failed: ${err.message}, falling back to polling`);
      return false;
    }
  }

  function startPolling() {
    log('[watch] Using polling fallback (every 2s)');
    let lastStatus = '';
    pollInterval = setInterval(() => {
      const currentStatus = gitExec('status --porcelain');
      if (currentStatus != null && currentStatus !== lastStatus) {
        lastStatus = currentStatus;
        emitChanges();
      }
    }, 2000);
  }

  // Clean shutdown
  function shutdown() {
    log(`[watch] Shutting down watcher for workspace ${workspaceId}`);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (watcher) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    if (pollInterval) clearInterval(pollInterval);
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start watching
  if (!startFsWatch()) {
    startPolling();
  }

  // Signal readiness
  process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

  // Emit initial state
  emitChanges();
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const opts = parseArgs(argv.slice(1));

  if (!command) {
    process.stderr.write(
      'Usage: node intent-server.js <start|serve|relay|status|stop|discover|watch> --workspace <id> [options]\n'
    );
    process.exit(1);
  }

  // 'discover' does not require --workspace
  if (command === 'discover') {
    cmdDiscover();
    return;
  }

  const workspaceId = opts.workspace;

  if (!workspaceId) {
    process.stderr.write('Error: --workspace <id> is required\n');
    process.exit(1);
  }

  // Validate workspace ID (prevent path traversal)
  if (/[\/\\\.]{2,}/.test(workspaceId) || /[^a-zA-Z0-9_\-]/.test(workspaceId)) {
    process.stderr.write('Error: Invalid workspace ID\n');
    process.exit(1);
  }

  switch (command) {
    case 'start':
      cmdStart(workspaceId, opts);
      break;
    case 'serve':
      cmdServe(workspaceId, opts);
      break;
    case 'relay':
      cmdRelay(workspaceId);
      break;
    case 'status':
      cmdStatus(workspaceId);
      break;
    case 'stop':
      cmdStop(workspaceId);
      break;
    case 'watch':
      cmdWatch(workspaceId, opts);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n`);
      process.stderr.write('Valid commands: start, serve, relay, status, stop, discover, watch\n');
      process.exit(1);
  }
}

main();
