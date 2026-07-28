/**
 * Context preparation utilities for background agent execution.
 *
 * These functions prepare context messages for different agent types
 * (commit, PR, review, walkthrough) to send to the background agent.
 */

import { appClient } from '$lib/client';
import { gitClient } from '$features/git/git.client';
import { setGitStatus } from '$store/renderer/slices/git/git-slice';
import { invoke } from '$lib/electron-bridge';
import { FILE_CHANNELS } from '$shared/ipc/channels';
import { createLogger } from '$lib/utils/client-logger';
import { shouldSkipFileForAI } from '$shared/binary-file-extensions';
import { store as appStore } from '$store/renderer/store';
import type { Workspace } from '$shared/types';
import type { AgentExecutorContext } from '../background-agent-executor-types';
import { MAX_DIFF_SIZE_PER_FILE, MAX_TOTAL_DIFF_SIZE } from '../background-agent-executor-types';

const logger = createLogger('BgExecutorContextPrep');

interface GitCommit {
  sha: string;
  message: string;
  author?: string;
  date?: string;
}

/**
 * Prepare context message based on type
 */
export async function prepareContext(
  workspace: Workspace,
  type: string,
  resultTag: string,
  context?: AgentExecutorContext,
): Promise<string> {
  switch (type) {
    case 'commit':
    case 'commit-merge':
      return await prepareCommitContext(workspace, resultTag, context);
    case 'pr':
      return await preparePRContext(workspace, resultTag, context);
    case 'review':
      return await prepareReviewContext(workspace, resultTag, context);
    case 'walkthrough':
      return await prepareWalkthroughContext(workspace, resultTag, context);
    default:
      return typeof context?.message === 'string'
        ? context.message
        : // i18n-ignore (LLM prompt content, not user-facing UI)
          'Please analyze the current context and provide assistance.';
  }
}

/**
 * Helper to format DiffChunk objects into diff string
 */
export function formatDiffChunks(data: unknown): string {
  if (!data) return '';

  const getLinePrefix = (lineType: string | undefined): string => {
    if (!lineType) return ' ';
    const normalizedType = lineType.toLowerCase();
    if (normalizedType === 'addition' || normalizedType === 'add') return '+';
    if (normalizedType === 'deletion' || normalizedType === 'remove') return '-';
    return ' ';
  };

  if (Array.isArray(data)) {
    let result = '';
    for (const fileChunk of data) {
      if (fileChunk.file) {
        result += `diff --git a/${fileChunk.file} b/${fileChunk.file}\n`;
      }
      if (fileChunk.chunks) {
        for (const hunk of fileChunk.chunks) {
          if (hunk.oldStart !== undefined && hunk.newStart !== undefined) {
            result += `@@ -${hunk.oldStart},${hunk.oldLines || 0} +${hunk.newStart},${hunk.newLines || 0} @@\n`;
          }
          if (hunk.lines) {
            for (const line of hunk.lines) {
              const prefix = getLinePrefix(line.type);
              result += `${prefix}${line.content || ''}\n`;
            }
          }
        }
      }
    }
    return result;
  }

  const singleChunk = data as {
    chunks?: Array<{ lines?: Array<{ type?: string; content?: string }> }>;
  };
  if (singleChunk.chunks) {
    let result = '';
    for (const chunk of singleChunk.chunks) {
      if (chunk.lines) {
        for (const line of chunk.lines) {
          const prefix = getLinePrefix(line.type);
          result += `${prefix}${line.content || ''}\n`;
        }
      }
    }
    return result;
  }

  return '';
}

/**
 * Get staged diff content for files, handling size limits and file filtering.
 */
