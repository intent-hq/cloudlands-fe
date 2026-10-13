import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { createFileSuffixResolver } from './file-suffix-resolver';

// Source compatibility binding; remove after all consumers bind their host transport.
const logger = createLogger('ResolveFileBySuffix');
export const resolveFileBySuffix = createFileSuffixResolver({
  request: <T>(...args: Parameters<typeof backendRequest>) => backendRequest<T>(...args),
  listDirectory: (...args) => appClient.files.listDirectory(...args),
  onError: (error) => logger.error('Failed to resolve file by suffix', error),
});
