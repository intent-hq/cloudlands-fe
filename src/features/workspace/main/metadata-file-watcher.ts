import { EventEmitter } from '$shared/utils/event-emitter';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '$shared/logger';
import { WorkspaceId } from '$shared/types';
import { createHash } from 'crypto';
import { UnifiedWorkspaceWatcher, type WatchEvent } from './unified-workspace-watcher';

const logger = new Logger('MetadataFileWatcher');

export interface MetadataChangeEvent {
  workspaceId: WorkspaceId;
  type: 'note' | 'comment' | 'workspace' | 'activity' | 'git';
  fileType: string;
  filePath: string;
  action: 'add' | 'change' | 'unlink';
  noteId?: string;
  content?: string;
  timestamp: string;
}

/**
 * Watches workspace metadata files for changes and emits events
 * Monitors: notes/*.json, notes/*.comments.json, workspace.json, activity-log.json, git-tracking.json
 */
export class MetadataFileWatcher extends EventEmitter {
  private unsubscribe: (() => void) | null = null;
  private workspaceId: WorkspaceId;
  private workspacePath: string;
  private contentHashes: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 500;

  constructor(workspaceId: WorkspaceId, workspacePath: string) {
    super();
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
  }

  /**
   * Check if a path exists
   */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start watching metadata files
   */
  async start(): Promise<void> {
    if (this.unsubscribe) {
      logger.warn(`[MetadataFileWatcher] Already watching workspace ${this.workspaceId}`);
      return;
    }

    logger.info(`[MetadataFileWatcher] Starting watcher for workspace ${this.workspaceId}`, {
      workspacePath: this.workspacePath,
      exists: await this.pathExists(this.workspacePath),
    });

    // Initialize content hashes for existing files
    await this.initializeHashes();

    // Subscribe to the unified workspace watcher with patterns for metadata files
    const unifiedWatcher = UnifiedWorkspaceWatcher.getInstance(
      this.workspaceId,
      this.workspacePath,
    );

    this.unsubscribe = unifiedWatcher.subscribe({
      id: `metadata-file-watcher:${this.workspaceId}`,
      pathPatterns: ['notes/', 'workspace.json', 'activity-log.json', 'git-tracking.json'],
      eventTypes: ['add', 'change', 'unlink'],
      callback: (event: WatchEvent) => {
        this.handleFileChange(event.path, event.type as 'add' | 'change' | 'unlink');
      },
      onError: (error) => {
        this.emit('error', error);
      },
      onRescanRequired: async () => {
        logger.info(`[MetadataFileWatcher] Rescan required for workspace ${this.workspaceId}`);
        await this.initializeHashes();
        await this.checkForChanges();
      },
    });

    logger.info(`[MetadataFileWatcher] Subscribed to unified watcher for workspace ${this.workspaceId}`, {
      patterns: ['notes/', 'workspace.json', 'activity-log.json', 'git-tracking.json'],
    });
  }

  /**
   * Initialize content hashes for existing files
   */
  private async initializeHashes(): Promise<void> {
    const notesDir = path.join(this.workspacePath, 'notes');
    logger.info(`[MetadataFileWatcher] Initializing hashes for ${this.workspaceId}`, {
      workspacePath: this.workspacePath,
      notesDir,
      notesDirExists: await this.pathExists(notesDir),
    });

    try {
      // Hash notes files
      if (await this.pathExists(notesDir)) {
        const files = await fs.readdir(notesDir);
        logger.debug(`[MetadataFileWatcher] Found ${files.length} files in notes dir`);

        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(notesDir, file);
            try {
              const content = await fs.readFile(filePath, 'utf-8');
              const hash = this.hashContent(content);
              this.contentHashes.set(filePath, hash);
              logger.debug(`[MetadataFileWatcher] Hashed ${file}: ${hash.substring(0, 8)}...`);
            } catch (error) {
              logger.debug(`[MetadataFileWatcher] Could not hash ${file}`);
            }
          }
        }
      }

      // Hash workspace.json
      const workspaceJsonPath = path.join(this.workspacePath, 'workspace.json');
      if (await this.pathExists(workspaceJsonPath)) {
        try {
          const content = await fs.readFile(workspaceJsonPath, 'utf-8');
          const hash = this.hashContent(content);
          this.contentHashes.set(workspaceJsonPath, hash);
          logger.debug(`[MetadataFileWatcher] Hashed workspace.json: ${hash.substring(0, 8)}...`);
        } catch (error) {
          logger.debug('[MetadataFileWatcher] Could not hash workspace.json');
        }
      }

