import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { DiffMapDocument, DiffMapGroup, DiffMapSection } from '../model/types';

export type DiffMapDensityRung = 0 | 1 | 2 | 3;

export interface DiffMapViewport {
  width: number;
  height: number;
}

export interface TextMeasureContext {
  role: 'file' | 'group' | 'section';
  rung: DiffMapDensityRung;
}

export type TextMeasurer = (text: string, context: TextMeasureContext) => number;

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiffMapLayoutFileRow extends LayoutRect {
  kind: 'file';
  fileId: string;
  label: string;
}

export interface DiffMapLayoutMoreRow extends LayoutRect {
  kind: 'more';
  hiddenCount: number;
}

type DiffMapLayoutRow = DiffMapLayoutFileRow | DiffMapLayoutMoreRow;

interface DiffMapLayoutColumn extends LayoutRect {
  rows: DiffMapLayoutRow[];
}

export interface DiffMapLayoutBlock extends LayoutRect {
  groupId: string;
  label: string;
  labelPrefix: string;
  labelName: string;
  headerHeight: number;
  hiddenCount: number;
  expanded: boolean;
  columns: DiffMapLayoutColumn[];
}

interface DiffMapLayoutSection extends LayoutRect {
  sectionId: string;
  label: string;
}

export interface DiffMapLayout {
  rung: DiffMapDensityRung;
  blocks: DiffMapLayoutBlock[];
  overflow: boolean;
  contentHeight: number;
  sectionsPlaced: DiffMapLayoutSection[];
}

export interface LayoutDiffMapOptions {
  rungOverride?: DiffMapDensityRung;
  expandedBlockIds?: ReadonlySet<string>;
}

export interface DiffMapLayoutRequest {
  document: DiffMapDocument;
  viewport: DiffMapViewport;
  rungOverride?: DiffMapDensityRung;
  expandedBlockIds?: ReadonlySet<string>;
}

export interface DiffMapLayoutDelta {
  blocks: Array<{ groupId: string; from?: LayoutRect; to?: LayoutRect }>;
  rows: Array<{ fileId: string; from?: LayoutRect; to?: LayoutRect }>;
}

const OUTER_GAP = 8;
const BLOCK_GAP = 8;
const BLOCK_PADDING = 6;
const COLUMN_GAP = 4;
const HEADER_GAP = 6;
const SECTION_HEADER_HEIGHT = 22;
const NARROW_WIDTH = 480;
const MAX_STRETCH_FACTOR = 1.6;
const STRETCH_EPSILON = 0.000001;
const MAX_BLOCK_ROWS = 10;

type DiffMapFile = DiffMapDocument['files'][number];
type BlockLayoutRow = { kind: 'file'; file: DiffMapFile } | { kind: 'more'; hiddenCount: number };

interface VisibleBlockRows {
  files: DiffMapFile[];
  rows: BlockLayoutRow[];
  hiddenCount: number;
  expanded: boolean;
}

interface BlockColumnMeasurements {
  countWidth: number;
  columnCount: number;
  columnWidth: number;
  rowsPerColumn: number;
  width: number;
  height: number;
  fileLabelWidth: number;
}

interface LayoutSectionGroup {
  section: DiffMapSection | undefined;
  groupIds: string[];
}

interface PackedLayoutSection {
  section: DiffMapSection | undefined;
  shelves: DiffMapLayoutBlock[][];
}

const RUNGS = [
  { rowHeight: 28, headerHeight: 24, minColumnWidth: 180, maxColumnWidth: 320, chrome: 116 },
  { rowHeight: 22, headerHeight: 22, minColumnWidth: 150, maxColumnWidth: 280, chrome: 76 },
  { rowHeight: 18, headerHeight: 20, minColumnWidth: 128, maxColumnWidth: 240, chrome: 42 },
  { rowHeight: 18, headerHeight: 20, minColumnWidth: 96, maxColumnWidth: 184, chrome: 26 },
] as const;

function rect(rect: LayoutRect): LayoutRect {
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}