async function getStagedDiffs(
  workspace: Workspace,
  stagedFiles: Array<{ path: string; status: string; staged: boolean }>,
): Promise<{
  combinedDiff: string;
  skippedFiles: Array<{ path: string; reason: string }>;
  largeDiffFiles: Array<{ path: string; size: number }>;
  filesToDiff: typeof stagedFiles;
}> {
  const skippedFiles: Array<{ path: string; reason: string }> = [];
  const filesToDiff: typeof stagedFiles = [];
  const largeDiffFiles: Array<{ path: string; size: number }> = [];

  for (const file of stagedFiles) {
    const skipCheck = shouldSkipFileForAI(file.path);
    if (skipCheck.skip) {
      skippedFiles.push({ path: file.path, reason: skipCheck.reason || 'skipped' });
    } else {
      filesToDiff.push(file);
    }
  }

  let combinedDiff = '';
  let totalDiffSize = 0;

  for (const file of filesToDiff) {
    if (totalDiffSize >= MAX_TOTAL_DIFF_SIZE) {
      skippedFiles.push({ path: file.path, reason: 'total diff size limit reached' });
      continue;
    }

    // Daemon-backed staged hunks (`git.diffs`, PROTOCOL §5.6) via the
    // appClient seam; errors fold to an empty list inside the seam.
    const chunks = await appClient.git.diffs(workspace.id, {
      path: file.path,
      staged: true,
    });
    const fileDiff = chunks.length > 0 ? formatDiffChunks(chunks) : '';

    if (fileDiff.length > MAX_DIFF_SIZE_PER_FILE) {
      largeDiffFiles.push({ path: file.path, size: fileDiff.length });
      const truncated = fileDiff.substring(0, MAX_DIFF_SIZE_PER_FILE);
      const lastNewline = truncated.lastIndexOf('\n');
      combinedDiff +=
        truncated.substring(0, lastNewline > 0 ? lastNewline : MAX_DIFF_SIZE_PER_FILE) +
        `\n... [truncated - file diff too large (${Math.round(fileDiff.length / 1024)}KB)]\n\n`;
      totalDiffSize += MAX_DIFF_SIZE_PER_FILE;
    } else if (fileDiff) {
      combinedDiff += fileDiff + '\n';
      totalDiffSize += fileDiff.length;
    }
  }

  return { combinedDiff, skippedFiles, largeDiffFiles, filesToDiff };
}

/**
 * Prepare commit context
 */
async function prepareCommitContext(
  workspace: Workspace,
  resultTag: string,

  _context?: AgentExecutorContext,
): Promise<string> {
  const statusResult = await gitClient.getStatus(workspace.id);
  if (!statusResult.ok) {
    throw new Error("Unable to get git status. Please ensure you're in a git repository.");
  }
  const status = statusResult.data;
  appStore.dispatch(setGitStatus(workspace.id, status));

  const stagedFiles = status.files.filter((file) => file.staged);
  if (stagedFiles.length === 0) {
    throw new Error('No files are staged for commit. Please stage some files first.');
  }

  const { combinedDiff, skippedFiles, largeDiffFiles, filesToDiff } = await getStagedDiffs(
    workspace,
    stagedFiles,
  );

  logger.info('Filtered staged files for commit message', {
    total: stagedFiles.length,
    toDiff: filesToDiff.length,
    skipped: skippedFiles.length,
  });

  // Get recent commit messages for context (`git.commits`, PROTOCOL §5.6).
  let recentCommits: string[] = [];
  try {
    const historyResult = await gitClient.getHistory(workspace.id, 5);
    if (historyResult.ok) {
      recentCommits = historyResult.data.map((commit) => commit.message).filter(Boolean);
    }
  } catch (error) {
    logger.warn('Failed to get recent commits:', error);
  }

  // i18n-ignore (LLM prompt content, not user-facing UI)
  let message = `Generate a commit message for the following STAGED changes only.
Note: Only staged files will be committed. Any unstaged changes will NOT be included in this commit.
`;

  if (workspace.initialPrompt) {
    // i18n-ignore (LLM prompt content, not user-facing UI)
    message += `
## Original Task
The user created this workspace with the following request:
"${workspace.initialPrompt}"

Use this context to understand the intent behind the changes and write a more meaningful commit message.

`;
  }

  // i18n-ignore (LLM prompt content, not user-facing UI)
  message += `Please follow the conventional commit format:
<type>(<scope>): <subject>

<body>

Where type is one of: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert

Guidelines:
- Be concise but descriptive
- Use present tense ("add" not "added")
- Don't end the subject with a period
- Include a body for complex changes
- Focus on WHY the change was made, not just what changed

Wrap your final commit message in <<<${resultTag}>>> and <<</${resultTag}>>> tags.

Files changed (${stagedFiles.length}):
`;

  stagedFiles.forEach((file) => {
    const statusMap: Record<string, string> = {
      added: 'new file',
      deleted: 'deleted',
      renamed: 'renamed',
      modified: 'modified',
      untracked: 'new file',
    };
    const fileStatus = statusMap[file.status] || file.status;
    const isSkipped = skippedFiles.some((s) => s.path === file.path);
    const skipNote = isSkipped ? ' [diff skipped]' : '';
    message += `- ${file.path} (${fileStatus})${skipNote}\n`;
  });

  if (skippedFiles.length > 0) {
    message += `\n## Note: ${skippedFiles.length} file(s) had their diffs skipped:\n`;
    skippedFiles.forEach((f) => {
      message += `- ${f.path} (${f.reason})\n`;
    });
    // i18n-ignore (LLM prompt content, not user-facing UI)
    message += `These files are still part of the commit, but their content was not analyzed.\n`;
  }

  if (largeDiffFiles.length > 0) {
    message += `\n## Note: ${largeDiffFiles.length} file(s) had their diffs truncated due to size:\n`;
    largeDiffFiles.forEach((f) => {
      message += `- ${f.path} (${Math.round(f.size / 1024)}KB)\n`;
    });
  }

  if (recentCommits.length > 0) {
    message += '\n## Recent commit messages for context:\n';
    recentCommits.slice(0, 3).forEach((commit) => {
      message += `- ${commit}\n`;
    });
  }

  if (combinedDiff) {
    message += '\n## Diff:\n```diff\n' + combinedDiff + '\n```\n';
  } else if (skippedFiles.length === stagedFiles.length) {
    message += '\n## Diff:\n[All staged files are binary/media/large files - no diff available]\n';
    // i18n-ignore (LLM prompt content, not user-facing UI)
    message +=
      'Please write a commit message based on the file names and your understanding of the changes.\n';
  } else {
    message += '\n## Diff:\n[No diff available - please check git status]\n';
  }

  return message;
}

