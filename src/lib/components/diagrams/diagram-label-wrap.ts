export interface SemanticLabelPart {
  text: string;
  breakAfter: boolean;
  hardBreak: boolean;
}

const DELIMITER = /[./\\:_-]/;

export function splitSemanticLabel(label: string): SemanticLabelPart[] {
  const parts: SemanticLabelPart[] = [];
  let current = '';
  const push = (breakAfter: boolean, hardBreak = false) => {
    if (current) parts.push({ text: current, breakAfter, hardBreak });
    current = '';
  };

  for (let index = 0; index < label.length; index += 1) {
    const character = label[index];
    const previous = label[index - 1] ?? '';
    if (current && /[A-Z]/.test(character) && /[a-z0-9]/.test(previous)) push(true);
    if (character === '\n') {
      push(true, true);
      continue;
    }
    current += character;
    if (/\s/.test(character) || DELIMITER.test(character)) push(true);
  }
  push(false);
  return parts;
}

export function semanticLabelTokens(label: string): string[] {
  return splitSemanticLabel(label)
    .map((part) => part.text.trim())
    .filter(Boolean);
}

/** Keep short filenames whole and split long dotted filenames into readable components. */
export function semanticFilenameUnits(label: string): string[] | null {
  if (/\s/.test(label) || !/\.[A-Za-z][A-Za-z0-9]*$/.test(label)) return null;
  const parts = label.split('.');
  if (parts.length <= 2) {
    return label.length <= 21 ? [label] : [parts[0], `.${parts[1]}`];
  }
  return [`${parts.slice(0, -2).join('.')}.`, parts.slice(-2).join('.')];
}

/** Return path and filename components that should preferably stay on one line. */
export function semanticLabelUnits(label: string): string[] {
  const filenameUnits = semanticFilenameUnits(label);
  if (filenameUnits) return filenameUnits;
  return label
    .split(/\s+/)
    .flatMap((word) => word.match(/[^./\\]+[./\\]?/g) ?? [])
    .filter(Boolean);
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Node-only emergency breaks must never separate a combining or emoji sequence. */
export function nodeLabelGraphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

/**
 * Count pre-line text at the existing semantic/wbr boundaries, breaking an oversized
 * unit only at grapheme boundaries (overflow-wrap:anywhere). Units retain their
 * real whitespace; delimiters and camel-case boundaries do not add spaces.
 */
export function countEmergencyWrappedLines(
  units: readonly string[],
  width: number,
  measure: (text: string) => number,
  atomicUnits = false,
): number {
  const limit = Math.max(1, width);
  let lines = 1;
  let current = '';
  for (const [index, raw] of units.entries()) {
    const unit = raw.replace(/[\t\r\f ]+/g, ' ');
    const candidate = `${current}${unit}`.trimStart();
    if (measure(candidate.trimEnd()) <= limit) {
      current = candidate;
      continue;
    }
    if (current.trim()) lines += 1;
    current = '';
    for (const grapheme of nodeLabelGraphemes(unit.trimStart())) {
      if (current && measure(`${current}${grapheme}`.trimEnd()) > limit) {
        lines += 1;
        current = '';
      }
      current += grapheme;
    }
    // An oversized inline-block filename occupies the entire available width,
    // even when its final internal line has room left over.
    if (atomicUnits && measure(unit.trim()) > limit && index < units.length - 1) {
      lines += 1;
      current = '';
    }
  }
  return lines;
}