function middleEllipsis(
  text: string,
  maxWidth: number,
  measure: TextMeasurer,
  context: TextMeasureContext,
): string {
  if (maxWidth <= 0) return '';
  if (measure(text, context) <= maxWidth) return text;
  const ellipsis = '…';
  if (measure(ellipsis, context) > maxWidth) return '';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    const left = Math.ceil(length / 2);
    const candidate = `${text.slice(0, left)}${ellipsis}${text.slice(text.length - (length - left))}`;
    if (measure(candidate, context) <= maxWidth) low = length;
    else high = length - 1;
  }
  const left = Math.ceil(low / 2);
  return `${text.slice(0, left)}${ellipsis}${text.slice(text.length - (low - left))}`;
}

function groupLabel(group: DiffMapGroup): string {
  return `${group.displayPrefix}${group.displayName}` || '.';
}

export function diffMapGroupCountLabel(group: DiffMapGroup): string {
  const count = formatInteger(group.changedCount);
  return group.totalCount === undefined
    ? m.diffMap_groupChanged_label({ count })
    : m.diffMap_groupChangedTotal_label({ count, total: formatInteger(group.totalCount) });
}

function truncateGroupLabel(
  group: DiffMapGroup,
  maxWidth: number,
  measure: TextMeasurer,
  context: TextMeasureContext,
): { prefix: string; name: string } {
  const name = group.displayName || '.';
  const fullLabel = groupLabel(group);
  if (measure(fullLabel, context) <= maxWidth) {
    return { prefix: group.displayPrefix, name };
  }
  const nameWidth = measure(name, context);
  if (nameWidth > maxWidth) {
    return { prefix: '', name: middleEllipsis(name, maxWidth, measure, context) };
  }
  const segments = fullLabel.split('/').filter(Boolean);
  for (let start = 1; start < segments.length - 1; start += 1) {
    const visibleSegments = segments.slice(start);
    const candidate = `…/${visibleSegments.join('/')}`;
    if (measure(candidate, context) <= maxWidth) {
      return { prefix: `…/${visibleSegments.slice(0, -1).join('/')}/`, name };
    }
  }
  return { prefix: '', name };
}

function groupWithinSection(group: DiffMapGroup, section: DiffMapSection): DiffMapGroup {
  const rootPrefix = `${section.displayPrefix}${section.displayName}/`;
  if (!group.displayPrefix.startsWith(rootPrefix)) return group;
  return {
    ...group,
    displayPrefix: group.displayPrefix.slice(rootPrefix.length),
  };
}

function visibleBlockRows(
  group: DiffMapGroup,
  fileById: ReadonlyMap<string, DiffMapFile>,
  expandedBlockIds?: ReadonlySet<string>,
): VisibleBlockRows {
  const allFiles = group.fileIds.map((id) => fileById.get(id)).filter((file) => file !== undefined);
  const hiddenCount = Math.max(0, allFiles.length - MAX_BLOCK_ROWS);
  const expanded = expandedBlockIds?.has(group.id) ?? false;
  const files = expanded ? allFiles : allFiles.slice(0, MAX_BLOCK_ROWS);
  return {
    files,
    rows: [
      ...files.map((file) => ({ kind: 'file' as const, file })),
      ...(hiddenCount > 0 ? [{ kind: 'more' as const, hiddenCount }] : []),
    ],
    hiddenCount,
    expanded,
  };
}