/**
 * Prepare PR context
 */
async function preparePRContext(
  workspace: Workspace,
  resultTag: string,
  context?: AgentExecutorContext,
): Promise<string> {
  // Commit list via the daemon (`git.commits`, PROTOCOL §5.6). Items carry
  // both the full `hash` and the short `sha`; filtering matches the full hash
  // since `includeCommitHashes` comes from file-tracking commit hashes.
  let commits: GitCommit[] = [];
  if (context?.commits && context.commits.length > 0) {
    commits = context.commits;
  } else if (context?.includeCommitHashes && context.includeCommitHashes.length > 0) {
    const historyResult = await gitClient.getHistory(workspace.id, 50);
    if (historyResult.ok) {
      const hashSet = new Set(context.includeCommitHashes);
      commits = historyResult.data
        .filter((c) => hashSet.has(c.hash))
        .map((c) => ({ sha: c.hash, message: c.message, author: c.author, date: c.date }));
    }
  } else {
    const historyResult = await gitClient.getHistory(workspace.id, 20);
    if (historyResult.ok) {
      commits = historyResult.data.map((c) => ({
        sha: c.hash,
        message: c.message,
        author: c.author,
        date: c.date,
      }));
    }
  }

  const statusResult2 = await gitClient.getStatus(workspace.id);
  if (statusResult2.ok) {
    appStore.dispatch(setGitStatus(workspace.id, statusResult2.data));
  }
  const status = statusResult2.ok ? statusResult2.data : null;

  const includeStagedFiles = context?.includeStagedFiles ?? true;
  const stagedFiles = includeStagedFiles ? status?.files.filter((f) => f.staged) || [] : [];

  // i18n-ignore (LLM prompt content, not user-facing UI)
  let message = `Generate a pull request description for the following changes.

Please provide a comprehensive PR description with sections for Summary, Changes, Testing, and Checklist.

Wrap your final PR description in <<<${resultTag}>>> and <<</${resultTag}>>> tags.

`;

  if (workspace.initialPrompt) {
    // i18n-ignore (LLM prompt content, not user-facing UI)
    message += `## Original Task
The user created this workspace with the following request:
"${workspace.initialPrompt}"

Use this context to write a PR description that explains how these changes fulfill the original request.

`;
  }

  if (stagedFiles.length > 0) {
    // i18n-ignore (LLM prompt content, not user-facing UI)
    message += '## Staged Files (will be committed):\n';
    stagedFiles.forEach((file) => {
      message += `- ${file.path} (${file.status})\n`;
    });
    message += '\n';
  }

  if (commits.length > 0) {
    message += `## Commits (${commits.length}):\n`;
    commits.forEach((commit) => {
      message += `- ${commit.message} (${commit.sha.slice(0, 7)})\n`;
    });
  }

  message += '\n## Branch Information:\n';
  // i18n-ignore (LLM prompt content, not user-facing UI)
  message += `- Current branch: ${status?.branch || 'unknown'}\n`;
  // i18n-ignore (LLM prompt content, not user-facing UI)
  message += `- Base branch: ${context?.baseBranch || context?.targetBranch || 'main'}\n`;

  return message;
}

