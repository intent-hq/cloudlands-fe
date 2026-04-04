/**
 * Line Attribution Debug Service
 *
 * Hooks into note edit events and runs line attribution algorithm,
 * writing debug output to disk for validation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger';

import { attributeLines, type LineAttribution } from '../line-attribution';
import type { WorkspaceId, NoteId, Note } from '../../../shared/types';
import { WorkspaceConfig } from '../../../shared/main/config';

const logger = new Logger('LineAttributionDebugService');

interface AttributionDebugOutput {
  timestamp: string;
  noteId: NoteId;
  workspaceId: WorkspaceId;
  currentContent: string;
  versionCount: number;
  attributions: LineAttribution[];
  summary: {
    totalLines: number;
    attributedLines: number;
    unattributedLines: number;
    whitespaceOnlyLines: number;
    versionBreakdown: Record<number, number>;
  };
}

export class LineAttributionDebugService {
  private isEnabled = false;

  constructor() {}

  /**
   * Enable debug mode - note:updated events are handled by sagas.
   */
  enable(): void {
    if (this.isEnabled) {
      logger.warn('Debug service already enabled');
      return;
    }

    this.isEnabled = true;
    logger.info('Line attribution debug service enabled (listeners via sagas)');
  }

  /**
   * Handle note:updated domain event (called by saga).
   * Only processes when enabled.
   */
  public async handleNoteUpdated(event: { workspaceId?: string; noteId?: string }): Promise<void> {
    if (!this.isEnabled) return;
    try {
      const { workspaceId, noteId } = event;
      if (!workspaceId || !noteId) return;
      await this.runAttribution(workspaceId as WorkspaceId, noteId as NoteId);
    } catch (error) {
      logger.error('Failed to run attribution debug', error as Error);
    }
  }

  /**
   * Disable debug mode
   */
  disable(): void {
    if (!this.isEnabled) {
      return;
    }

    this.isEnabled = false;
    // note:updated listener cleanup is no longer needed (handled by sagas)
    logger.info('Line attribution debug service disabled');
  }

  /**
   * Run attribution on a specific note and write debug output
   */
  async runAttribution(workspaceId: WorkspaceId, noteId: NoteId): Promise<void> {
    try {
      // Load the note
      const note = await this.loadNote(workspaceId, noteId);
      if (!note) {
        logger.warn('Note not found', { workspaceId, noteId });
        return;
      }

      // Run attribution
      const attributions = attributeLines(note.content, note.versions || []);

      // Build summary
      const summary = this.buildSummary(attributions);

      // Create debug output
      const output: AttributionDebugOutput = {
        timestamp: new Date().toISOString(),
        noteId,
        workspaceId,
        currentContent: note.content,
        versionCount: note.versions?.length || 0,
        attributions,
        summary,
      };

      // Write to disk
      await this.writeDebugOutput(workspaceId, noteId, output);

      logger.info('Attribution debug output written', {
        noteId,
        totalLines: summary.totalLines,
        attributedLines: summary.attributedLines,
        versionCount: output.versionCount,
      });
    } catch (error) {
      logger.error('Failed to run attribution', error as Error, { workspaceId, noteId });
    }
  }

  /**
   * Load a note from disk
   */
  private async loadNote(workspaceId: WorkspaceId, noteId: NoteId): Promise<Note | null> {
    try {
      const notePath = WorkspaceConfig.paths.note(workspaceId, noteId);
      const data = await fs.readFile(notePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Build summary statistics from attributions
   */
  private buildSummary(attributions: LineAttribution[]) {
    const summary = {
      totalLines: attributions.length,
      attributedLines: 0,
      unattributedLines: 0,
      whitespaceOnlyLines: 0,
      versionBreakdown: {} as Record<number, number>,
    };

    for (const attr of attributions) {
      if (attr.version) {
        summary.attributedLines++;
        const versionNum = attr.version.versionNumber;
        summary.versionBreakdown[versionNum] = (summary.versionBreakdown[versionNum] || 0) + 1;
      } else {
        summary.unattributedLines++;
      }

      if (attr.isWhitespaceOnly) {
        summary.whitespaceOnlyLines++;
      }
    }

    return summary;
  }

  /**
   * Write debug output to disk
   */
  private async writeDebugOutput(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    output: AttributionDebugOutput,
  ): Promise<void> {
    // Create debug directory
    const debugDir = path.join(
      WorkspaceConfig.paths.workspace(workspaceId),
      '.debug',
      'line-attribution',
    );
    await fs.mkdir(debugDir, { recursive: true });

    // Write JSON output
    const jsonPath = path.join(debugDir, `${noteId}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(output, null, 2), 'utf-8');

    // Write human-readable summary
    const summaryPath = path.join(debugDir, `${noteId}.txt`);
    const summaryText = this.formatSummary(output);
    await fs.writeFile(summaryPath, summaryText, 'utf-8');
  }

  /**
   * Format a human-readable summary
   */
  private formatSummary(output: AttributionDebugOutput): string {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('Line Attribution Debug Output');
    lines.push(`Timestamp: ${output.timestamp}`);
    lines.push(`Note: ${output.noteId}`);
    lines.push(`Workspace: ${output.workspaceId}`);
    lines.push('='.repeat(80));
    lines.push('');

    lines.push('SUMMARY:');
    lines.push(`  Total lines: ${output.summary.totalLines}`);
    lines.push(`  Attributed: ${output.summary.attributedLines}`);
    lines.push(`  Unattributed: ${output.summary.unattributedLines}`);
    lines.push(`  Whitespace-only: ${output.summary.whitespaceOnlyLines}`);
    lines.push(`  Version count: ${output.versionCount}`);
    lines.push('');

    lines.push('VERSION BREAKDOWN:');
    const sortedVersions = Object.entries(output.summary.versionBreakdown).sort(
      ([a], [b]) => Number(a) - Number(b),
    );
    for (const [version, count] of sortedVersions) {
      lines.push(`  v${version}: ${count} lines`);
    }
    lines.push('');

    lines.push('LINE-BY-LINE ATTRIBUTION:');
    lines.push('-'.repeat(80));
    for (const attr of output.attributions) {
      const versionStr = attr.version ? `v${attr.version.versionNumber}` : 'UNATTRIBUTED';
      const wsFlag = attr.isWhitespaceOnly ? ' [WS-ONLY]' : '';
      const content = attr.lineContent.substring(0, 60);
      lines.push(
        `Line ${attr.lineNumber.toString().padStart(4)}: ${versionStr.padEnd(12)} ${wsFlag.padEnd(10)} | ${content}`,
      );
    }
    lines.push('-'.repeat(80));

    return lines.join('\n');
  }
}

// Singleton instance
let debugService: LineAttributionDebugService | null = null;

export function getLineAttributionDebugService(): LineAttributionDebugService {
  if (!debugService) {
    debugService = new LineAttributionDebugService();
  }
  return debugService;
}