function measureBlockColumns(
  group: DiffMapGroup,
  files: DiffMapFile[],
  rows: BlockLayoutRow[],
  viewport: DiffMapViewport,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): BlockColumnMeasurements {
  const config = RUNGS[rung];
  const fileContext = { role: 'file', rung } as const;
  const groupContext = { role: 'group', rung } as const;
  const longestFileWidth = files.reduce(
    (longest, file) => Math.max(longest, measure(file.name, fileContext)),
    0,
  );
  const labelWidth = measure(groupLabel(group), groupContext);
  const countLabel = diffMapGroupCountLabel(group);
  const countWidth = measure(countLabel, groupContext);
  const minimumHeaderWidth =
    measure(group.displayName || '.', groupContext) + (rung < 3 ? countWidth + HEADER_GAP : 0);
  const naturalColumnWidth = Math.min(
    config.maxColumnWidth,
    Math.max(
      config.minColumnWidth,
      longestFileWidth + config.chrome,
      labelWidth,
      minimumHeaderWidth,
    ),
  );
  const maxRowsByHeight = Math.max(
    1,
    Math.floor((viewport.height - config.headerHeight - BLOCK_PADDING * 2) / config.rowHeight),
  );
  let columnCount = Math.max(1, Math.ceil(rows.length / maxRowsByHeight));
  const availableWidth = Math.max(0, viewport.width - BLOCK_PADDING * 2);
  const requestedColumnWidth =
    (availableWidth - COLUMN_GAP * Math.max(0, columnCount - 1)) / columnCount;
  if (requestedColumnWidth < config.minColumnWidth) columnCount = 1;
  const columnWidth =
    viewport.width < NARROW_WIDTH && columnCount === 1
      ? availableWidth
      : Math.max(
          0,
          Math.min(
            naturalColumnWidth,
            (availableWidth - COLUMN_GAP * Math.max(0, columnCount - 1)) / columnCount,
          ),
        );
  const rowsPerColumn = Math.max(1, Math.ceil(rows.length / columnCount));
  const width = Math.min(
    viewport.width,
    BLOCK_PADDING * 2 + columnCount * columnWidth + (columnCount - 1) * COLUMN_GAP,
  );
  const height = config.headerHeight + BLOCK_PADDING * 2 + rowsPerColumn * config.rowHeight;
  const fileLabelWidth = Math.max(0, columnWidth - config.chrome);
  return {
    countWidth,
    columnCount,
    columnWidth,
    rowsPerColumn,
    width,
    height,
    fileLabelWidth,
  };
}

function buildBlockColumns(
  rows: BlockLayoutRow[],
  measurements: BlockColumnMeasurements,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): DiffMapLayoutColumn[] {
  const config = RUNGS[rung];
  const fileContext = { role: 'file', rung } as const;
  const { columnCount, columnWidth, rowsPerColumn, fileLabelWidth } = measurements;
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const columnRows = rows.slice(
      columnIndex * rowsPerColumn,
      Math.min(rows.length, (columnIndex + 1) * rowsPerColumn),
    );
    return {
      x: BLOCK_PADDING + columnIndex * (columnWidth + COLUMN_GAP),
      y: config.headerHeight + BLOCK_PADDING,
      w: columnWidth,
      h: columnRows.length * config.rowHeight,
      rows: columnRows.map((row, rowIndex): DiffMapLayoutRow => {
        const geometry = {
          x: BLOCK_PADDING + columnIndex * (columnWidth + COLUMN_GAP),
          y: config.headerHeight + BLOCK_PADDING + rowIndex * config.rowHeight,
          w: columnWidth,
          h: config.rowHeight,
        };
        return row.kind === 'more'
          ? { kind: 'more', hiddenCount: row.hiddenCount, ...geometry }
          : {
              kind: 'file',
              fileId: row.file.id,
              label: middleEllipsis(row.file.name, fileLabelWidth, measure, fileContext),
              ...geometry,
            };
      }),
    };
  });
}

function buildBlock(
  group: DiffMapGroup,
  fileById: ReadonlyMap<string, DiffMapFile>,
  viewport: DiffMapViewport,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
  expandedBlockIds?: ReadonlySet<string>,
): DiffMapLayoutBlock {
  const visible = visibleBlockRows(group, fileById, expandedBlockIds);
  const measurements = measureBlockColumns(
    group,
    visible.files,
    visible.rows,
    viewport,
    rung,
    measure,
  );
  const columns = buildBlockColumns(visible.rows, measurements, rung, measure);
  const groupContext = { role: 'group', rung } as const;
  const label = truncateGroupLabel(
    group,
    Math.max(
      0,
      measurements.width -
        BLOCK_PADDING * 2 -
        (rung < 3 ? measurements.countWidth + HEADER_GAP : 0),
    ),
    measure,
    groupContext,
  );
  return {
    groupId: group.id,
    label: `${label.prefix}${label.name}`,
    labelPrefix: label.prefix,
    labelName: label.name,
    x: 0,
    y: 0,
    w: measurements.width,
    h: measurements.height,
    headerHeight: RUNGS[rung].headerHeight,
    hiddenCount: visible.hiddenCount,
    expanded: visible.expanded,
    columns,
  };
}