/**
 * Prepare review context
 */
async function prepareReviewContext(
  workspace: Workspace,
  resultTag: string,
  context?: AgentExecutorContext,
): Promise<string> {
  const filesToReview = context?.reviewFiles || context?.files;

  if (filesToReview && Array.isArray(filesToReview) && filesToReview.length > 0) {
    // i18n-ignore (LLM prompt content, not user-facing UI)
    let message = `Please review the following code changes.

Provide feedback on:
- Potential bugs
- Security issues
- Performance concerns
- Code quality
- Best practices

Wrap your final review in <<<${resultTag}>>> and <<</${resultTag}>>> tags.

`;

    const codeBasePath = workspace.worktreePath || workspace.repositoryPath || workspace.path;

    for (const fileEntry of filesToReview) {
      const filePath = typeof fileEntry === 'string' ? fileEntry : fileEntry.path;
      const fileContent = typeof fileEntry === 'object' ? fileEntry.content : undefined;
      const fileDiff = typeof fileEntry === 'object' ? fileEntry.diff : undefined;

      try {
        let content = fileContent;
        if (!content && !fileDiff && codeBasePath) {
          const fileResult = (await invoke(FILE_CHANNELS.READ, {
            path: `${codeBasePath}/${filePath}`,
          })) as { success: boolean; data?: { content: string }; error?: { message: string } };

          if (fileResult.success && fileResult.data?.content) {
            content = fileResult.data.content;
          }
        }

        message += `## ${filePath}\n`;
        if (fileDiff) {
          message += `### Diff:\n\`\`\`diff\n${fileDiff}\n\`\`\`\n\n`;
        }
        if (content) {
          message += `### Content:\n\`\`\`\n${content}\n\`\`\`\n\n`;
        }
      } catch (error) {
        logger.error(`Failed to read file ${filePath}:`, error);
        message += `## ${filePath}\n[Unable to read file]\n\n`;
      }
    }

    return message;
  }

  return prepareCommitContext(workspace, resultTag);
}

/**
 * Prepare walkthrough context
 */
async function prepareWalkthroughContext(
  workspace: Workspace,

  _resultTag: string,

  _context?: AgentExecutorContext,
): Promise<string> {
  const walkthroughStatusResult = await gitClient.getStatus(workspace.id);
  if (!walkthroughStatusResult.ok) {
    throw new Error("Unable to get git status. Please ensure you're in a git repository.");
  }
  const status = walkthroughStatusResult.data;
  appStore.dispatch(setGitStatus(workspace.id, status));

  const stagedFiles = status.files.filter((file) => file.staged);
  if (stagedFiles.length === 0) {
    throw new Error('No files are staged. Please stage some files to generate a walkthrough.');
  }

  const { combinedDiff, skippedFiles } = await getStagedDiffs(workspace, stagedFiles);

  // i18n-ignore (LLM prompt content, not user-facing UI)
  let message = `Output ONLY a JSON object (no markdown, no explanation) with this structure:
{"title":"Brief title","overview":"One sentence","annotations":[{"file":"path","line":10,"message":"Note"}]}

Analyze these staged changes and create 3-5 annotations highlighting the key changes.

`;

  if (workspace.initialPrompt) {
    message += `Context: "${workspace.initialPrompt}"\n\n`;
  }

  // i18n-ignore (LLM prompt content, not user-facing UI)
  message += `Staged files: ${stagedFiles.map((f) => f.path).join(', ')}\n\n`;

  if (skippedFiles.length > 0) {
    message += `Note: ${skippedFiles.length} file(s) skipped (binary/media/large): ${skippedFiles.map((f) => f.path).join(', ')}\n\n`;
  }

  // i18n-ignore (LLM prompt content, not user-facing UI)
  message += `Diff:\n\`\`\`diff\n${combinedDiff}\n\`\`\`\n\nRespond with ONLY the JSON object.`;

  return message;
}
