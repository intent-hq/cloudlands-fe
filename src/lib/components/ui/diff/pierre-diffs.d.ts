/**
 * Type declarations for @pierre/diffs
 *
 * This file provides type declarations for the @pierre/diffs package
 * to work around moduleResolution compatibility issues.
 */

declare module '@pierre/diffs' {
  // Core types
  export type SupportedLanguages = string;
  export type DiffsThemeNames = string;
  export type ThemesType = Record<'dark' | 'light', DiffsThemeNames>;
  export type ChangeTypes = 'change' | 'rename-pure' | 'rename-changed' | 'new' | 'deleted';
  export type HunkLineType = 'context' | 'expanded' | 'addition' | 'deletion' | 'metadata';
  export type ThemeTypes = 'system' | 'light' | 'dark';
  export type HunkSeparators = 'simple' | 'metadata' | 'line-info' | 'custom';
  export type LineDiffTypes = 'word-alt' | 'word' | 'char' | 'none';
  export type AnnotationSide = 'deletions' | 'additions';
  export type LineTypes = 'change-deletion' | 'change-addition' | 'context' | 'context-expanded';
  export type ExpansionDirections = 'up' | 'down' | 'both';

  export interface FileContents {
    cacheKey?: string;
    name: string;
    contents: string;
    lang?: SupportedLanguages;
    header?: string;
  }

  export interface ContextContent {
    type: 'context';
    lines: string[];
    noEOFCR: boolean;
  }

  export interface ChangeContent {
    type: 'change';
    deletions: string[];
    additions: string[];
    noEOFCRDeletions: boolean;
    noEOFCRAdditions: boolean;
  }

  export interface Hunk {
    collapsedBefore: number;
    splitLineStart: number;
    splitLineCount: number;
    unifiedLineStart: number;
    unifiedLineCount: number;
    additionCount: number;
    additionStart: number;
    additionLines: number;
    deletionCount: number;
    deletionStart: number;
    deletionLines: number;
    hunkContent: (ContextContent | ChangeContent)[];
    hunkContext: string | undefined;
    hunkSpecs: string | undefined;
  }

  export interface FileDiffMetadata {
    name: string;
    prevName: string | undefined;
    lang?: SupportedLanguages;
    type: ChangeTypes;
    hunks: Hunk[];
    splitLineCount: number;
    unifiedLineCount: number;
    oldMode?: string;
    mode?: string;
    oldLines?: string[];
    newLines?: string[];
    cacheKey?: string;
  }

  export interface ParsedPatch {
    patchMetadata?: string;
    files: FileDiffMetadata[];
  }

  export interface HunkData {
    slotName: string;
    hunkIndex: number;
    lines: number;
    type: 'additions' | 'deletions' | 'unified';
    expandable?: {
      chunked: boolean;
      up: boolean;
      down: boolean;
    };
  }

  export interface LineInfo {
    type: LineTypes;
    lineNumber: number;
    altLineNumber?: number;
    lineIndex: number | `${number},${number}`;
  }

  export interface SelectedLineRange {
    start: number;
    side?: AnnotationSide;
    end: number;
    endSide?: AnnotationSide;
  }

  export interface LineEventBaseProps {
    type: 'line';
    lineNumber: number;
    lineElement: HTMLElement;
    numberElement: HTMLElement | undefined;
    numberColumn: boolean;
  }

  export interface DiffLineEventBaseProps {
    type: 'diff-line';
    lineNumber: number;
    lineElement: HTMLElement;
    numberElement: HTMLElement | undefined;
    numberColumn: boolean;
    annotationSide: AnnotationSide;
    lineType: LineTypes;
  }

  export interface OnDiffLineClickProps extends DiffLineEventBaseProps {
    event: PointerEvent;
  }

  export interface OnDiffLineEnterLeaveProps extends DiffLineEventBaseProps {
    event: PointerEvent;
  }

  export type DiffLineAnnotation<T = undefined> = {
    side: AnnotationSide;
    lineNumber: number;
  } & (T extends undefined ? { metadata?: undefined } : { metadata: T });

  export interface BaseCodeOptions {
    theme?: DiffsThemeNames | ThemesType;
    disableLineNumbers?: boolean;
    overflow?: 'scroll' | 'wrap';
    themeType?: ThemeTypes;
    disableFileHeader?: boolean;
    useCSSClasses?: boolean;
    tokenizeMaxLineLength?: number;
    unsafeCSS?: string;
  }