function translateBlock(block: DiffMapLayoutBlock, x: number, y: number): DiffMapLayoutBlock {
  return {
    ...block,
    x,
    y,
    columns: block.columns.map((column) => ({
      ...column,
      x: column.x + x,
      y: column.y + y,
      rows: column.rows.map((row) => ({ ...row, x: row.x + x, y: row.y + y })),
    })),
  };
}

function resizeBlock(
  block: DiffMapLayoutBlock,
  width: number,
  group: DiffMapGroup,
  fileById: ReadonlyMap<string, DiffMapFile>,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): DiffMapLayoutBlock {
  const config = RUNGS[rung];
  const columnWidth = Math.max(
    0,
    (width - BLOCK_PADDING * 2 - COLUMN_GAP * Math.max(0, block.columns.length - 1)) /
      block.columns.length,
  );
  const fileContext = { role: 'file', rung } as const;
  const groupContext = { role: 'group', rung } as const;
  const fileLabelWidth = Math.max(0, columnWidth - config.chrome);
  const columns = block.columns.map((column, columnIndex) => {
    const x = BLOCK_PADDING + columnIndex * (columnWidth + COLUMN_GAP);
    return {
      ...column,
      x,
      w: columnWidth,
      rows: column.rows.map((row) =>
        row.kind === 'more'
          ? { ...row, x, w: columnWidth }
          : {
              ...row,
              label: middleEllipsis(
                fileById.get(row.fileId)?.name ?? row.label,
                fileLabelWidth,
                measure,
                fileContext,
              ),
              x,
              w: columnWidth,
            },
      ),
    };
  });
  const countWidth = measure(diffMapGroupCountLabel(group), groupContext);
  const label = truncateGroupLabel(
    group,
    Math.max(0, width - BLOCK_PADDING * 2 - (rung < 3 ? countWidth + HEADER_GAP : 0)),
    measure,
    groupContext,
  );
  return {
    ...block,
    label: `${label.prefix}${label.name}`,
    labelPrefix: label.prefix,
    labelName: label.name,
    w: width,
    columns,
  };
}

function stretchShelf(
  blocks: DiffMapLayoutBlock[],
  width: number,
  groupById: ReadonlyMap<string, DiffMapGroup>,
  fileById: ReadonlyMap<string, DiffMapFile>,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): DiffMapLayoutBlock[] {
  const widths = blocks.map((block) => block.w);
  let remaining = Math.max(
    0,
    width -
      BLOCK_GAP * Math.max(0, blocks.length - 1) -
      widths.reduce((sum, value) => sum + value, 0),
  );
  let active = blocks.map((_, index) => index);
  while (remaining > STRETCH_EPSILON && active.length > 0) {
    const totalWeight = active.reduce((sum, index) => sum + blocks[index].columns.length, 0);
    let distributed = 0;
    const nextActive: number[] = [];
    for (const index of active) {
      const capacity = blocks[index].w * MAX_STRETCH_FACTOR - widths[index];
      const share = (remaining * blocks[index].columns.length) / totalWeight;
      const addition = Math.min(capacity, share);
      widths[index] += addition;
      distributed += addition;
      if (capacity - addition > STRETCH_EPSILON) nextActive.push(index);
    }
    if (distributed <= STRETCH_EPSILON) break;
    remaining -= distributed;
    active = nextActive;
  }
  return blocks.map((block, index) => {
    const group = groupById.get(block.groupId);
    return group ? resizeBlock(block, widths[index], group, fileById, rung, measure) : block;
  });
}

function groupLayoutSections(document: DiffMapDocument): {
  displayGroups: DiffMapGroup[];
  sections: LayoutSectionGroup[];
} {
  const documentSections = document.sections;
  const preserveSections =
    (documentSections?.length ?? 0) > 1 &&
    documentSections?.some((section) => section.groupIds.length > 1);
  const sectionByGroupId = new Map(
    preserveSections && documentSections
      ? documentSections.flatMap((section) =>
          section.groupIds.map((groupId) => [groupId, section] as const),
        )
      : [],
  );
  const displayGroups = document.groups.map((group) => {
    const section = sectionByGroupId.get(group.id);
    return section ? groupWithinSection(group, section) : group;
  });
  const sections =
    preserveSections && documentSections
      ? documentSections.map((section) => ({ section, groupIds: section.groupIds }))
      : [{ section: undefined, groupIds: document.groups.map((group) => group.id) }];
  return { displayGroups, sections };
}

