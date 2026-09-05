import type { ContextLink } from '$shared/types';
import type { DraftSource } from '$shared/types/workspace-draft';
import { parseGitHubUrl } from '$shared/utils/link-helpers';
import {
  buildContextLinkFromUrl,
  MAX_CONTEXT_LINKS,
} from '$lib/components/workspace/initializer/context-links';

interface StartPrefill {
  title?: string;
  prompt?: string;
  repoPath?: string;
  githubUrl?: string;
  branch?: string;
  projectName?: string;
  parentPath?: string;
  isNewRepo?: boolean;
  isRemoteDaemon?: boolean;
  owner?: string;
  repo?: string;
  number?: number;
  kind?: 'issue' | 'pr';
  url?: string;
}

export interface ResolveStartInput {
  text?: string;
  droppedPaths?: string[];
  prefill?: StartPrefill;
}

type UnresolvedReason =
  'unknown-link' | 'ambiguous-source' | 'needs-git-init' | 'remote-daemon-path';

interface UnresolvedRef {
  value: string;
  kind: 'link' | 'path' | 'source';
  reason: UnresolvedReason;
  needsGitInit?: true;
  rejectedForRemoteDaemon?: true;
}

export interface ResolvedStart {
  title?: string;
  intentText: string;
  source?: DraftSource;
  contextLinks: ContextLink[];
  unresolved: UnresolvedRef[];
}

interface SourceCandidate {
  source: DraftSource;
  value: string;
  needsGitInit?: boolean;
}

const LINK_PATTERN = /(?:https?|file):\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function trimLinkPunctuation(value: string): string {
  let result = value.replace(TRAILING_PUNCTUATION, '');
  const pairs: Array<[string, string]> = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];
  for (const [open, close] of pairs) {
    while (result.endsWith(close) && result.split(close).length > result.split(open).length) {
      result = result.slice(0, -1);
    }
  }
  return result;
}

function extractLinks(text: string): string[] {
  return [...text.matchAll(LINK_PATTERN)].map((match) => trimLinkPunctuation(match[0]));
}

function isAbsolutePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/.test(value) ||
    /^\/\/[^/]+\/[^/]+/.test(value)
  );
}

function fileUrlToPath(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'file:') return null;
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (parsed.hostname) return `//${parsed.hostname}${decodedPath}`;
    return /^\/[a-zA-Z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
  } catch {
    return null;
  }
}

function githubSource(value: string, branch?: string): DraftSource | null {
  const parsed = parseGitHubUrl(value);
  if (!parsed) return null;
  return {
    kind: 'github',
    url: `https://github.com/${parsed.owner}/${parsed.repo}`,
    owner: parsed.owner,
    name: parsed.repo,
    ...(branch ? { branch } : {}),
  };
}

function localSource(path: string, branch?: string): DraftSource {
  return {
    kind: 'local',
    path,
    isolation: 'worktree',
    ...(branch ? { branch } : {}),
  };
}

function sourceKey(source: DraftSource): string {
  if (source.kind === 'github')
    return `github:${source.owner.toLowerCase()}/${source.name.toLowerCase()}`;
  if (source.kind === 'local') return `local:${source.path}`;
  return `new-folder:${source.parentPath}/${source.name}`;
}

function contextKey(link: ContextLink): string {
  return `${link.owner.toLowerCase()}/${link.repo.toLowerCase()}#${link.number}`;
}

