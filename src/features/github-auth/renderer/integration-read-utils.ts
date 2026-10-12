import type { GithubRepo } from '../types';

/** Coerce a possibly-unknown argument into a plain object record. */
export function asRecord(arg: unknown): Record<string, unknown> {
  return arg && typeof arg === 'object' ? (arg as Record<string, unknown>) : {};
}

/** Explicit routing metadata on approved integration variants only. */
export function workspaceParams(arg: unknown): { workspaceId?: string } {
  const { workspaceId } = asRecord(arg);
  return typeof workspaceId === 'string' ? { workspaceId } : {};
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Daemon `GithubRepo` — camelCase on the wire (§5.27 field naming). */
export interface GithubRepoWire {
  owner: string;
  name: string;
  htmlUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  defaultBranch?: string;
}

/** Map the wire repo to the FE's legacy snake_case `GithubRepo`. */
export function toLegacyRepo(repo: GithubRepoWire): GithubRepo {
  return {
    owner: repo.owner,
    name: repo.name,
    html_url: repo.htmlUrl,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    default_branch: repo.defaultBranch,
  };
}
