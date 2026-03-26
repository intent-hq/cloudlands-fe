import * as Sentry from "@sentry/electron/renderer";
import { call, delay, takeEvery, fork, setContext, put } from "typed-redux-saga";
import { startSaga, stopSaga } from "../saga-manager-slice";
import { type Task } from "redux-saga";
import type { ReduxStoreContext, SagaCrashRecord, SagaName, SagaStatusRecord, StoreState } from "../../../types";
import { sagas } from "../../../sagas";
import { type SagaReturnType } from "redux-saga/effects";
import type { Readable } from "svelte/store";
import { selectUpdatesLocked } from "../../store-utility/store-utility-selectors";
import { unlockUpdates } from "../../store-utility/store-utility-slice";

const DECREASE_RESTARTS_COUNT_DELAY = 60 * 1000; // a minute
/*
  Allow to run though all attempts in 1/4 of time.
  important to have RESTART_DELAY short enough, so constantly failing saga will be terminated eventually,
  but a saga that fails once in a while will not run out of restart attempts;
*/
const RESTART_DELAY = 1000;
const MAX_RESTART_DELAY = 10 * 60 * 1000;

// const RESTART_RESET_TIMDEOUT =
export const getBackOffDelay = (restarts: number) => {
  return Math.min(RESTART_DELAY * Math.pow(2, restarts), MAX_RESTART_DELAY);
};

const createSagaStatusRecord = (): SagaStatusRecord => ({
  isRunning: false,
  launchedAtTs: null,
  crashes: [],
});

const cloneSagaStatusRecord = (status: SagaStatusRecord): SagaStatusRecord => ({
  ...status,
  crashes: status.crashes.map((crash) => ({ ...crash })),
});

const toError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const autoRestart = (
  sagaName: SagaName,
  onCrash?: (crashes: SagaCrashRecord[]) => void,
  initialCrashes: SagaCrashRecord[] = []
) => {
  const saga = sagas[sagaName];

  return function* autoRestarting(...args: Parameters<typeof saga>) {
    let restarts = 0;
    let restartsCount = 0;
    let lastTimeStarted = +new Date();
    const crashes: SagaCrashRecord[] = initialCrashes.map((crash) => ({ ...crash }));

    while (true) {
      try {
        yield* call(saga, ...args); // `call(..)` blocks generator execution
        break; // if saga finished successfully no need to restart it
      } catch (e) {
        crashes.push({
          crashedAt: new Date(),
          error: toError(e),
        });
        onCrash?.([...crashes]);

        const wasStoreLocked = yield* selectUpdatesLocked.effect();
        if (wasStoreLocked) {
          yield* put(unlockUpdates());
        }
        /*
          Decrease restarts proportionally time passed since last restart and increase by 1;
          This allows to increase available restart attempts over time,
          but will terminate permanently a saga that fails more than `RESTART_LIMITS` per `DECREASE_RESTARTS_COUNT_DELAY`ms;
        */
        const backoffDelay = getBackOffDelay(restarts);
        restartsCount++;

        restarts =
          Math.max(
            0,
            restarts - Math.floor((+new Date() - lastTimeStarted) / DECREASE_RESTARTS_COUNT_DELAY)
          ) + 1;
        lastTimeStarted = +new Date();

        const errorMessage = `Saga "${sagaName}" crashed ${restartsCount === 1 ? "first time" : restartsCount + " times"}. Restarting... (restart in ${backoffDelay / 1000}s)\n`;
        console.error(errorMessage, e);
        Sentry.captureException(new Error(errorMessage), {
          extra: {
            error: e,
            sagaName,
            restarts,
          },
        });

        yield* delay(backoffDelay);
      }
    }
  };
};

type SagaTaskRecord = {
  task: Task<SagaReturnType<any>>;
  name: SagaName;
  counter: number;
};

export function* sagaManager(
  readableStoreState: Readable<StoreState>,
  exposeContext: (tasks: ReduxStoreContext["tasks"]) => void
) {
  yield* setContext({
    readableStoreState,
  });

  const sagaNames = Object.keys(sagas) as SagaName[];
  const runningTasks = new Map<SagaName, SagaTaskRecord>();
  const sagaStatuses = new Map<SagaName, SagaStatusRecord>(
    sagaNames.map((name) => [name, createSagaStatusRecord()])
  );

  const getSagaStatus = (sagaName: SagaName) => {
    const existingStatus = sagaStatuses.get(sagaName);
    if (existingStatus) {
      return existingStatus;
    }

    const newStatus = createSagaStatusRecord();
    sagaStatuses.set(sagaName, newStatus);
    return newStatus;
  };

  const setSagaStatus = (
    sagaName: SagaName,
    updater: (status: SagaStatusRecord) => SagaStatusRecord
  ) => {
    sagaStatuses.set(sagaName, updater(getSagaStatus(sagaName)));
  };

  const updateContext = () => {
    exposeContext(
      Object.fromEntries(
        sagaNames.map((name) => {
          return [name, cloneSagaStatusRecord(getSagaStatus(name))];
        })
      ) as ReduxStoreContext["tasks"]
    );
  };

  yield* takeEvery(startSaga, function* (action) {
    const [sagaName] = action.payload;
    const runningTask = runningTasks.get(sagaName);
    if (runningTask) {
      if (!runningTask.task.isRunning()) {
        // Task completed (e.g., noop saga or autoRestart broke out); clean up stale entry
        runningTasks.delete(sagaName);
        setSagaStatus(sagaName, (status) => ({
          ...status,
          isRunning: false,
        }));
      } else {
        const updatedRecord = {
          ...runningTask,
          counter: runningTask.counter + 1,
        };

        runningTasks.set(sagaName, updatedRecord);
        updateContext();
        return;
      }
    }
    const autorestartingSaga = autoRestart(
      sagaName,
      (crashes) => {
        setSagaStatus(sagaName, (status) => ({
          ...status,
          crashes: [...crashes],
        }));
        updateContext();
      },
      getSagaStatus(sagaName).crashes
    );
    const task = yield* fork(autorestartingSaga);
    const isRunning = task.isRunning();
    if (isRunning) {
      const newTaskRecord: SagaTaskRecord = {
        task,
        name: sagaName,
        counter: 1,
      };
      runningTasks.set(sagaName, newTaskRecord);
    }
    setSagaStatus(sagaName, (status) => ({
      ...status,
      isRunning,
      launchedAtTs: Date.now(),
    }));
    updateContext();
  });

  yield* takeEvery(stopSaga, function (action) {
    const [sagaName] = action.payload;
    const runningTask = runningTasks.get(sagaName);
    if (!runningTask) {
      return;
    }
    const updatedRecord = {
      ...runningTask,
      counter: runningTask.counter - 1,
    };

    if (updatedRecord.counter <= 0) {
      updatedRecord.task.cancel();
    }

    if (updatedRecord.task.isCancelled()) {
      runningTasks.delete(sagaName);
      setSagaStatus(sagaName, (status) => ({
        ...status,
        isRunning: false,
      }));
    } else {
      runningTasks.set(sagaName, updatedRecord);
      setSagaStatus(sagaName, (status) => ({
        ...status,
        isRunning: updatedRecord.task.isRunning(),
      }));
    }
    updateContext();
  });
}
