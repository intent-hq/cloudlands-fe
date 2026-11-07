/**
 * The link typed in the paste row, handed to the saga outside Redux so the
 * owner token never travels in an action payload. Read once.
 */
let pasted: string | null = null;

export function stashPastedLink(text: string): void {
  pasted = text.trim();
}

export function takePastedLink(): string | null {
  const text = pasted;
  pasted = null;
  return text;
}
