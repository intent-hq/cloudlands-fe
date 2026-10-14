import { createContext } from 'react';

export const WorkspaceReturnFocus = createContext<(() => string | undefined) | null>(null);