function packSectionShelves(
  sections: LayoutSectionGroup[],
  blocksById: ReadonlyMap<string, DiffMapLayoutBlock>,
  viewportWidth: number,
): PackedLayoutSection[] {
  return sections.map(({ section, groupIds }) => {
    const shelves: DiffMapLayoutBlock[][] = [];
    let shelf: DiffMapLayoutBlock[] = [];
    let shelfWidth = 0;
    for (const groupId of groupIds) {
      const block = blocksById.get(groupId);
      if (!block) continue;
      const narrow = viewportWidth < NARROW_WIDTH;
      if (shelf.length > 0 && (narrow || shelfWidth + BLOCK_GAP + block.w > viewportWidth)) {
        shelves.push(shelf);
        shelf = [];
        shelfWidth = 0;
      }
      shelf.push(block);
      shelfWidth += (shelf.length > 1 ? BLOCK_GAP : 0) + block.w;
    }
    if (shelf.length > 0) shelves.push(shelf);
    return { section, shelves };
  });
}

function placeShelves(
  packedSections: PackedLayoutSection[],
  viewport: DiffMapViewport,
  groupById: ReadonlyMap<string, DiffMapGroup>,
  fileById: ReadonlyMap<string, DiffMapFile>,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): {
  placed: Map<string, DiffMapLayoutBlock>;
  sectionsPlaced: DiffMapLayoutSection[];
  contentHeight: number;
} {
  const shelfCount = packedSections.reduce((count, entry) => count + entry.shelves.length, 0);
  const placed = new Map<string, DiffMapLayoutBlock>();
  const sectionsPlaced: DiffMapLayoutSection[] = [];
  let cursorY = 0;
  let globalShelfIndex = 0;

  for (const { section, shelves } of packedSections) {
    const sectionY = cursorY;
    if (section) cursorY += SECTION_HEADER_HEIGHT;
    let shelfY = cursorY;
    for (let shelfIndex = 0; shelfIndex < shelves.length; shelfIndex++) {
      const shouldStretch = shelfCount === 1 || globalShelfIndex < shelfCount - 1;
      const blocks = shouldStretch
        ? stretchShelf(shelves[shelfIndex], viewport.width, groupById, fileById, rung, measure)
        : shelves[shelfIndex];
      let shelfX = 0;
      let shelfHeight = 0;
      for (const block of blocks) {
        placed.set(block.groupId, translateBlock(block, shelfX, shelfY));
        shelfX += block.w + BLOCK_GAP;
        shelfHeight = Math.max(shelfHeight, block.h);
      }
      shelfY += shelfHeight + (shelfIndex < shelves.length - 1 ? BLOCK_GAP : 0);
      globalShelfIndex += 1;
    }
    cursorY = shelves.length > 0 ? shelfY : cursorY;
    if (section) {
      sectionsPlaced.push({
        sectionId: section.id,
        label: `${section.displayPrefix}${section.displayName}`,
        x: 0,
        y: sectionY,
        w: viewport.width,
        h: Math.max(SECTION_HEADER_HEIGHT, cursorY - sectionY),
      });
      cursorY += OUTER_GAP;
    }
  }
  const contentHeight = Math.max(0, cursorY - (sectionsPlaced.length > 0 ? OUTER_GAP : 0));
  return { placed, sectionsPlaced, contentHeight };
}

