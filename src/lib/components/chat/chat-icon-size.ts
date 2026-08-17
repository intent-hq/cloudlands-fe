export const CHAT_ICON_SIZE = {
  header: 12,
  navigationArrow: 24,
  compact: 16,
  default: 20,
  emphasized: 24,
} as const;

export type ChatIconSize = keyof typeof CHAT_ICON_SIZE;
