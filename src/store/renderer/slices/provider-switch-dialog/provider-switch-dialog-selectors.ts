import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { ProviderSwitchDialogView } from './provider-switch-dialog-types';

/** The dialog view: rows in order, with each agent's run result merged in. */
export const selectProviderSwitchDialog = store.createSelector(
  (state): ProviderSwitchDialogView => {
    const { rows, outcomes, workersSwitched, ...fields } = state.providerSwitchDialog;
    return {
      ...fields,
      rows: getItems(rows).map((row) => {
        const switched = row.agents.reduce(
          (total, agent) => total + (workersSwitched[agent.agentId] ?? 0),
          0,
        );
        return {
          ...row,
          ...(switched > 0 ? { workersSwitched: switched } : {}),
          agents: row.agents.map((agent) =>
            outcomes[agent.agentId] ? { ...agent, outcome: outcomes[agent.agentId] } : agent,
          ),
        };
      }),
    };
  },
);
