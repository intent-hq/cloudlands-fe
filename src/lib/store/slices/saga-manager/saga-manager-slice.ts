import type { SagaName } from "../../sagas";
import { createAction } from "../../utils/create-action";

/*
    These actions are for components only, it is unsafe to dispatch them
    without attaching to a lifecycle with dispose method.
    Every dispatch of startSaga should be accompanied with a handler that calls stopSaga for it.
    This is done in the runSaga utility (src/lib/store/components/run-saga.ts).
*/
export const startSaga = createAction<[SagaName]>("startSaga");
export const stopSaga = createAction<[SagaName]>("stopSaga");
