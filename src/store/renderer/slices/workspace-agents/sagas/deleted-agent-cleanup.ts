import { invoke } from '$lib/electron-bridge';
import { createDeletedAgentCleanup } from './deleted-agent-cleanup-factory';

// Compatibility binding for the existing read/chat sagas until the Svelte renderer is retired.
export const cleanupDeletedAgentTabs = createDeletedAgentCleanup({ invoke });
