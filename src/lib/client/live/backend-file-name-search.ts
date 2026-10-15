import type { BackendRequestOptions } from './backend-transport-types';
import type { FileNameSearchResult } from '../file-name-search-types';

/** Bounded filename/path search. Malformed responses and transport failures remain errors. */
export function createBackendFileNameSearch(
  request: <T>(
    method: string,
    params: Record<string, unknown>,
    options?: BackendRequestOptions & { onDispatch?: () => void },
  ) => Promise<T>,
) {
  return async function read(
    workspaceId: string,
    query: string,
    isCurrent?: () => boolean,
  ): Promise<FileNameSearchResult> {
    const onDispatch = () => {
      // i18n-ignore (internal captured-context diagnostic)
      if (isCurrent && !isCurrent()) throw new Error('File name search retired');
    };
    onDispatch();
    const params = { workspaceId, pattern: query, limit: 100 };
    const result = isCurrent
      ? await request<unknown>('search.fileNames', params, { onDispatch })
      : await request<unknown>('search.fileNames', params);
    onDispatch();
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalidResponse();
    const { files, requestId, truncated } = result as {
      files?: unknown;
      requestId?: unknown;
      truncated?: unknown;
    };
    if (
      !Array.isArray(files) ||
      files.length > 100 ||
      typeof requestId !== 'string' ||
      !requestId ||
      typeof truncated !== 'boolean'
    )
      throw invalidResponse();
    const seen = new Set<string>();
    for (const path of files) {
      if (
        typeof path !== 'string' ||
        path.includes('\0') ||
        path.split('/').some((part) => !part || part === '.' || part === '..') ||
        seen.has(path)
      )
        throw invalidResponse();
      seen.add(path);
    }
    return { files, truncated };
  };
}

function invalidResponse(): TypeError {
  // i18n-ignore (internal wire-contract diagnostic)
  return new TypeError('Invalid search.fileNames response');
}
