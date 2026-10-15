/** Build a two-char porcelain-style status code from a daemon single-char code. */
export function toFilePorcelainStatus(status: string, staged: boolean): string {
  const code = status.trim();
  if (code === '?') return '??';
  return staged ? `${code} ` : ` ${code}`;
}
