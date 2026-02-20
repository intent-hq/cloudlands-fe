/**
 * Comments IPC Client
 *
 * Client-side wrapper for comments IPC communication.
 * Used by renderer process to communicate with main process.
 */

import type { Result, CommandResponse, NoteComment } from '../../shared/types';
import { COMMENTS_CHANNELS } from '$shared/ipc/channels';

export interface ListCommentsParams {
  status?: 'open' | 'resolved' | 'pending' | 'all';
  type?: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session' | 'all';
  author?: string;
}

export interface AddCommentParams {
  id?: string; // Allow frontend to provide its own ID
  workspaceId: string;
  noteId: string;
  content: string;
  type: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
  author: string;
  authorType: 'user' | 'agent';
  section?: string;
  lineStart?: number;
  lineEnd?: number;
  parentId?: string;
  threadId?: string;
  tags?: string;
  // Store exact positions for accurate mark placement
  from?: number;
  to?: number;
  markId?: string;
  agentId?: string;
}

export interface SuggestChangeParams {
  workspaceId: string;
  noteId: string;
  description: string;
  original: string;
  proposed: string;
  author: string;
  authorType: 'user' | 'agent';
  lineStart?: number;
  lineEnd?: number;
  section?: string;
  reason?: string;
  tags?: string;
}

export interface UpdateStatusParams {
  workspaceId: string;
  noteId: string;
  commentId: string;
  status: 'open' | 'resolved' | 'pending';
  resolvedBy?: string;
}

class CommentsClient {
  private async invoke<T>(channel: string, data?: any): Promise<Result<T, string>> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const response = await window.electronAPI.invoke(channel, data);
        return this.commandResponseToResult<T>(response);
      }
      return { ok: false, error: 'IPC not available' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'IPC call failed',
      };
    }
  }

  private commandResponseToResult<T>(response: CommandResponse<T>): Result<T, string> {
    if (response.success && response.data !== undefined) {
      return { ok: true, data: response.data };
    } else {
      return { ok: false, error: response.error || 'Unknown error' };
    }
  }

  async list(
    workspaceId: string,
    noteId: string,
    params?: ListCommentsParams,
  ): Promise<Result<NoteComment[], string>> {
    return this.invoke<NoteComment[]>(COMMENTS_CHANNELS.LIST, {
      workspaceId,
      noteId,
      ...params,
    });
  }

  async add(params: AddCommentParams): Promise<Result<NoteComment, string>> {
    return this.invoke<NoteComment>(COMMENTS_CHANNELS.ADD, params);
  }

  async suggestChange(params: SuggestChangeParams): Promise<Result<NoteComment, string>> {
    return this.invoke<NoteComment>(COMMENTS_CHANNELS.SUGGEST_CHANGE, params);
  }

  async updateStatus(params: UpdateStatusParams): Promise<Result<NoteComment, string>> {
    return this.invoke<NoteComment>(COMMENTS_CHANNELS.UPDATE_STATUS, params);
  }

  async delete(params: {
    workspaceId: string;
    noteId: string;
    commentId: string;
  }): Promise<Result<void, string>> {
    return this.invoke<void>(COMMENTS_CHANNELS.DELETE, params);
  }
}

export const commentsClient = new CommentsClient();
