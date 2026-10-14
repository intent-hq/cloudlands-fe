import type { SendMessagePayload } from './chat-state-types';
export function hasSendableMessageContent(
  text: string,
  blocks?: Pick<SendMessagePayload, 'imageBlocks' | 'fileBlocks'>,
): boolean {
  return (
    text.trim().length > 0 ||
    (blocks?.imageBlocks?.length ?? 0) > 0 ||
    (blocks?.fileBlocks?.length ?? 0) > 0
  );
}
