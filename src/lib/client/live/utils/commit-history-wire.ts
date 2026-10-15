import { z } from 'zod';
import type { CommitHistoryPage } from '../../commit-history-types';
import type { CommitFile, CommitInfo } from '../../../../features/file-tracking/types';

function dateToTimestamp(date: unknown): number {
  if (typeof date !== 'string' || !date) return 0;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : 0;
}

/** Map a §5.19 `CommitWithAttribution` file entry into the renderer `CommitFile`. */
function toCommitFile(raw: unknown): CommitFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const path = typeof f.path === 'string' ? f.path : '';
  if (!path) return null;
  const file: CommitFile = { path };
  if (typeof f.additions === 'number') file.additions = f.additions;
  if (typeof f.deletions === 'number') file.deletions = f.deletions;
  if (typeof f.status === 'string') file.status = f.status;
  return file;
}

/**
 * Map a daemon `file-tracking.loadCommits` entry (§5.19 `CommitWithAttribution`:
 * hash/message/author/date/isPushed/files?/filesChanged?/agentId?/linkedNoteId?)
 * into the renderer `CommitInfo`. `files`/`filesChanged` are omitted by the
 * metadata-only list payload — carried through as absent (not healed to `[]`)
 * so consumers lazily fetch `git.commitDetails` on demand.
 */
export function toCommitInfo(raw: z.infer<typeof commitSchema>): CommitInfo;
export function toCommitInfo(raw: unknown): CommitInfo | null;
export function toCommitInfo(raw: unknown): CommitInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hash = typeof r.hash === 'string' ? r.hash : '';
  if (!hash) return null;
  const isPushed = Boolean(r.isPushed);
  const info: CommitInfo = {
    hash,
    message: typeof r.message === 'string' ? r.message : '',
    author: typeof r.author === 'string' ? r.author : '',
    timestamp: dateToTimestamp(r.date),
    stage: isPushed ? 'pushed' : 'local',
    isPushed,
  };
  if (Array.isArray(r.files)) {
    info.files = r.files.map(toCommitFile).filter((f): f is CommitFile => f !== null);
  }
  if (typeof r.filesChanged === 'number') info.filesChanged = r.filesChanged;
  if (typeof r.date === 'string') info.date = r.date;
  if (typeof r.agentId === 'string') info.agentId = r.agentId;
  if (typeof r.linkedNoteId === 'string') info.linkedNoteId = r.linkedNoteId;
  return info;
}

const count = z.number().int().nonnegative();
const commitSchema = z.object({
  hash: z.string().min(1),
  message: z.string(),
  author: z.string(),
  date: z.string().refine((date) => Number.isFinite(Date.parse(date))),
  isPushed: z.boolean(),
  agentId: z.string().optional(),
  linkedNoteId: z.string().optional(),
  filesChanged: count.optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        additions: count.optional(),
        deletions: count.optional(),
        status: z.string().optional(),
      }),
    )
    .optional(),
});
const pageSchema = z.object({
  commits: z.array(commitSchema),
  boundarySha: z.string().min(1).nullable(),
  nextToken: z.string().min(1).nullable(),
});

export function parseCommitHistoryPage(raw: unknown): CommitHistoryPage {
  const result = pageSchema.parse(raw);
  return {
    ...result,
    // Validation above proves the canonical mapper cannot omit an entry.
    commits: result.commits.map((commit) => toCommitInfo(commit)),
  };
}