export function resolveStart(input: ResolveStartInput): ResolvedStart {
  const prefill = input.prefill ?? {};
  const text = (input.text ?? prefill.prompt ?? '').trim();
  const links = extractLinks(text);
  const wholeReference = links.length === 1 && trimLinkPunctuation(text) === links[0];
  const contextByKey = new Map<string, ContextLink>();
  const unresolved: UnresolvedRef[] = [];
  const candidates: SourceCandidate[] = [];
  let explicitSource: DraftSource | undefined;
  let textIsSourceOnly = false;

  if (prefill.repoPath) {
    if (prefill.isRemoteDaemon) {
      unresolved.push({
        value: prefill.repoPath,
        kind: 'path',
        reason: 'remote-daemon-path',
        rejectedForRemoteDaemon: true,
      });
    } else {
      explicitSource = localSource(prefill.repoPath, prefill.branch);
      if (prefill.isNewRepo) {
        unresolved.push({
          value: prefill.repoPath,
          kind: 'path',
          reason: 'needs-git-init',
          needsGitInit: true,
        });
      }
    }
  } else if (prefill.githubUrl) {
    explicitSource = githubSource(prefill.githubUrl, prefill.branch) ?? undefined;
    if (!explicitSource) {
      unresolved.push({ value: prefill.githubUrl, kind: 'link', reason: 'unknown-link' });
    }
  } else if (prefill.projectName && prefill.parentPath) {
    explicitSource = {
      kind: 'newFolder',
      parentPath: prefill.parentPath,
      name: prefill.projectName,
    };
  }

  if (prefill.owner && prefill.repo && prefill.number && prefill.kind && prefill.url) {
    const link: ContextLink = {
      owner: prefill.owner,
      repo: prefill.repo,
      number: prefill.number,
      kind: prefill.kind,
      url: prefill.url,
    };
    contextByKey.set(contextKey(link), link);
    if (!explicitSource)
      explicitSource = githubSource(`${prefill.owner}/${prefill.repo}`) ?? undefined;
  }

  for (const droppedPath of input.droppedPaths ?? []) {
    const path = droppedPath.trim();
    if (!isAbsolutePath(path)) {
      unresolved.push({ value: droppedPath, kind: 'path', reason: 'unknown-link' });
      continue;
    }
    if (prefill.isRemoteDaemon) {
      unresolved.push({
        value: path,
        kind: 'path',
        reason: 'remote-daemon-path',
        rejectedForRemoteDaemon: true,
      });
      continue;
    }
    candidates.push({
      source: localSource(path),
      value: path,
      needsGitInit: true,
    });
  }

  for (const linkValue of links) {
    const contextLink = buildContextLinkFromUrl(linkValue);
    if (contextLink) {
      if (wholeReference) textIsSourceOnly = true;
      const key = contextKey(contextLink);
      const existing = contextByKey.get(key);
      if (!existing || (existing.kind === 'issue' && contextLink.kind === 'pr')) {
        if (contextByKey.size < MAX_CONTEXT_LINKS || existing) contextByKey.set(key, contextLink);
      }
      const source = githubSource(`${contextLink.owner}/${contextLink.repo}`);
      if (source) candidates.push({ source, value: linkValue });
      continue;
    }

    const repoSource = githubSource(linkValue, prefill.branch);
    if (repoSource) {
      if (wholeReference) textIsSourceOnly = true;
      candidates.push({ source: repoSource, value: linkValue });
      continue;
    }

    const filePath = fileUrlToPath(linkValue);
    if (filePath && isAbsolutePath(filePath)) {
      if (wholeReference) textIsSourceOnly = true;
      if (prefill.isRemoteDaemon) {
        unresolved.push({
          value: linkValue,
          kind: 'path',
          reason: 'remote-daemon-path',
          rejectedForRemoteDaemon: true,
        });
      } else {
        candidates.push({
          source: localSource(filePath, prefill.branch),
          value: linkValue,
          needsGitInit: true,
        });
      }
      continue;
    }

    unresolved.push({ value: linkValue, kind: 'link', reason: 'unknown-link' });
  }

  if (links.length === 0 && text) {
    const repoSource = githubSource(trimLinkPunctuation(text), prefill.branch);
    const path = trimLinkPunctuation(text);
    if (repoSource) {
      textIsSourceOnly = true;
      candidates.push({ source: repoSource, value: text });
    } else if (isAbsolutePath(path)) {
      textIsSourceOnly = true;
      if (prefill.isRemoteDaemon) {
        unresolved.push({
          value: path,
          kind: 'path',
          reason: 'remote-daemon-path',
          rejectedForRemoteDaemon: true,
        });
      } else {
        candidates.push({
          source: localSource(path, prefill.branch),
          value: path,
          needsGitInit: true,
        });
      }
    }
  }

  let source = explicitSource;
  if (!source && candidates.length > 0) {
    const bySource = new Map<string, SourceCandidate>();
    for (const candidate of candidates) bySource.set(sourceKey(candidate.source), candidate);
    if (bySource.size === 1) {
      const candidate = [...bySource.values()][0];
      source = candidate.source;
      if (candidate.needsGitInit) {
        unresolved.push({
          value: candidate.value,
          kind: 'path',
          reason: 'needs-git-init',
          needsGitInit: true,
        });
      }
    } else {
      for (const candidate of bySource.values()) {
        unresolved.push({ value: candidate.value, kind: 'source', reason: 'ambiguous-source' });
      }
    }
  }

  return {
    ...(prefill.title ? { title: prefill.title } : {}),
    intentText: textIsSourceOnly ? '' : text,
    ...(source ? { source } : {}),
    contextLinks: [...contextByKey.values()],
    unresolved,
  };
}
