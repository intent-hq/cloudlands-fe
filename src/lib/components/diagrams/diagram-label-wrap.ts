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
