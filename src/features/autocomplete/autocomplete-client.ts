/**
 * `input.autocomplete` (Contract §2): `{ text, context } → { completion }`.
 *
 * Silent by design: the daemon already returns `""` for every soft failure,
 * and anything else that goes wrong here — an older daemon without the
 * method (`-32601`), a transport timeout, a malformed result — is also folded
 * to `""`. No toast, no error UI; debug log only.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('Autocomplete');

/** Daemon upstream timeout is 4 s; leave room for the round trip. */
export const AUTOCOMPLETE_REQUEST_TIMEOUT_MS = 6000;
const COMPLETION_MAX_CHARS = 200;

export async function requestAutocompletion(text: string, context: string): Promise<string> {
  try {
    const result = await backendRequest<{ completion?: unknown }>(
      'input.autocomplete',
      { text, context },
      { timeoutMs: AUTOCOMPLETE_REQUEST_TIMEOUT_MS },
    );
    const completion = typeof result?.completion === 'string' ? result.completion : '';
    // The daemon already cleans the reply; keep the ghost one line and bounded regardless.
    return completion.split('\n', 1)[0].slice(0, COMPLETION_MAX_CHARS);
  } catch (error) {
    logger.debug('input.autocomplete failed', error);
    return '';
  }
}