      logger.info(`[MetadataFileWatcher] Initialized ${this.contentHashes.size} file hashes`);
    } catch (error) {
      logger.error(
        '[MetadataFileWatcher] Failed to initialize hashes:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Check if we should watch this file
   */
  private shouldWatchFile(filePath: string): boolean {
    const basename = path.basename(filePath);
    const dirname = path.dirname(filePath);

    // Notes directory is under the provided workspacePath (which points to metadata root)
    const notesDir = path.join(this.workspacePath, 'notes');
    const isInNotesDir = dirname === notesDir;

    // Watch JSON files in notes directory (includes both note and comments JSON)
    if (isInNotesDir && basename.endsWith('.json')) {
      return true;
    }

    // Watch specific files at the metadata root
    const rootFiles = ['workspace.json', 'activity-log.json', 'git-tracking.json'];
    if (dirname === this.workspacePath && rootFiles.includes(basename)) {
      return true;
    }

    return false;
  }

  /**
   * Handle file change with debouncing and deduplication
   */
  private handleFileChange(filePath: string, action: 'add' | 'change' | 'unlink'): void {
    // Filter out files we don't care about
    if (!this.shouldWatchFile(filePath)) {
      return;
    }

    logger.debug('[MetadataFileWatcher] File change detected', {
      workspaceId: this.workspaceId,
      filePath,
      action,
    });

    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);
      await this.processFileChange(filePath, action);
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process a file change after debouncing
   */
  private async processFileChange(
    filePath: string,
    action: 'add' | 'change' | 'unlink',
  ): Promise<void> {
    try {
      // For deletions, we don't need to check content
      if (action === 'unlink') {
        this.contentHashes.delete(filePath);
        const event = this.createEvent(filePath, action);
        if (event) {
          this.emitEvent(event);
        }
        return;
      }

      // For additions and changes, check if content actually changed
      const content = await fs.readFile(filePath, 'utf-8');
      const newHash = this.hashContent(content);
      const oldHash = this.contentHashes.get(filePath);

      // Skip if content hasn't actually changed
      if (action === 'change' && oldHash === newHash) {
        return;
      }

      // Update hash
      this.contentHashes.set(filePath, newHash);

      // Create and emit event
      const event = this.createEvent(filePath, action, content);
      if (event) {
        this.emitEvent(event);
      }
    } catch (error) {
      logger.error(
        '[MetadataFileWatcher] Failed to process file change:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Create an event object from a file change
   */
  private createEvent(
    filePath: string,
    action: 'add' | 'change' | 'unlink',
    content?: string,
  ): MetadataChangeEvent | null {
    const relativePath = path.relative(this.workspacePath, filePath);
    const fileName = path.basename(filePath);

    let type: MetadataChangeEvent['type'];
    let fileType: string;
    let noteId: string | undefined;

    // Determine file type and extract metadata
    if (relativePath.startsWith('notes/')) {
      // Skip .meta directory files (except comments which we want to track)
      if (relativePath.includes('.meta/')) {
        if (fileName.endsWith('.comments.json')) {
          type = 'comment';
          fileType = 'comments';
          noteId = fileName.replace('.comments.json', '');
        } else {
          // Skip other .meta files like .versions.jsonl, .edits.jsonl, etc.
          return null;
        }
      } else if (fileName.endsWith('.comments.json')) {
        // Legacy: comments in notes directory
        type = 'comment';
        fileType = 'comments';
        noteId = fileName.replace('.comments.json', '');
      } else if (fileName.endsWith('.edits.meta.json')) {
        // Skip edit metadata files - these are not notes
        return null;
      } else if (fileName.endsWith('.line-attribution.json')) {
        // Skip line attribution files - these are not notes
        return null;
      } else if (fileName.endsWith('.md')) {
        // New storage format: .md files with frontmatter
        type = 'note';
        fileType = 'note';
        noteId = fileName.replace('.md', '');
      } else if (fileName.endsWith('.json')) {
        // Legacy storage format: .json files
        type = 'note';
        fileType = 'note';
        noteId = fileName.replace('.json', '');
      } else {
        return null; // Unknown file type in notes directory
      }
    } else if (fileName === 'workspace.json') {
      type = 'workspace';
      fileType = 'workspace';
    } else if (fileName === 'activity-log.json') {
      type = 'activity';
      fileType = 'activity-log';
    } else if (fileName === 'git-tracking.json') {
      type = 'git';
      fileType = 'git-tracking';
    } else {
      return null; // Unknown file type
    }

    // Parse content for note changes
    let noteContent: string | undefined;
    if (content && type === 'note') {
      if (fileName.endsWith('.md')) {
        // For .md files, extract content after frontmatter
        // Simple extraction - frontmatter is between --- delimiters
        const trimmed = content.trim();
        if (trimmed.startsWith('---')) {
          const endIndex = trimmed.indexOf('---', 3);
          if (endIndex !== -1) {
            noteContent = trimmed.slice(endIndex + 3).trim();
          } else {
            noteContent = content;
          }
        } else {
          noteContent = content;
        }
      } else {
        // Legacy .json format
        try {
          const parsedContent = JSON.parse(content);
          noteContent = parsedContent?.content;
        } catch (error) {
          logger.error(
            '[MetadataFileWatcher] Failed to parse JSON content:',
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    return {
      workspaceId: this.workspaceId,
      type,
      fileType,
      filePath,
      action,
      noteId,
      content: noteContent,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Emit event with appropriate event name
   */
  private emitEvent(event: MetadataChangeEvent): void {
    logger.debug('[MetadataFileWatcher] Emitting event:', {
      type: event.type,
      action: event.action,
      noteId: event.noteId,
      workspaceId: event.workspaceId,
    });

    // Emit specific event types
    switch (event.type) {
      case 'note':
        this.emit('note:file-changed', event);
        break;
      case 'comment':
        this.emit('comment:file-changed', event);
        break;
      case 'workspace':
        this.emit('workspace:file-changed', event);
        break;
      case 'activity':
        this.emit('activity:file-changed', event);
        break;
      case 'git':
        this.emit('git:file-changed', event);
        break;
    }

    // Also emit generic event
    this.emit('metadata:changed', event);
  }

  /**
   * Hash content for comparison
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check all watched files for changes by comparing current content with stored hashes.
   * Used after events may have been dropped to detect missed changes.
   */
  private async checkForChanges(): Promise<void> {
    const notesDir = path.join(this.workspacePath, 'notes');
    const rootFiles = ['workspace.json', 'activity-log.json', 'git-tracking.json'];

    try {
      // Check notes directory files
      if (await this.pathExists(notesDir)) {
        const files = await fs.readdir(notesDir);
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.md')) {
            const filePath = path.join(notesDir, file);
            await this.checkFileForChanges(filePath);
          }
        }
      }

      // Check root metadata files
      for (const rootFile of rootFiles) {
        const filePath = path.join(this.workspacePath, rootFile);
        if (await this.pathExists(filePath)) {
          await this.checkFileForChanges(filePath);
        }
      }
    } catch (error) {
      logger.error(
        '[MetadataFileWatcher] Failed to check for changes:',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Check a single file for changes and emit event if content differs from stored hash.
   */
  private async checkFileForChanges(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const newHash = this.hashContent(content);
      const oldHash = this.contentHashes.get(filePath);

      if (oldHash !== newHash) {
        logger.debug(`[MetadataFileWatcher] Detected change in ${path.basename(filePath)} during rescan`);
        this.contentHashes.set(filePath, newHash);
        const event = this.createEvent(filePath, 'change', content);
        if (event) {
          this.emitEvent(event);
        }
      }
    } catch (error) {
      // File may have been deleted or become unreadable
      logger.debug(`[MetadataFileWatcher] Could not check ${path.basename(filePath)} for changes`);
    }
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    try {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }

      // Clear all debounce timers
      for (const timer of this.debounceTimers.values()) {
        clearTimeout(timer);
      }
      this.debounceTimers.clear();
      this.contentHashes.clear();

      logger.info(`[MetadataFileWatcher] Stopped watching workspace ${this.workspaceId}`);
    } catch (error) {
      logger.error(
        `[MetadataFileWatcher] Failed to stop watching workspace ${this.workspaceId}`,
        error as Error,
      );
      // Don't throw - we want to clean up as much as possible
    }
  }
}