function packAtRung(
  document: DiffMapDocument,
  viewport: DiffMapViewport,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
  expandedBlockIds?: ReadonlySet<string>,
): DiffMapLayout {
  const fileById = new Map(document.files.map((file) => [file.id, file]));
  const { displayGroups, sections } = groupLayoutSections(document);
  const groupById = new Map(displayGroups.map((group) => [group.id, group]));
  const blocksById = new Map(
    displayGroups.map((group) => [
      group.id,
      buildBlock(group, fileById, viewport, rung, measure, expandedBlockIds),
    ]),
  );
  const packedSections = packSectionShelves(sections, blocksById, viewport.width);
  const { placed, sectionsPlaced, contentHeight } = placeShelves(
    packedSections,
    viewport,
    groupById,
    fileById,
    rung,
    measure,
  );
  return {
    rung,
    blocks: document.groups
      .map((group) => placed.get(group.id))
      .filter((block) => block !== undefined),
    overflow: contentHeight > viewport.height,
    contentHeight,
    sectionsPlaced,
  };
}

export function layoutDiffMap(
  document: DiffMapDocument,
  viewport: DiffMapViewport,
  measure: TextMeasurer,
  options: LayoutDiffMapOptions = {},
): DiffMapLayout {
  const safeViewport = {
    width: Math.max(0, viewport.width),
    height: Math.max(0, viewport.height),
  };
  if (options.rungOverride !== undefined) {
    return packAtRung(
      document,
      safeViewport,
      options.rungOverride,
      measure,
      options.expandedBlockIds,
    );
  }
  let layout = packAtRung(document, safeViewport, 0, measure, options.expandedBlockIds);
  for (const rung of [1, 2, 3] as const) {
    if (!layout.overflow) break;
    layout = packAtRung(document, safeViewport, rung, measure, options.expandedBlockIds);
  }
  return layout;
}

function geometryKey(document: DiffMapDocument): string {
  return JSON.stringify({
    files: document.files.map((file) => file.id),
    groups: document.groups.map((group) => [group.id, group.fileIds]),
    sections: document.sections?.map((section) => [section.id, section.groupIds]) ?? [],
  });
}

export function shouldRelayoutDiffMap(
  previous: DiffMapLayoutRequest,
  next: DiffMapLayoutRequest,
  viewportHysteresis = 24,
): boolean {
  if (previous.rungOverride !== next.rungOverride) return true;
  if (!sameSet(previous.expandedBlockIds, next.expandedBlockIds)) return true;
  if (geometryKey(previous.document) !== geometryKey(next.document)) return true;
  return (
    Math.abs(previous.viewport.width - next.viewport.width) > viewportHysteresis ||
    Math.abs(previous.viewport.height - next.viewport.height) > viewportHysteresis
  );
}

function sameSet(previous?: ReadonlySet<string>, next?: ReadonlySet<string>): boolean {
  if ((previous?.size ?? 0) !== (next?.size ?? 0)) return false;
  return previous === next || [...(previous ?? [])].every((id) => next?.has(id));
}

export function diffLayouts(previous: DiffMapLayout, next: DiffMapLayout): DiffMapLayoutDelta {
  const previousBlocks = new Map(previous.blocks.map((block) => [block.groupId, rect(block)]));
  const nextBlocks = new Map(next.blocks.map((block) => [block.groupId, rect(block)]));
  const previousRows = new Map(
    previous.blocks.flatMap((block) =>
      block.columns.flatMap((column) =>
        column.rows.flatMap((row) =>
          row.kind === 'file' ? [[row.fileId, rect(row)] as const] : [],
        ),
      ),
    ),
  );
  const nextRows = new Map(
    next.blocks.flatMap((block) =>
      block.columns.flatMap((column) =>
        column.rows.flatMap((row) =>
          row.kind === 'file' ? [[row.fileId, rect(row)] as const] : [],
        ),
      ),
    ),
  );
  return {
    blocks: [...new Set([...nextBlocks.keys(), ...previousBlocks.keys()])].map((groupId) => ({
      groupId,
      ...(previousBlocks.has(groupId) ? { from: previousBlocks.get(groupId) } : {}),
      ...(nextBlocks.has(groupId) ? { to: nextBlocks.get(groupId) } : {}),
    })),
    rows: [...new Set([...nextRows.keys(), ...previousRows.keys()])].map((fileId) => ({
      fileId,
      ...(previousRows.has(fileId) ? { from: previousRows.get(fileId) } : {}),
      ...(nextRows.has(fileId) ? { to: nextRows.get(fileId) } : {}),
    })),
  };
}
