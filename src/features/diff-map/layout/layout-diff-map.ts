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

export interface DiffMapLayoutRow extends LayoutRect {
  fileId: string;
  label: string;
}

interface DiffMapLayoutColumn extends LayoutRect {
  rows: DiffMapLayoutRow[];
}

export interface DiffMapLayoutBlock extends LayoutRect {
  groupId: string;
  label: string;
  labelPrefix: string;
  labelName: string;
  headerHeight: number;
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
}

export interface DiffMapLayoutRequest {
  document: DiffMapDocument;
  viewport: DiffMapViewport;
  rungOverride?: DiffMapDensityRung;
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

function buildBlock(
  group: DiffMapGroup,
  fileById: Map<string, DiffMapDocument['files'][number]>,
  viewport: DiffMapViewport,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): DiffMapLayoutBlock {
  const config = RUNGS[rung];
  const files = group.fileIds.map((id) => fileById.get(id)).filter((file) => file !== undefined);
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
  let columnCount = Math.max(1, Math.ceil(files.length / maxRowsByHeight));
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
  const rowsPerColumn = Math.max(1, Math.ceil(files.length / columnCount));
  const width = Math.min(
    viewport.width,
    BLOCK_PADDING * 2 + columnCount * columnWidth + (columnCount - 1) * COLUMN_GAP,
  );
  const height = config.headerHeight + BLOCK_PADDING * 2 + rowsPerColumn * config.rowHeight;
  const fileLabelWidth = Math.max(0, columnWidth - config.chrome);
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const columnFiles = files.slice(
      columnIndex * rowsPerColumn,
      Math.min(files.length, (columnIndex + 1) * rowsPerColumn),
    );
    return {
      x: BLOCK_PADDING + columnIndex * (columnWidth + COLUMN_GAP),
      y: config.headerHeight + BLOCK_PADDING,
      w: columnWidth,
      h: columnFiles.length * config.rowHeight,
      rows: columnFiles.map((file, rowIndex) => ({
        fileId: file.id,
        label: middleEllipsis(file.name, fileLabelWidth, measure, fileContext),
        x: BLOCK_PADDING + columnIndex * (columnWidth + COLUMN_GAP),
        y: config.headerHeight + BLOCK_PADDING + rowIndex * config.rowHeight,
        w: columnWidth,
        h: config.rowHeight,
      })),
    };
  });
  const label = truncateGroupLabel(
    group,
    Math.max(0, width - BLOCK_PADDING * 2 - (rung < 3 ? countWidth + HEADER_GAP : 0)),
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
    w: width,
    h: height,
    headerHeight: config.headerHeight,
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
  fileById: Map<string, DiffMapDocument['files'][number]>,
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
      rows: column.rows.map((row) => ({
        ...row,
        label: middleEllipsis(
          fileById.get(row.fileId)?.name ?? row.label,
          fileLabelWidth,
          measure,
          fileContext,
        ),
        x,
        w: columnWidth,
      })),
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
  groupById: Map<string, DiffMapGroup>,
  fileById: Map<string, DiffMapDocument['files'][number]>,
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

function packAtRung(
  document: DiffMapDocument,
  viewport: DiffMapViewport,
  rung: DiffMapDensityRung,
  measure: TextMeasurer,
): DiffMapLayout {
  const fileById = new Map(document.files.map((file) => [file.id, file]));
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
  const groupById = new Map(displayGroups.map((group) => [group.id, group]));
  const blocksById = new Map(
    displayGroups.map((group) => [group.id, buildBlock(group, fileById, viewport, rung, measure)]),
  );
  const sections =
    preserveSections && documentSections
      ? documentSections.map((section) => ({ section, groupIds: section.groupIds }))
      : [{ section: undefined, groupIds: document.groups.map((group) => group.id) }];
  const packedSections = sections.map(({ section, groupIds }) => {
    const shelves: DiffMapLayoutBlock[][] = [];
    let shelf: DiffMapLayoutBlock[] = [];
    let shelfWidth = 0;
    for (const groupId of groupIds) {
      const block = blocksById.get(groupId);
      if (!block) continue;
      const narrow = viewport.width < NARROW_WIDTH;
      if (shelf.length > 0 && (narrow || shelfWidth + BLOCK_GAP + block.w > viewport.width)) {
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
    return packAtRung(document, safeViewport, options.rungOverride, measure);
  }
  let layout = packAtRung(document, safeViewport, 0, measure);
  for (const rung of [1, 2, 3] as const) {
    if (!layout.overflow) break;
    layout = packAtRung(document, safeViewport, rung, measure);
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
  if (geometryKey(previous.document) !== geometryKey(next.document)) return true;
  return (
    Math.abs(previous.viewport.width - next.viewport.width) > viewportHysteresis ||
    Math.abs(previous.viewport.height - next.viewport.height) > viewportHysteresis
  );
}

export function diffLayouts(previous: DiffMapLayout, next: DiffMapLayout): DiffMapLayoutDelta {
  const previousBlocks = new Map(previous.blocks.map((block) => [block.groupId, rect(block)]));
  const nextBlocks = new Map(next.blocks.map((block) => [block.groupId, rect(block)]));
  const previousRows = new Map(
    previous.blocks.flatMap((block) =>
      block.columns.flatMap((column) => column.rows.map((row) => [row.fileId, rect(row)] as const)),
    ),
  );
  const nextRows = new Map(
    next.blocks.flatMap((block) =>
      block.columns.flatMap((column) => column.rows.map((row) => [row.fileId, rect(row)] as const)),
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
