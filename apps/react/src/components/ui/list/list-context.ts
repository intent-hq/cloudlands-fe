import { createContext, useContext } from 'react';
import type { ProximityHover } from '@/lib/interaction';

export interface ListProximityContextValue {
  interactive: boolean;
  hover: ProximityHover | null;
  claimIndex(): number;
}
export const ListProximityContext = createContext<ListProximityContextValue | undefined>(undefined);
export const getListProximityContext = () => useContext(ListProximityContext);
