export type ChatContentWidth = 'full' | '800';

export function isChatContentWidth(value: unknown): value is ChatContentWidth {
  return value === 'full' || value === '800';
}
