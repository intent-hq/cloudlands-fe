import type { ClientLogger } from '$lib/utils/client-logger';

export type LoggerLike = Pick<ClientLogger, 'debug' | 'info' | 'warn' | 'error'>;
