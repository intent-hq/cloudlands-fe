import { Logger } from '$shared/logger';
import { v4 as uuidv4 } from 'uuid';

import type { ToolCall } from './protocol';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { getProvenanceContextManager } from '$features/workspace/main/provenance/provenance-context-manager';
import { hasTaskBlocks } from '../../../notes/utils/task-block-parser';
import { notesService } from '../../../notes/main/notes.service';
import { assetsService } from '$features/notes/main/assets.service';
import { trackMain } from '$lib/services/analytics/main';
import { WorkspaceId } from '../../../../shared/types/branded-ids';
import {
  noteLink,
  noteUrl,
} from '../../../../shared/constants/intent-links';
import { generateCommentId } from '$shared/utils/comment-id-generator';
import type {
  AgentActionPrimitive,
  CliPrimitive,
  PatchPrimitive,
  ReferencePrimitive,
  ReferenceSnapshot,
  ReferenceTarget,
} from '../../../../shared/types/notes-primitives';

const logger = new Logger('WsNoteApi');

type PrimitiveBlockType = 'reference' | 'cli' | 'patch' | 'agent_action';

export function buildNoteApi(workspaceManager: any, workspaceId: string, call: ToolCall) {
  const requireWorkspaceManager = () => {
    if (!workspaceManager) {
      throw new Error('Workspace manager not available');
    }
    return workspaceManager;
  };

  const emitContentUpdate = (noteId: string, content: string, note?: any) => {
    try {
      sendToWorkspaceWindows(workspaceId, 'note:updated', {
        workspaceId,
        noteId,
        content,
        ...(note ? { note } : {}),
        source: 'agent',
      });
      sendToWorkspaceWindows(workspaceId, `note:content-changed:${workspaceId}`, {
        noteId,
        content,
        source: 'agent',
        workspaceId,
      });
    } catch (error) {
      logger.warn('Failed to emit note content update event', { error: (error as Error).message });
    }
  };

  const emitNoteUpdated = (noteId: string, note: any) => {
    try {
      sendToWorkspaceWindows(workspaceId, 'note:updated', {
        workspaceId,
        noteId,
        note,
        source: 'agent',
      });
    } catch (error) {
      logger.warn('Failed to emit note update event', { error: (error as Error).message });
    }
  };

  const emitNoteDeleted = (noteId: string) => {
    try {
      sendToWorkspaceWindows(workspaceId, `note:deleted:${workspaceId}`, {
        noteId,
        source: 'agent',
        workspaceId,
      });
    } catch (error) {
      logger.warn('Failed to emit note deletion event', { error: (error as Error).message });
    }
  };

  const withProvenance = async <T>(action: string, fn: () => Promise<T>): Promise<T> => {
    const provenanceManager = getProvenanceContextManager();
    const existingContext = provenanceManager.getCurrentContext();
    let contextId: string | undefined;
    let shouldPopContext = false;

    if (!existingContext) {
      const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };
      contextId = provenanceManager.createAgentContext({
        agentId: agentInfo.id || 'agent',
        agentName: agentInfo.name || 'Agent',
        messageId: `msg-${Date.now()}`,
        sessionId: (call as any).metadata?.sessionId,
        turnNumber: (call as any).metadata?.turnNumber,
      });
      shouldPopContext = true;
      logger.debug(`Created provenance context for ${action}`, { contextId, agentId: agentInfo.id });
    }

    try {
      return await fn();
    } finally {
      if (shouldPopContext && contextId) {
        provenanceManager.popContext();
        logger.debug(`Popped provenance context for ${action}`, { contextId });
      }
    }
  };

  const autoConvertTaskBlocks = async (noteId: string, content: string) => {
    if (!content || !hasTaskBlocks(content)) {
      return { convertedCount: 0, createdNoteIds: [] as string[], updatedContent: null as string | null };
    }

    try {
      const conversionResult = await notesService.convertTaskBlocks(WorkspaceId(workspaceId), noteId);
      if (conversionResult.ok) {
        return conversionResult.data;
      }
    } catch (error) {
      logger.warn('Failed to auto-convert task blocks', {
        noteId,
        error: (error as Error).message,
      });
    }

    return { convertedCount: 0, createdNoteIds: [] as string[], updatedContent: null as string | null };
  };

  const emitWithTaskBlockGuard = async (noteId: string, content: string, note: any) => {
    const contentHasTaskBlocks = hasTaskBlocks(content);
    if (!contentHasTaskBlocks) {
      emitContentUpdate(noteId, content, note);
    }
    const conversion = await autoConvertTaskBlocks(noteId, content);
    // If we skipped the initial emit because of task blocks, but the service
    // didn't actually modify the content, emit now as fallback
    if (contentHasTaskBlocks && conversion.updatedContent == null) {
      emitContentUpdate(noteId, content, note);
    }
    return conversion;
  };

  const normalizeTags = (tags?: string | string[]) => {
    if (tags === undefined) return undefined;
    if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
    return String(tags)
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  };

  const toFrontendNote = (note: any) => ({
    id: note.id,
    title: note.title,
    content: note.content,
    contentType: note.contentType || note.content_type || 'markdown',
    tags: note.tags || [],
    isPinned: false,
    isArchived: false,
    visibility: note.visibility || 'workspace',
    createdAt: note.created_at || note.createdAt,
    updatedAt: note.updated_at || note.updatedAt,
    workspaceId,
    is_pinned: false,
    is_archived: false,
    created_at: note.created_at || note.createdAt,
    updated_at: note.updated_at || note.updatedAt,
    author: {
      type: note.author_type || 'agent',
      id: 'agent',
      name: 'Agent',
    },
  });

  const replaceAssetUrlsWithPlaceholders = (content: string) => {
    if (!content) return { content: '', imageDescriptions: [] as string[] };

    let modifiedContent = content;
    const imageDescriptions: string[] = [];
    let imageIndex = 1;
    const imageRegex = /!\[([^\]]*)\]\((workspace-asset:\/\/[^)]+)\)/g;
    const matches: Array<{ fullMatch: string; alt: string; url: string }> = [];

    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(content)) !== null) {
      matches.push({ fullMatch: match[0], alt: match[1], url: match[2] });
    }

    for (const { fullMatch, alt, url } of matches) {
      const urlMatch = url.match(/workspace-asset:\/\/[^/]+\/(.+)/);
      const assetId = urlMatch ? urlMatch[1] : 'unknown';
      const description = alt || assetId || `Image ${imageIndex}`;
      modifiedContent = modifiedContent.replace(fullMatch, `[Image ${imageIndex}: ${description}]`);
      imageDescriptions.push(description);
      imageIndex++;
    }

    return { content: modifiedContent, imageDescriptions };
  };

  const extractImagesFromContent = async (content: string) => {
    if (!content) return [] as Array<{ url: string; data: string; mimeType: string; alt?: string }>;

    const images: Array<{ url: string; data: string; mimeType: string; alt?: string }> = [];
    const imageRegex = /!\[([^\]]*)\]\((workspace-asset:\/\/[^)]+)\)/g;

    let match: RegExpExecArray | null;
    while ((match = imageRegex.exec(content)) !== null) {
      const alt = match[1];
      const url = match[2];
      try {
        const urlMatch = url.match(/workspace-asset:\/\/([^/]+)\/(.+)/);
        if (!urlMatch) continue;
        const assetWorkspaceId = urlMatch[1];
        const assetId = urlMatch[2];

        if (assetWorkspaceId !== workspaceId) {
          logger.warn('Skipping cross-workspace asset reference in ws.note.read', {
            noteWorkspaceId: workspaceId,
            assetWorkspaceId,
            assetId,
          });
          continue;
        }

        const dataUrl = await assetsService.readAssetAsDataUrl(workspaceId, assetId);
        const dataMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataMatch) {
          images.push({
            url,
            data: dataMatch[2],
            mimeType: dataMatch[1],
            alt: alt || undefined,
          });
        }
      } catch (error) {
        logger.warn('Failed to embed image from note in ws.note.read', {
          url,
          error: (error as Error).message,
        });
      }
    }

    return images;
  };

  const findAllOccurrences = (content: string, searchText: string) => {
    const matches: Array<{ from: number; to: number; line: number; surroundingText: string }> = [];
    let searchFrom = 0;

    while (true) {
      const index = content.indexOf(searchText, searchFrom);
      if (index === -1) break;
      const line = content.substring(0, index).split('\n').length;
      const contextStart = Math.max(0, index - 50);
      const contextEnd = Math.min(content.length, index + searchText.length + 50);
      let surroundingText = content.substring(contextStart, contextEnd);
      if (contextStart > 0) surroundingText = `...${surroundingText}`;
      if (contextEnd < content.length) surroundingText = `${surroundingText}...`;
      matches.push({ from: index, to: index + searchText.length, line, surroundingText });
      searchFrom = index + 1;
    }

    return matches;
  };

  const countOccurrences = (content: string, searchText: string) => {
    let count = 0;
    let searchFrom = 0;
    while (true) {
      const index = content.indexOf(searchText, searchFrom);
      if (index === -1) break;
      count++;
      searchFrom = index + 1;
    }
    return count;
  };

  const findSimilarText = (content: string, searchText: string, maxResults: number) => {
    const suggestions: string[] = [];
    const words = searchText.toLowerCase().split(/\s+/);
    const lines = content.split('\n');

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      const matchCount = words.filter((word) => lineLower.includes(word)).length;
      if (matchCount > 0 && matchCount >= words.length * 0.5) {
        suggestions.push(line.trim());
        if (suggestions.length >= maxResults) break;
      }
    }

    return suggestions;
  };

  const findAndAnchorText = (noteContent: string, searchContext: string, commentTarget: string) => {
    const contextMatches = findAllOccurrences(noteContent, searchContext);
    if (contextMatches.length === 0) {
      return {
        success: false as const,
        error: 'CONTEXT_NOT_FOUND',
        message: 'Could not find the search context in the document.',
        details: {
          searchedFor: searchContext,
          suggestions: findSimilarText(noteContent, searchContext, 3),
          tip: 'Check for typos or try a longer, more unique phrase. The search is case-sensitive and whitespace-sensitive.',
        },
      };
    }

    if (contextMatches.length > 1) {
      return {
        success: false as const,
        error: 'CONTEXT_AMBIGUOUS',
        message: 'The search context appears multiple times in the document.',
        details: {
          searchedFor: searchContext,
          matchCount: contextMatches.length,
          matches: contextMatches.slice(0, 5).map((item, index) => ({
            occurrence: index + 1,
            line: item.line,
            context: item.surroundingText,
          })),
          tip:
            contextMatches.length > 5
              ? `Showing first 5 of ${contextMatches.length} matches. Use a longer, more unique phrase that includes surrounding text.`
              : 'Use a longer, more unique phrase that includes surrounding text.',
        },
      };
    }

    const contextMatch = contextMatches[0];
    const relativeIndex = searchContext.indexOf(commentTarget);
    if (relativeIndex === -1) {
      return {
        success: false as const,
        error: 'TARGET_NOT_IN_CONTEXT',
        message: 'The comment target was not found within the search context.',
        details: {
          searchContext,
          commentTarget,
          contextFound: true,
          contextLocation: { line: contextMatch.line, fullText: searchContext },
          tip: 'The comment target must be a substring of the search context. Check for typos.',
        },
      };
    }

    const targetOccurrences = countOccurrences(searchContext, commentTarget);
    if (targetOccurrences > 1) {
      const occurrences = [];
      let searchFrom = 0;
      for (let i = 0; i < targetOccurrences; i++) {
        const index = searchContext.indexOf(commentTarget, searchFrom);
        if (index === -1) continue;
        const before = searchContext.substring(Math.max(0, index - 20), index);
        const after = searchContext.substring(index + commentTarget.length, index + commentTarget.length + 20);
        occurrences.push({
          occurrence: i + 1,
          position: index,
          surrounding: `${before}[${commentTarget}]${after}`,
        });
        searchFrom = index + 1;
      }

      return {
        success: false as const,
        error: 'TARGET_AMBIGUOUS_IN_CONTEXT',
        message: 'The comment target appears multiple times within the search context.',
        details: {
          searchContext,
          commentTarget,
          occurrences,
          tip: "Use a longer target that's unique within the context. For example, include more surrounding words.",
        },
      };
    }

    const from = contextMatch.from + relativeIndex;
    const to = from + commentTarget.length;
    const commentId = generateCommentId();
    return {
      success: true as const,
      from,
      to,
      anchorIds: { startId: commentId, endId: commentId },
      line: contextMatch.line,
    };
  };

  const appendPrimitiveBlock = async (noteId: string, primitive: any, blockType: PrimitiveBlockType) => {
    const manager = requireWorkspaceManager();
    const note = await manager.getNote(workspaceId, noteId);
    if (!note) {
      throw new Error(`Note ${noteId} not found`);
    }

    const wsBlock = `\n\n\`\`\`ws-block:${blockType}\n${JSON.stringify(primitive, null, 2)}\n\`\`\`\n`;
    const updatedContent = (note.content || '') + wsBlock;
    await manager.updateNote(workspaceId, noteId, { content: updatedContent });

    return {
      ok: true,
      primitiveId: primitive.id,
      noteId,
      content: updatedContent,
    };
  };

  return {
    note: {
      async read(id: string) {
        logger.debug('ws.note.read', { noteId: id });
        if (!id) throw new Error('Note ID is required');
        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, id);
        if (!note) throw new Error(`Note not found: ${id}`);

        const embeddedImages = await extractImagesFromContent(note.content || '');
        const { content: contentWithPlaceholders, imageDescriptions } = replaceAssetUrlsWithPlaceholders(
          note.content || '',
        );
        const contentWithLineNumbers = contentWithPlaceholders
          ? contentWithPlaceholders
              .split('\n')
              .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
              .join('\n')
          : '';

        let imagesSummary = '';
        if (embeddedImages.length > 0) {
          imagesSummary = `--- Embedded Images (${embeddedImages.length}) ---\n`;
          imagesSummary += 'The following images are referenced in this note:\n';
          imageDescriptions.forEach((description, index) => {
            imagesSummary += `  ${index + 1}. ${description}\n`;
          });
          imagesSummary +=
            'Note: If you received images in your initial prompt (when the user was viewing this note and sent you a message), you can already see these images there.\n\n';
        }

        let renderedContent = `${imagesSummary}${contentWithLineNumbers}`;
        if (note.metadata?.task) {
          const task = note.metadata.task;
          const dependencies = note.metadata.dependencies || [];
          renderedContent += `\n\n--- Task Metadata ---\nStatus: ${task.status}`;
          if (task.acceptanceCriteria?.length) {
            renderedContent += `\nAcceptance Criteria:\n${task.acceptanceCriteria.map((criterion: string) => `  - ${criterion}`).join('\n')}`;
          }
          if (dependencies.length > 0) {
            renderedContent += `\nDependencies (${dependencies.length}):\n`;
            dependencies.forEach((dependency: any) => {
              renderedContent += `  - ${dependency.noteId} (${dependency.type})${dependency.reason ? `: ${dependency.reason}` : ''}\n`;
            });
          }
          if (task.assignedAgentIds?.length) renderedContent += `\nAssigned Agents: ${task.assignedAgentIds.join(', ')}`;
          if (task.estimatedEffort) renderedContent += `\nEstimated Effort: ${task.estimatedEffort}`;
          if (task.blockedReason) renderedContent += `\nBlocked Reason: ${task.blockedReason}`;
        }

        return {
          id: note.id,
          title: note.title,
          tags: note.tags || [],
          content: renderedContent,
          rawContent: note.content || '',
          totalLines: note.content ? note.content.split('\n').length : 0,
          imageCount: embeddedImages.length,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          images: embeddedImages.map(({ data, ...image }) => image),
          ...(note.metadata?.task
            ? {
                isTask: true,
                taskStatus: note.metadata.task.status,
                taskMetadata: note.metadata.task,
                dependencies: note.metadata.dependencies || [],
              }
            : {}),
        };
      },

      async create(title: string, content: string, tags?: string) {
        logger.debug('ws.note.create', { title });
        if (!title || !content) throw new Error('Title and content are required');
        const manager = requireWorkspaceManager();

        return withProvenance('note creation', async () => {
          const note = await manager.createNote(workspaceId, {
            title,
            content,
            tags: normalizeTags(tags) || [],
            metadata: { author: { id: 'agent', name: 'Agent', type: 'agent' } },
          });
          if (!note) throw new Error('Failed to create note: no note returned from workspace manager');

          try {
            trackMain('Created Note', { note_type: note.metadata?.task ? 'task' : 'regular' });
          } catch {
            // Ignore analytics failures.
          }

          sendToWorkspaceWindows(workspaceId, 'note:created', {
            workspaceId,
            noteId: note.id,
            note: toFrontendNote(note),
          });

          return {
            id: note.id,
            title: note.title,
            tags: note.tags || [],
            link: noteUrl(note.id),
            markdownLink: noteLink(note.title, note.id),
          };
        });
      },

      async list(tag?: string) {
        logger.debug('ws.note.list', { tag });
        const manager = requireWorkspaceManager();
        const notes = await manager.listNotes(workspaceId);
        if (!Array.isArray(notes)) throw new Error('Failed to list notes: invalid response from workspace manager');
        return (tag ? notes.filter((note: any) => note.tags?.includes(tag)) : notes).map((note: any) => ({
          id: note.id,
          title: note.title,
          tags: note.tags,
          created_at: note.created_at || note.createdAt,
          updated_at: note.updated_at || note.updatedAt,
        }));
      },

      async listTasks(id: string) {
        logger.debug('ws.note.listTasks', { noteId: id });
        if (!id) throw new Error('Note ID is required');
        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, id);
        if (!note) throw new Error(`Note not found: ${id}`);

        const lines = (note.content || '').split('\n');
        const taskLineRegex = /^(\s*[-*]\s*)\[([ xX\/])\]\s*(.+)$/;
        const taskLinkPattern = /\[([^\]]+)\]\(intent:\/\/local\/task\/([a-f0-9-]+)\)/;

        return lines.flatMap((line: string, index: number) => {
          const match = line.match(taskLineRegex);
          if (!match) return [];
          const [, , checkbox, taskText] = match;
          const linkMatch = taskText.match(taskLinkPattern);
          const cleanText = linkMatch ? linkMatch[1] : taskText.replace(/<!--agent:[^>]+-->/g, '').trim();
          return [{
            lineNumber: index + 1,
            text: cleanText,
            status:
              checkbox === 'x' || checkbox === 'X'
                ? 'done'
                : checkbox === '/'
                  ? 'in-progress'
                  : 'todo',
            taskNoteId: linkMatch ? linkMatch[2] : null,
          }];
        });
      },

      async readAsset(asset: string) {
        logger.debug('ws.note.readAsset', { asset });
        if (!asset) throw new Error('Asset ID or URL is required');
        const assetId = asset.startsWith('workspace-asset://')
          ? asset.match(/workspace-asset:\/\/[^/]+\/(.+)/)?.[1]
          : asset;
        if (!assetId) throw new Error(`Invalid workspace-asset URL format: ${asset}`);

        const dataUrl = await assetsService.readAssetAsDataUrl(workspaceId, assetId);
        const dataMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!dataMatch) throw new Error('Failed to parse asset data');

        const mimeType = dataMatch[1];
        const data = dataMatch[2];
        const sizeKb = Math.round(data.length / 1024);

        // For image mime types, return as MCP image content block for efficient vision processing
        // (~2,700 tokens for a screenshot vs ~100k+ tokens as base64 text)
        const imageMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (imageMimeTypes.includes(mimeType)) {
          return {
            __mcpContentItems: [
              { type: 'text' as const, text: JSON.stringify({ assetId, mimeType, sizeKb }) },
              { type: 'image' as const, data, mimeType },
            ],
          };
        }

        // Non-image assets: return as text/base64 (existing behavior)
        return {
          assetId,
          mimeType,
          data,
          sizeKb,
        };
      },

      async setContent(id: string, content: string, confirmReplacement?: string | boolean) {
        logger.debug('ws.note.setContent', { noteId: id });
        if (!id) throw new Error('Note ID is required');
        if (content === undefined) {
          throw new Error('Content is required. Use updateMetadata to change only title/tags.');
        }
        const manager = requireWorkspaceManager();

        let oldContent: string | undefined;
        let oldTitle: string | undefined;
        const currentNote = await manager.getNote(workspaceId, id);
        if (currentNote) {
          oldContent = currentNote.content;
          oldTitle = currentNote.title;
        }

        if (oldContent && oldContent.length > 0) {
          const reductionPercent = ((oldContent.length - content.length) / oldContent.length) * 100;
          const confirmed = confirmReplacement === true || confirmReplacement === 'true';
          if (reductionPercent > 50 && !confirmed) {
            throw new Error(
              `⚠️ CONTENT REDUCTION DETECTED: Your new content (${content.length} chars) is ${Math.round(reductionPercent)}% shorter than the existing content (${oldContent.length} chars).\n\nThis will REPLACE the entire note. If you intended to:\n- ADD content: Use note.add instead\n- EDIT a section: Use note.edit instead\n- PROCEED with replacement: Call note.setContent again with confirmReplacement=true`,
            );
          }
        }

        return withProvenance('note update', async () => {
          let cleanContent = content;
          if (typeof cleanContent === 'string') {
            if (cleanContent.startsWith('"') || cleanContent.startsWith('\\"')) {
              cleanContent = cleanContent.substring(1);
              if (cleanContent.endsWith('"') || cleanContent.endsWith('\\"')) {
                cleanContent = cleanContent.substring(0, cleanContent.length - 1);
              }
            }
            if (cleanContent.includes('": ') && !cleanContent.includes('\n')) {
              const match = cleanContent.match(/:\s*"?(.+)"?$/);
              if (match) cleanContent = match[1];
            }
            if (cleanContent.length < 50 && !cleanContent.includes('\n') && cleanContent.endsWith('...')) {
              throw new Error('Content appears to be truncated. Please provide the complete content.');
            }
            if (cleanContent.trim().length === 0) {
              throw new Error('Content cannot be empty.');
            }
          } else {
            cleanContent = String(content);
          }

          const note = await manager.updateNote(workspaceId, id, { content: cleanContent });
          if (!note) throw new Error(`Note not found: ${id}`);

          const conversion = await emitWithTaskBlockGuard(id, cleanContent, toFrontendNote(note));

          return {
            ok: true,
            noteId: note.id,
            title: note.title,
            previousTitle: oldTitle,
            updatedAt: note.updated_at || note.updatedAt,
            oldContent,
            newContent: note.content,
            convertedCount: conversion.convertedCount,
            createdTaskNoteIds: conversion.createdNoteIds,
          };
        });
      },

      async add(id: string, options: { content: string; heading?: string; position?: string }) {
        logger.debug('ws.note.add', { noteId: id, position: options?.position });
        if (!id) throw new Error('Note ID is required');
        if (!options?.content) throw new Error('Content is required');
        const manager = requireWorkspaceManager();
        const currentNote = await manager.getNote(workspaceId, id);
        if (!currentNote) throw new Error(`Note not found: ${id}`);

        const oldContent = currentNote.content || '';
        const addSection = options.heading ? `${options.heading}\n\n${options.content}` : options.content;
        let newContent: string;
        let positionInfo = 'at end';

        if (!options.position || options.position === 'end') {
          newContent = oldContent + '\n\n' + addSection;
        } else if (options.position === 'start') {
          newContent = addSection + '\n\n' + oldContent;
          positionInfo = 'at start';
        } else if (options.position.startsWith('after:')) {
          const afterHeading = options.position.substring(6).trim();
          const headingIndex = oldContent.indexOf(afterHeading);
          if (headingIndex === -1) {
            throw new Error(`Heading not found: "${afterHeading}". Use position="end" or specify an existing heading.`);
          }
          const lineEnd = oldContent.indexOf('\n', headingIndex);
          const insertPoint = lineEnd === -1 ? oldContent.length : lineEnd;
          const afterHeadingContent = oldContent.substring(insertPoint);
          const nextHeadingMatch = afterHeadingContent.match(/\n(#{1,6}\s)/);
          const insertAt = nextHeadingMatch ? insertPoint + nextHeadingMatch.index! : oldContent.length;
          newContent = oldContent.substring(0, insertAt) + '\n\n' + addSection + oldContent.substring(insertAt);
          positionInfo = `after "${afterHeading}"`;
        } else {
          throw new Error(`Invalid position: "${options.position}". Use "end", "start", or "after:HEADING".`);
        }

        return withProvenance('note add', async () => {
          const note = await manager.updateNote(workspaceId, id, { content: newContent });
          if (!note) throw new Error(`Failed to update note: ${id}`);
          const conversion = await emitWithTaskBlockGuard(id, newContent, note);
          return {
            ok: true,
            noteId: note.id,
            addedLength: options.content.length,
            totalLength: newContent.length,
            position: positionInfo,
            oldContent,
            newContent,
            convertedCount: conversion.convertedCount,
            createdTaskNoteIds: conversion.createdNoteIds,
          };
        });
      },

      async edit(id: string, options: { old: string; new: string }) {
        logger.debug('ws.note.edit', { noteId: id });
        if (!id) throw new Error('Note ID is required');
        if (options?.old === undefined || options.old === '') {
          throw new Error('old is required and cannot be empty');
        }
        if (options?.new === undefined) throw new Error('new is required');
        const manager = requireWorkspaceManager();
        const currentNote = await manager.getNote(workspaceId, id);
        if (!currentNote) throw new Error(`Note not found: ${id}`);

        const oldContent = currentNote.content || '';
        let newContent: string;
        let matchIndex = -1;
        let wasEmpty = false;

        if (oldContent.length === 0) {
          newContent = options.new;
          wasEmpty = true;
        } else {
          matchIndex = oldContent.indexOf(options.old);
          if (matchIndex === -1) {
            throw new Error(
              `Text not found in note. Make sure old matches exactly (including whitespace and line breaks).\n\nNote content length: ${oldContent.length} chars.\n\nSearched for:\n${options.old.substring(0, 200)}${options.old.length > 200 ? '...' : ''}`,
            );
          }
          newContent = oldContent.substring(0, matchIndex) + options.new + oldContent.substring(matchIndex + options.old.length);
        }

        return withProvenance('note edit', async () => {
          const note = await manager.updateNote(workspaceId, id, { content: newContent });
          if (!note) throw new Error(`Failed to update note: ${id}`);
          const conversion = await emitWithTaskBlockGuard(id, newContent, note);
          return {
            ok: true,
            noteId: note.id,
            oldTextLength: wasEmpty ? 0 : options.old.length,
            newTextLength: options.new.length,
            matchPosition: matchIndex,
            oldContent,
            newContent,
            convertedCount: conversion.convertedCount,
            createdTaskNoteIds: conversion.createdNoteIds,
          };
        });
      },

      async editLines(id: string, options: { start: number | string; end: number | string; content: string }) {
        logger.debug('ws.note.editLines', { noteId: id, start: options?.start, end: options?.end });
        if (!id) throw new Error('Note ID is required');
        const startLine = parseInt(String(options?.start), 10);
        const endLine = parseInt(String(options?.end), 10);
        if (isNaN(startLine) || startLine < 1) throw new Error('start must be a positive integer');
        if (isNaN(endLine) || endLine < 1) throw new Error('end must be a positive integer');
        if (startLine > endLine) throw new Error('start cannot be greater than end');
        if (options?.content === undefined) throw new Error('content is required');

        const manager = requireWorkspaceManager();
        const currentNote = await manager.getNote(workspaceId, id);
        if (!currentNote) throw new Error(`Note not found: ${id}`);
        const oldContent = currentNote.content || '';

        let newContent: string;
        if (oldContent.length === 0) {
          newContent = options.content;
        } else {
          const lines = oldContent.split('\n');
          if (startLine > lines.length) throw new Error(`start (${startLine}) exceeds total lines in note (${lines.length})`);
          if (endLine > lines.length) throw new Error(`end (${endLine}) exceeds total lines in note (${lines.length})`);
          const beforeLines = lines.slice(0, startLine - 1);
          const afterLines = lines.slice(endLine);
          const newLines = options.content.length > 0 ? options.content.split('\n') : [];
          newContent = [...beforeLines, ...newLines, ...afterLines].join('\n');
        }

        return withProvenance('note line edit', async () => {
          const note = await manager.updateNote(workspaceId, id, { content: newContent });
          if (!note) throw new Error(`Failed to update note: ${id}`);
          const conversion = await emitWithTaskBlockGuard(id, newContent, note);
          return {
            ok: true,
            noteId: note.id,
            startLine,
            endLine,
            totalLinesBefore: oldContent.split('\n').length,
            totalLinesAfter: newContent.split('\n').length,
            oldContent,
            newContent,
            convertedCount: conversion.convertedCount,
            createdTaskNoteIds: conversion.createdNoteIds,
          };
        });
      },

      async updateMetadata(id: string, options: { title?: string; tags?: string | string[] }) {
        logger.debug('ws.note.updateMetadata', { noteId: id });
        if (!id) throw new Error('Note ID is required');
        if (options?.title === undefined && options?.tags === undefined) {
          throw new Error('At least one of title or tags must be provided');
        }

        const manager = requireWorkspaceManager();
        const currentNote = await manager.getNote(workspaceId, id);
        if (!currentNote) throw new Error(`Note not found: ${id}`);

        const updateData: any = {};
        if (options.title !== undefined && id !== 'spec') updateData.title = options.title;
        if (options.tags !== undefined) updateData.tags = normalizeTags(options.tags) || [];

        if (Object.keys(updateData).length === 0) {
          return { ok: true, noteId: id, skipped: true, reason: 'spec title cannot be modified' };
        }

        const note = await manager.updateNote(workspaceId, id, updateData);
        if (!note) throw new Error(`Failed to update note: ${id}`);
        return {
          ok: true,
          noteId: note.id,
          title: note.title,
          tags: note.tags,
          updatedAt: note.updated_at || note.updatedAt,
        };
      },

      async delete(id: string) {
        logger.debug('ws.note.delete', { noteId: id });
        if (!id) throw new Error('Note ID is required');
        const manager = requireWorkspaceManager();
        return withProvenance('note deletion', async () => {
          const deleted = await manager.deleteNote(workspaceId, id);
          if (!deleted) throw new Error(`Note not found: ${id}`);
          emitNoteDeleted(id);
          return { ok: true, noteId: id, deleted: true };
        });
      },
    },

    comment: {
      async add(noteId: string, options: { searchContext: string; commentTarget: string; comment: string; type?: string; author?: string }) {
        logger.debug('ws.comment.add', { noteId });
        if (!noteId) throw new Error('Note ID is required');
        if (!options?.comment?.trim()) throw new Error('Comment text is required and must be non-empty');
        if (!options?.searchContext?.trim()) throw new Error('searchContext is required and must be non-empty');
        if (!options?.commentTarget?.trim()) throw new Error('commentTarget is required and must be non-empty');

        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, noteId);
        if (!note) throw new Error(`Note not found: ${noteId}`);

        const searchResult = findAndAnchorText(note.content || '', options.searchContext, options.commentTarget);
        if (!searchResult.success) {
          const error: any = new Error(searchResult.message);
          error.details = searchResult.details;
          throw error;
        }

        const { from, to, anchorIds, line } = searchResult;
        const anchoredText = (note.content || '').substring(from, to);
        const newContent = `${(note.content || '').substring(0, from)}<!--anchor:${anchorIds.startId}:start-->${anchoredText}<!--anchor:${anchorIds.endId}:end-->${(note.content || '').substring(to)}`;

        const updateResult = await manager.updateNote({ workspaceId, id: noteId, content: newContent });
        if (!updateResult?.ok) {
          throw new Error(`Failed to update note with anchors: ${updateResult?.error || 'Unknown error'}`);
        }

        const commentResult = await manager.addComment({
          workspaceId,
          noteId,
          id: anchorIds.startId,
          content: options.comment,
          type: (options.type || 'comment') as any,
          author: options.author || 'Agent',
          authorType: 'agent',
          from,
          to,
          markId: `${anchorIds.startId}:start|${anchorIds.endId}:end`,
          section: anchoredText,
        });
        if (!commentResult?.ok) throw new Error(`Failed to add comment: ${commentResult?.error || 'Unknown error'}`);

        return {
          success: true,
          message: `Comment successfully anchored to "${anchoredText}"`,
          commentId: commentResult.data.id,
          anchored: true,
          location: { line, anchoredText },
        };
      },

      async list(noteId: string, options: { since?: string; authorType?: string; status?: string; includeComments?: boolean } = {}) {
        logger.debug('ws.comment.list', { noteId });
        if (!noteId) throw new Error('Note ID is required');
        let sinceDate: Date | null = null;
        if (options.since) {
          sinceDate = new Date(options.since);
          if (isNaN(sinceDate.getTime())) {
            throw new Error(`Invalid 'since' timestamp: ${options.since}. Must be ISO 8601 format.`);
          }
        }
        if (options.authorType && !['user', 'agent'].includes(options.authorType)) {
          throw new Error(`Invalid 'authorType': ${options.authorType}. Must be 'user' or 'agent'.`);
        }
        if (options.status && !['open', 'resolved', 'pending'].includes(options.status)) {
          throw new Error(`Invalid 'status': ${options.status}. Must be 'open', 'resolved', or 'pending'.`);
        }

        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, noteId);
        if (!note) throw new Error(`Note not found: ${noteId}`);

        const result = await manager.listComments({ workspaceId, noteId });
        if (!result?.ok) return { threads: [], totalThreads: 0, totalComments: 0 };

        const threadMap = new Map<string, any[]>();
        for (const comment of result.data || []) {
          const threadId = comment.threadId || comment.id;
          if (!threadMap.has(threadId)) threadMap.set(threadId, []);
          threadMap.get(threadId)!.push(comment);
        }

        let threads = Array.from(threadMap.entries()).map(([threadId, threadComments]) => {
          threadComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          const rootComment = threadComments.find((comment) => !comment.parentId) || threadComments[0];
          const latestComment = threadComments.reduce((latest, current) =>
            new Date(current.updatedAt).getTime() > new Date(latest.updatedAt).getTime() ? current : latest,
          );
          const threadStatus = threadComments.some((comment) => comment.status === 'open')
            ? 'open'
            : threadComments.every((comment) => comment.status === 'resolved')
              ? 'resolved'
              : 'pending';
          const lastActivity = threadComments.reduce(
            (latest, current) =>
              new Date(current.updatedAt).getTime() > new Date(latest).getTime() ? current.updatedAt : latest,
            threadComments[0].updatedAt,
          );
          return {
            threadId,
            noteId,
            targetedText: rootComment.section || null,
            anchorId: rootComment.markId || null,
            status: threadStatus,
            createdAt: rootComment.createdAt,
            lastActivity,
            latestCommentAuthor: latestComment.author,
            latestCommentAuthorType: latestComment.authorType,
            latestCommentAt: latestComment.updatedAt,
            commentCount: threadComments.length,
            ...(options.includeComments ? { comments: threadComments } : {}),
          };
        });

        if (sinceDate) threads = threads.filter((thread) => new Date(thread.lastActivity) > sinceDate!);
        if (options.authorType) threads = threads.filter((thread) => thread.latestCommentAuthorType === options.authorType);
        if (options.status) threads = threads.filter((thread) => thread.status === options.status);

        threads.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

        return {
          threads,
          totalThreads: threads.length,
          totalComments: threads.reduce((sum, thread) => sum + thread.commentCount, 0),
        };
      },

      async getThread(noteId: string, options: { threadId?: string; commentId?: string }) {
        logger.debug('ws.comment.getThread', { noteId, ...options });
        if (!noteId) throw new Error('Note ID is required');
        if (!options?.threadId && !options?.commentId) {
          throw new Error('Either threadId or commentId must be provided');
        }

        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, noteId);
        if (!note) throw new Error(`Note not found: ${noteId}`);
        const result = await manager.listComments({ workspaceId, noteId });
        if (!result?.ok) throw new Error('Failed to retrieve comments');

        const allComments = result.data || [];
        let targetThreadId = options.threadId;
        if (!targetThreadId && options.commentId) {
          const comment = allComments.find((item: any) => item.id === options.commentId);
          if (!comment) throw new Error(`Comment not found: ${options.commentId}`);
          targetThreadId = comment.threadId;
        }

        const threadComments = allComments.filter((item: any) => item.threadId === targetThreadId);
        if (threadComments.length === 0) throw new Error(`Thread not found: ${targetThreadId}`);

        threadComments.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const rootComment = threadComments.find((item: any) => !item.parentId) || threadComments[0];
        return {
          threadId: targetThreadId,
          noteId,
          rootComment,
          replies: threadComments.filter((item: any) => item.parentId),
          totalComments: threadComments.length,
          status: threadComments.every(
            (item: any) => item.status === 'resolved' || item.status === 'accepted' || item.status === 'rejected',
          )
            ? 'resolved'
            : 'open',
        };
      },

      async respond(noteId: string, options: { threadId?: string; commentId?: string; comment: string; type?: string; author?: string; suggestionOriginal?: string; suggestionProposed?: string }) {
        logger.debug('ws.comment.respond', { noteId, ...options });
        if (!noteId) throw new Error('Note ID is required');
        if (!options?.threadId && !options?.commentId) {
          throw new Error('Either threadId or commentId must be provided');
        }
        if (!options?.comment?.trim()) throw new Error('Comment text is required and must be non-empty');
        if (options.type === 'suggestion' && (!options.suggestionOriginal || !options.suggestionProposed)) {
          throw new Error("For type='suggestion', both suggestionOriginal and suggestionProposed are required");
        }

        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, noteId);
        if (!note) throw new Error(`Note not found: ${noteId}`);
        const result = await manager.listComments({ workspaceId, noteId });
        if (!result?.ok) throw new Error('Failed to retrieve comments');

        const allComments = result.data || [];
        let targetThreadId = options.threadId;
        let parentComment = null;
        if (!targetThreadId && options.commentId) {
          parentComment = allComments.find((item: any) => item.id === options.commentId);
          if (!parentComment) throw new Error(`Comment not found: ${options.commentId}`);
          targetThreadId = parentComment.threadId;
        }

        const threadComments = allComments.filter((item: any) => item.threadId === targetThreadId);
        if (threadComments.length === 0) throw new Error(`Thread not found: ${targetThreadId}`);

        threadComments.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (!parentComment) parentComment = threadComments[0];

        const commentData: any = {
          noteId,
          content: options.comment,
          author: options.author || 'Agent',
          authorType: 'agent',
          type: options.type || 'comment',
          status: 'open',
          section: parentComment.section,
          threadId: targetThreadId,
          parentId: parentComment.id,
          markId: parentComment.markId,
        };
        if (commentData.type === 'suggestion' && options.suggestionOriginal && options.suggestionProposed) {
          commentData.suggestionDiff = {
            original: options.suggestionOriginal,
            proposed: options.suggestionProposed,
          };
        }

        const addResult = await manager.addComment({ workspaceId, ...commentData });
        if (!addResult?.ok) throw new Error('Failed to add reply to thread');

        return {
          success: true,
          message: 'Reply added successfully',
          comment: addResult.data,
          thread: {
            threadId: targetThreadId,
            totalComments: threadComments.length + 1,
          },
        };
      },

      async delete(noteId: string, commentId: string) {
        logger.debug('ws.comment.delete', { noteId, commentId });
        if (!noteId) throw new Error('Note ID is required');
        if (!commentId) throw new Error('Comment ID is required');
        const manager = requireWorkspaceManager();
        const result = await manager.deleteComment({ workspaceId, noteId, commentId });
        if (!result?.ok) throw new Error(result?.error || 'Failed to delete comment');
        return { success: true, message: `Comment ${commentId} deleted from note ${noteId}` };
      },
    },

    task: {
      async updateStatus(noteId: string, taskText: string, status: 'done' | 'todo' | 'in-progress') {
        logger.debug('ws.task.updateStatus', { noteId, status });
        if (!noteId) throw new Error('Note ID is required');
        if (!taskText) throw new Error('Task text is required to identify the task');
        if (!['done', 'todo', 'in-progress'].includes(status)) {
          throw new Error("Status must be 'done', 'todo', or 'in-progress'");
        }

        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, noteId);
        if (!note) throw new Error(`Note not found: ${noteId}`);

        const checkboxMap = { todo: '[ ]', 'in-progress': '[/]', done: '[x]' };
        const normalizedTaskText = String(taskText).trim();
        const escapedTaskText = normalizedTaskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const taskLineRegex = new RegExp(`^(\\s*-\\s*)\\[([ x/])\\](\\s*)${escapedTaskText}(\\s*)$`, 'gm');
        let found = false;
        const currentContent = note.content || '';
        const updatedContent = currentContent.replace(taskLineRegex, (_match: string, prefix: string, _checkbox: string, space1: string, space2: string) => {
          found = true;
          return `${prefix}${checkboxMap[status]}${space1}${normalizedTaskText}${space2}`;
        });

        const finalContent = found
          ? updatedContent
          : (() => {
              const lines = currentContent.split('\n');
              const lineIndex = lines.findIndex((line: string) => /^\s*-\s*\[[ x/]\]/.test(line) && line.includes(normalizedTaskText));
              if (lineIndex === -1) {
                throw new Error(`Task not found: "${normalizedTaskText}". Make sure the task text matches exactly.`);
              }
              lines[lineIndex] = lines[lineIndex].replace(/\[[ x/]\]/, checkboxMap[status]);
              return lines.join('\n');
            })();

        await manager.updateNote(workspaceId, noteId, { content: finalContent });
        emitContentUpdate(noteId, finalContent);
        return { ok: true, noteId, taskText: normalizedTaskText, status };
      },

      async updateNoteStatus(noteId: string, status: string) {
        logger.debug('ws.task.updateNoteStatus', { noteId, status });
        if (!noteId) throw new Error('Note ID is required');
        const validStatuses = ['not_started', 'waiting', 'discussion_needed', 'in_progress', 'review_required', 'complete', 'cancelled'];
        if (!status || !validStatuses.includes(status)) {
          throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
        }

        const manager = requireWorkspaceManager();
        const result = await manager.updateTaskStatus(workspaceId, noteId, status);
        if (!result?.success) throw new Error(result?.error || 'Unknown error updating task status');
        emitNoteUpdated(noteId, result.data);
        return { ok: true, noteId, status, note: result.data };
      },

      async update(noteId: string, line: number, options: { text?: string; status?: 'todo' | 'in-progress' | 'done'; expected?: string }) {
        logger.debug('ws.task.update', { noteId, line });
        if (!noteId) throw new Error('Note ID is required');
        if (line === undefined || line === null) throw new Error('Line number is required');
        if (options?.text === undefined && options?.status === undefined) {
          throw new Error('Either text or status (or both) must be provided');
        }
        const lineNum = Number(line);
        if (isNaN(lineNum) || lineNum < 1) throw new Error('Line number must be a positive integer');
        if (options.status && !['todo', 'in-progress', 'done'].includes(options.status)) {
          throw new Error("Status must be 'todo', 'in-progress', or 'done'");
        }

        const manager = requireWorkspaceManager();
        const note = await manager.getNote(workspaceId, noteId);
        if (!note) throw new Error(`Note not found: ${noteId}`);

        const lines = (note.content || '').split('\n');
        if (lineNum > lines.length) throw new Error(`Line ${lineNum} does not exist. Note has ${lines.length} lines.`);
        const currentLine = lines[lineNum - 1];
        const taskMatch = currentLine.match(/^(\s*-\s*)\[([ x/])\]\s*(.*)$/);
        if (!taskMatch) {
          throw new Error(`Line ${lineNum} is not a task. Expected format: "- [ ] task text". Found: "${currentLine.substring(0, 50)}${currentLine.length > 50 ? '...' : ''}"`);
        }

        const [, prefix, currentCheckbox, currentTaskText] = taskMatch;
        if (options.expected !== undefined && String(options.expected).trim() !== currentTaskText.trim()) {
          throw new Error(`Conflict detected: Task content has changed.\nExpected: "${String(options.expected).trim()}"\nActual: "${currentTaskText.trim()}"\nAnother agent may have modified this task. Please re-read the note and try again.`);
        }

        const checkboxMap: Record<string, string> = { todo: '[ ]', 'in-progress': '[/]', done: '[x]' };
        const currentStatus = currentCheckbox === 'x' ? 'done' : currentCheckbox === '/' ? 'in-progress' : 'todo';
        const nextStatus = options.status || currentStatus;
        const finalText = options.text !== undefined ? String(options.text).trim() : currentTaskText;

        lines[lineNum - 1] = `${prefix}${checkboxMap[nextStatus]} ${finalText}`;
        const updatedContent = lines.join('\n');
        await manager.updateNote(workspaceId, noteId, { content: updatedContent });
        emitContentUpdate(noteId, updatedContent);

        return {
          ok: true,
          noteId,
          lineNumber: lineNum,
          previousText: currentTaskText,
          newText: finalText,
          status: nextStatus,
        };
      },

      async getMyTask(taskNoteId: string) {
        logger.debug('ws.task.getMyTask', { taskNoteId });
        const manager = requireWorkspaceManager();
        const result = await manager.getNote({ noteId: taskNoteId, workspaceId });
        if (!result?.ok) throw new Error(result?.error || 'Task note not found');
        if (!result.data.metadata?.task) throw new Error('Note is not a task');

        const note = result.data;
        const allNotes = await manager.listNotes(workspaceId);
        const subtasks = allNotes.filter(
          (item: { parentId?: string; metadata?: { task?: unknown } }) => item.parentId === note.id && item.metadata?.task,
        );

        return {
          noteId: note.id,
          title: note.title,
          content: note.content || '',
          status: note.metadata.task.status,
          taskMetadata: note.metadata.task,
          parentId: note.parentId || null,
          subtasks: subtasks.map((item: any) => ({
            id: item.id,
            title: item.title,
            status: item.metadata?.task?.status || 'unknown',
          })),
          assignedAgents: note.metadata.task.assignedAgentIds || [],
        };
      },

      async markAsTask(noteId: string, status: string, options: { acceptanceCriteria?: string[] | string; effort?: string } = {}) {
        logger.debug('ws.task.markAsTask', { noteId, status });
        const manager = requireWorkspaceManager();
        const taskMetadata: any = { status };
        if (options.acceptanceCriteria) {
          taskMetadata.acceptanceCriteria = Array.isArray(options.acceptanceCriteria)
            ? options.acceptanceCriteria
            : (() => {
                try {
                  return JSON.parse(options.acceptanceCriteria);
                } catch {
                  return [options.acceptanceCriteria];
                }
              })();
        }
        if (options.effort) taskMetadata.estimatedEffort = options.effort;

        const result = await manager.markAsTask({ workspaceId, noteId, taskMetadata });
        if (!result?.ok) throw new Error(result?.error || 'Failed to mark as task');
        return { ok: true, noteId, status };
      },

      async convertBlocks(noteId: string) {
        logger.debug('ws.task.convertBlocks', { noteId });
        const manager = requireWorkspaceManager();
        const result = await manager.convertTaskBlocks({ workspaceId, noteId });
        if (!result?.ok) throw new Error(result?.error || 'Failed to convert task blocks');
        return { ok: true, convertedCount: result.data.convertedCount, createdNoteIds: result.data.createdNoteIds };
      },

      async createPrerequisite(dependentNoteId: string, title: string, options: { content?: string; status?: string } = {}) {
        logger.debug('ws.task.createPrerequisite', { dependentNoteId, title });
        const manager = requireWorkspaceManager();
        const result = await manager.createPrerequisiteNote({
          workspaceId,
          dependentNoteId,
          prerequisite: {
            title,
            content: options.content || '',
            taskMetadata: { status: options.status || 'not_started' },
          },
        });
        if (!result?.ok) throw new Error(result?.error || 'Failed to create prerequisite');
        return {
          ok: true,
          prerequisiteNoteId: result.data.prerequisiteNote.id,
          dependentNoteId,
          title: result.data.prerequisiteNote.title,
        };
      },

      async assignAgent(noteId: string, agentId: string) {
        logger.debug('ws.task.assignAgent', { noteId, agentId });
        const agentIdPattern = /^agent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!agentIdPattern.test(agentId)) {
          throw new Error(
            `Invalid agentId format: "${agentId}". Agent IDs must be in format "agent-{uuid}" (e.g., "agent-b0a8044a-5eac-4b52-8456-15d3b784decb"). To create a new agent and assign it to this task, use create_agent with taskNoteId="${noteId}" instead.`,
          );
        }

        const manager = requireWorkspaceManager();
        const result = await manager.assignAgentToTask({ workspaceId, noteId, agentId });
        if (!result?.ok) throw new Error(result?.error || 'Failed to assign agent');
        return { ok: true, noteId, agentId };
      },
    },

    primitive: {
      async addReference(noteId: string, semanticId: string, description: string, snapshot?: string) {
        logger.debug('ws.primitive.addReference', { noteId, semanticId });
        const target: ReferenceTarget = {
          kind: semanticId.includes('#symbol:') ? 'symbol' : 'file_range',
          semanticId,
        };
        const primitive: ReferencePrimitive = {
          id: uuidv4(),
          version: 1,
          type: 'reference',
          createdAt: new Date().toISOString(),
          createdBy: 'agent',
          target,
          description,
          snapshot: snapshot
            ? ({ code: snapshot, filePath: semanticId.split('#')[0], language: 'typescript' } as ReferenceSnapshot)
            : undefined,
        };
        return appendPrimitiveBlock(noteId, primitive, 'reference');
      },

      async addCli(noteId: string, command: string, description: string, workingDirectory?: string) {
        logger.debug('ws.primitive.addCli', { noteId, command });
        const primitive: CliPrimitive = {
          id: uuidv4(),
          version: 1,
          type: 'cli',
          createdAt: new Date().toISOString(),
          createdBy: 'agent',
          command,
          description,
          cwd: workingDirectory || './',
          display: { showCommandPrefix: '$' },
        };
        return appendPrimitiveBlock(noteId, primitive, 'cli');
      },

      async addPatch(noteId: string, filePath: string, diff: string, description: string) {
        logger.debug('ws.primitive.addPatch', { noteId, filePath });
        const primitive: PatchPrimitive = {
          id: uuidv4(),
          version: 1,
          type: 'patch',
          createdAt: new Date().toISOString(),
          createdBy: 'agent',
          description,
          patches: [{ filePath, diff }],
        };
        return appendPrimitiveBlock(noteId, primitive, 'patch');
      },

      async addAgentAction(noteId: string, agentId: string, goal: string, description: string) {
        logger.debug('ws.primitive.addAgentAction', { noteId, agentId });
        const primitive: AgentActionPrimitive = {
          id: uuidv4(),
          version: 1,
          type: 'agent_action',
          createdAt: new Date().toISOString(),
          createdBy: 'agent',
          agentId,
          goal,
          description,
          inputs: [],
        };
        return appendPrimitiveBlock(noteId, primitive, 'agent_action');
      },
    },
  };
}