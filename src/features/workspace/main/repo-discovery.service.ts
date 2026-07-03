/**
 * Repository Discovery Service
 *
 * Discovers git repositories on the user's machine from multiple sources:
 * VS Code, Cursor, Windsurf, Claude Code, JetBrains, and filesystem scanning.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../../../shared/logger';
import { hostExec } from '../../../shared/main/host-exec';

const logger = new Logger({ category: 'RepoDiscovery' });

export interface DiscoveredRepo {
  path: string;
  name: string;
  owner?: string;
  source: string;
}

const home = os.homedir();

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepo(dir: string): Promise<boolean> {
  return exists(path.join(dir, '.git'));
}

function extractOwner(repoPath: string): string | undefined {
  const rel = repoPath.startsWith(home) ? repoPath.slice(home.length + 1) : '';
  const parts = rel.split(path.sep);
  if (parts.length >= 3) return parts[parts.length - 2];
  return undefined;
}

function toRepo(repoPath: string, source: string): DiscoveredRepo {
  return { path: repoPath, name: path.basename(repoPath), owner: extractOwner(repoPath), source };
}

// ── Source: VS Code / Cursor / Windsurf workspaceStorage ─────────────────────

async function discoverFromWorkspaceStorage(
  appName: string,
  storageDir: string,
): Promise<DiscoveredRepo[]> {
  const repos: DiscoveredRepo[] = [];
  if (!(await exists(storageDir))) return repos;
  const entries = await fs.promises.readdir(storageDir, { withFileTypes: true });
  const tasks = entries
    .filter((e) => e.isDirectory())
    .map(async (entry) => {
      try {
        const wsFile = path.join(storageDir, entry.name, 'workspace.json');
        const raw = await fs.promises.readFile(wsFile, 'utf-8');
        const data = JSON.parse(raw);
        const folder: string | undefined = data.folder;
        if (!folder) return;
        let decoded: string;
        try {
          decoded = decodeURI(new URL(folder).pathname);
        } catch {
          return;
        }
        if (await isGitRepo(decoded)) repos.push(toRepo(decoded, appName.toLowerCase()));
      } catch {
        // workspace.json missing or unreadable — skip
      }
    });
  await Promise.all(tasks);
  return repos;
}

// ── Source: Claude Code projects ──────────────────────────────────────────────

async function discoverFromClaudeCode(): Promise<DiscoveredRepo[]> {
  const repos: DiscoveredRepo[] = [];
  const projectsDir = path.join(home, '.claude', 'projects');
  if (!(await exists(projectsDir))) return repos;
  const entries = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  const tasks = entries
    .filter((e) => e.isDirectory())
    .map(async (entry) => {
      try {
        const decoded = entry.name.replace(/^-/, '/').replace(/-/g, '/');
        if ((await exists(decoded)) && (await isGitRepo(decoded))) {
          repos.push(toRepo(decoded, 'claude-code'));
        }
      } catch {
        // skip
      }
    });
  await Promise.all(tasks);
  return repos;
}

// ── Source: JetBrains IDEs ───────────────────────────────────────────────────

async function discoverFromJetBrains(): Promise<DiscoveredRepo[]> {
  const repos: DiscoveredRepo[] = [];
  const jetbrainsDir = path.join(home, 'Library', 'Application Support', 'JetBrains');
  if (!(await exists(jetbrainsDir))) return repos;
  const ideDirs = await fs.promises.readdir(jetbrainsDir, { withFileTypes: true });
  const tasks = ideDirs
    .filter((e) => e.isDirectory())
    .map(async (ideDir) => {
      try {
        const xmlPath = path.join(jetbrainsDir, ideDir.name, 'options', 'recentProjects.xml');
        const content = await fs.promises.readFile(xmlPath, 'utf-8');
        const entryRegex = /<entry\s+key="([^"]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = entryRegex.exec(content)) !== null) {
          let projectPath = match[1].replace(/\$USER_HOME\$/g, home);
          if (projectPath.startsWith('file://')) {
            try {
              projectPath = decodeURI(new URL(projectPath).pathname);
            } catch {
              continue;
            }
          }
          if ((await exists(projectPath)) && (await isGitRepo(projectPath))) {
            repos.push(toRepo(projectPath, 'jetbrains'));
          }
        }
      } catch {
        // XML missing or unreadable — skip
      }
    });
  await Promise.all(tasks);
  return repos;
}

// ── Source: Filesystem scan ──────────────────────────────────────────────────

async function discoverFromFilesystem(): Promise<DiscoveredRepo[]> {
  const candidateDirs = [
    'Developer',
    'Projects',
    'projects',
    'code',
    'Code',
    'src',
    'repos',
    'dev',
    'work',
    'GitHub',
    path.join('Documents', 'GitHub'),
  ].map((d) => path.join(home, d));

  const existingDirs = (
    await Promise.all(candidateDirs.map(async (d) => ((await exists(d)) ? d : null)))
  ).filter((d): d is string => d !== null);

  if (existingDirs.length === 0) return [];

  const args = [
    ...existingDirs,
    '-maxdepth',
    '3',
    '-name',
    '.git',
    '-type',
    'd',
    '-not',
    '-path',
    '*/node_modules/*',
    '-not',
    '-path',
    '*/Library/*',
    '-not',
    '-path',
    '*/.Trash/*',
  ];

  // Route through the daemon's one-shot `host.exec` seam (PROTOCOL.md §5.14);
  // the daemon owns argv-based exec and tree-kills the child on `timeoutMs`.
  // `find` frequently exits non-zero on permission-denied entries while still
  // emitting valid matches on stdout, so we mirror the previous callback's
  // `error && !stdout` guard: parse whatever stdout we got, only bail on the
  // timeout / no-output failure mode.
  let stdout = '';
  try {
    const result = await hostExec('find', { args, timeoutMs: 5000 });
    stdout = result.stdout;
    if (result.timedOut && !stdout) {
      logger.warn('Filesystem scan timed out');
      return [];
    }
  } catch (error) {
    logger.warn('Filesystem scan failed or timed out', error);
    return [];
  }

  const repos: DiscoveredRepo[] = [];
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    repos.push(toRepo(path.dirname(line), 'filesystem'));
  }
  return repos;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function discoverRepos(): Promise<DiscoveredRepo[]> {
  const seen = new Set<string>();
  const results: DiscoveredRepo[] = [];

  function addUnique(repos: DiscoveredRepo[]) {
    for (const repo of repos) {
      const normalized = path.resolve(repo.path);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        results.push({ ...repo, path: normalized });
      }
    }
  }

  const appSupport = path.join(home, 'Library', 'Application Support');

  // Run all instant sources in parallel
  const instantSources = await Promise.allSettled([
    discoverFromWorkspaceStorage(
      'vscode',
      path.join(appSupport, 'Code', 'User', 'workspaceStorage'),
    ),
    discoverFromClaudeCode(),
    discoverFromWorkspaceStorage(
      'cursor',
      path.join(appSupport, 'Cursor', 'User', 'workspaceStorage'),
    ),
    discoverFromWorkspaceStorage(
      'windsurf',
      path.join(appSupport, 'Windsurf', 'User', 'workspaceStorage'),
    ),
    discoverFromJetBrains(),
  ]);

  for (const result of instantSources) {
    if (result.status === 'fulfilled') {
      addUnique(result.value);
    } else {
      logger.warn('Instant source failed', result.reason);
    }
  }

  // Run the slower filesystem scan
  try {
    const fsRepos = await discoverFromFilesystem();
    addUnique(fsRepos);
  } catch (err) {
    logger.warn('Filesystem scan failed', err);
  }

  logger.info(
    `Discovered ${results.length} repos (${[...new Set(results.map((r) => r.source))].join(', ')})`,
  );

  return results;
}