  export interface BaseDiffOptions extends BaseCodeOptions {
    diffStyle?: 'unified' | 'split';
    diffIndicators?: 'classic' | 'bars' | 'none';
    disableBackground?: boolean;
    hunkSeparators?: HunkSeparators;
    expandUnchanged?: boolean;
    lineDiffType?: LineDiffTypes;
    maxLineDiffLength?: number;
    expansionLineCount?: number;
  }

  export interface LineSelectionOptions {
    enableLineSelection?: boolean;
    onLineSelected?: (range: SelectedLineRange | null) => void;
    onLineSelectionStart?: (range: SelectedLineRange | null) => void;
    onLineSelectionEnd?: (range: SelectedLineRange | null) => void;
  }

  export interface MouseEventManagerBaseOptions {
    enableHoverUtility?: boolean;
    onLineClick?: (props: OnDiffLineClickProps) => unknown;
    onLineNumberClick?: (props: OnDiffLineClickProps) => unknown;
    onLineEnter?: (props: OnDiffLineEnterLeaveProps) => unknown;
    onLineLeave?: (props: OnDiffLineEnterLeaveProps) => unknown;
  }

  export type RenderHeaderMetadataCallback = (props: {
    oldFile?: FileContents;
    newFile?: FileContents;
    fileDiff?: FileDiffMetadata;
  }) => Element | null | undefined | string | number;

  export type GetHoveredLineResult = {
    lineNumber: number;
    side: AnnotationSide;
  };

  export interface FileDiffRenderProps<LAnnotation = undefined> {
    fileDiff?: FileDiffMetadata;
    oldFile?: FileContents;
    newFile?: FileContents;
    forceRender?: boolean;
    fileContainer?: HTMLElement;
    containerWrapper?: HTMLElement;
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  }

  export interface FileDiffOptions<LAnnotation = undefined>
    extends BaseDiffOptions, MouseEventManagerBaseOptions, LineSelectionOptions {
    hunkSeparators?:
      | Exclude<HunkSeparators, 'custom'>
      | ((hunk: HunkData, instance: FileDiff<LAnnotation>) => HTMLElement | DocumentFragment);
    disableFileHeader?: boolean;
    renderHeaderMetadata?: RenderHeaderMetadataCallback;
    renderAnnotation?: (annotation: DiffLineAnnotation<LAnnotation>) => HTMLElement | undefined;
    renderHoverUtility?: (
      getHoveredRow: () => GetHoveredLineResult | undefined,
    ) => HTMLElement | null;
  }

  export class FileDiff<LAnnotation = undefined> {
    options: FileDiffOptions<LAnnotation>;
    constructor(options?: FileDiffOptions<LAnnotation>, workerManager?: unknown, isContainerManaged?: boolean);
    setOptions(options: FileDiffOptions<LAnnotation> | undefined): void;
    setThemeType(themeType: ThemeTypes): void;
    getHoveredLine: () => GetHoveredLineResult | undefined;
    setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void;
    setSelectedLines(range: SelectedLineRange | null): void;
    cleanUp(): void;
    rerender(): void;
    expandHunk(hunkIndex: number, direction: ExpansionDirections): void;
    render(props: FileDiffRenderProps<LAnnotation>): void;
    getFileContainer(): HTMLElement | undefined;
  }

  // Virtualization API (added in @pierre/diffs 1.1.x).
  // See https://diffs.com/docs#virtualization-vanilla-javascript
  export interface VirtualizerConfig {
    overscrollSize: number;
    intersectionObserverMargin: number;
    resizeDebugging: boolean;
  }

  export interface VirtualFileMetrics {
    lineHeight: number;
    fileGap: number;
    diffHeaderHeight: number;
    hunkSeparatorHeight: number;
  }

  export class Virtualizer {
    readonly __id: string;
    readonly config: VirtualizerConfig;
    constructor(config?: Partial<VirtualizerConfig>);
    setup(root: HTMLElement | Document, contentContainer?: Element): void;
    cleanUp(): void;
  }

  export class VirtualizedFileDiff<LAnnotation = undefined> extends FileDiff<LAnnotation> {
    constructor(
      options: FileDiffOptions<LAnnotation> | undefined,
      virtualizer: Virtualizer,
      metrics?: Partial<VirtualFileMetrics>,
      workerManager?: unknown,
      isContainerManaged?: boolean,
    );
  }

  export function parsePatchFiles(data: string, cacheKeyPrefix?: string): ParsedPatch[];

  export function parseDiffFromFile(
    oldFile: FileContents,
    newFile: FileContents,
    options?: Record<string, unknown>,
  ): FileDiffMetadata;
}
