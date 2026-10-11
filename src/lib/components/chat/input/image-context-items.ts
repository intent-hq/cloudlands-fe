import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import type { ContextItem } from './context-item';
import {
  imageFilesToContextItems as readImageContextItems,
  type ImageContextItemsOptions,
  type ImageContextItemsReporter,
} from './image-context-items-core';

export {
  REFERENCE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_MAX_BYTES,
  formatFileSize,
  type ImageContextItemsOptions,
} from './image-context-items-core';

const logger = createLogger('image-context-items');
const reporter: ImageContextItemsReporter = {
  failed(file, error) {
    logger.error('Failed to add image to context', { fileName: file.name, error });
    notify.error(m.chat_richInput_addImageFailed_error({ name: file.name }));
  },
  added(count) {
    logger.debug(`Added ${count} image(s) to context`);
    notify.success(
      count === 1
        ? m.chat_richInput_addedImages_toast_one()
        : m.chat_richInput_addedImages_toast_many({ count: formatInteger(count) }),
    );
  },
  oversized(names) {
    notify.error(m.chat_richInput_filesTooLarge_error({ names: names.join(', ') }));
  },
};

export function imageFilesToContextItems(
  files: File[],
  options: ImageContextItemsOptions,
): Promise<ContextItem[]> {
  return readImageContextItems(files, options, reporter);
}
