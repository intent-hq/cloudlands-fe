import { bytes } from './source-types';
import type { TableWindow } from './table-source';

export type TableSourceOwnership = 'copied' | 'packed-cells';
/** Numeric references to the admitted cell owner, never a concatenated source. */
export function tableSourceDescriptor(window: TableWindow) {
  return {
    kind: 'packed-cells' as const,
    revision: window.revision,
    from: window.cells[0].first,
    to: window.cells.at(-1)!.last,
    length: window.cells.reduce((n, c) => n + c.raw.length, 0),
    ranges: window.cells.map((c, index) => [index, c.first, c.last]),
  };
}
export class TableSourceView {
  #window: TableWindow;
  readonly descriptor: ReturnType<typeof tableSourceDescriptor>;
  constructor(window: TableWindow) {
    if (window.sourceOwnership !== 'packed-cells')
      throw new Error('Table source ownership mismatch');
    this.#window = window;
    this.descriptor = tableSourceDescriptor(window);
    for (const range of this.descriptor.ranges) Object.freeze(range);
    Object.freeze(this.descriptor.ranges);
    Object.freeze(this.descriptor);
  }
  owns(window: TableWindow) {
    return this.#window === window;
  }
  get length() {
    return this.descriptor.length;
  }
  get logicalBytes() {
    return this.#window.cells.reduce((n, c) => n + bytes(c.raw), 0);
  }
  get payloadBytes() {
    return bytes(JSON.stringify(this.descriptor));
  }
  toJSON() {
    return this.descriptor;
  }
}
export function sourcePayloadBytes(source: string | TableSourceView) {
  return typeof source === 'string' ? bytes(source) : source.payloadBytes;
}
export function sourceLogicalBytes(source: string | TableSourceView) {
  return typeof source === 'string' ? bytes(source) : source.logicalBytes;
}
export function tableSourcePayloadBytes(window: TableWindow) {
  return window.sourceOwnership === 'packed-cells'
    ? bytes(JSON.stringify(tableSourceDescriptor(window)))
    : window.cells.reduce((n, c) => n + bytes(c.raw), 0);
}
