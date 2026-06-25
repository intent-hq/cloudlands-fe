import type {
  StoreAsyncActionCreator,
  StoreActionCreator,
  PayloadModifier,
} from '../../types';

export function createAction<ARGS extends any[], PL>(
  actionType: string,
  payloadModifier: PayloadModifier<ARGS, PL>,
): StoreActionCreator<ARGS, PL>;
export function createAction<ARGS extends any[]>(
  actionType: string,
  payloadModifier: PayloadModifier<ARGS, ARGS>,
): StoreActionCreator<ARGS, ARGS>;
export function createAction(
  actionType: string,
  payloadModifier?: undefined,
): StoreActionCreator<[], undefined>;
export function createAction<ARGS extends any[]>(
  actionType: string,
  payloadModifier?: undefined,
): StoreActionCreator<ARGS, ARGS>;
export function createAction(actionType: string, payloadModifier?: (...args: any[]) => any): any {
  function actionCreator(...args: any[]) {
    if (payloadModifier)
      return {
        type: actionType,
        payload: payloadModifier(...args),
      };
    return {
      type: actionType,
      payload: args,
    };
  }
  actionCreator.type = actionType;
  actionCreator.toString = () => actionType;
  return actionCreator;
}

export function createAsyncAction<ARGS extends any[], PL, R = unknown>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier: PayloadModifier<ARGS, PL>,
): StoreAsyncActionCreator<ARGS, PL, R>;
export function createAsyncAction<ARGS extends any[]>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier?: PayloadModifier<ARGS, ARGS>,
): StoreAsyncActionCreator<ARGS>;
export function createAsyncAction<R = unknown>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier?: undefined,
): StoreAsyncActionCreator<[], undefined, R>;
export function createAsyncAction<ARGS extends any[], R = unknown>(
  asyncActionType: string,
  stagesActionType: string,
): StoreAsyncActionCreator<ARGS, ARGS, R>;
export function createAsyncAction(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier?: (...args: any[]) => any,
): any {
  function actionCreator(...args: any[]) {
    let payload: any;
    let resolve!: (value: any) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    if (payloadModifier) payload = payloadModifier(...args);
    else payload = args;
    const successAction = createAction(`${stagesActionType}_SUCCESS`, (response: any) => {
      resolve(response);
      return {
        request: payload,
        response,
      };
    });
    const failureAction = createAction(`${stagesActionType}_FAILURE`, (error: any) => {
      reject(error);
      return {
        request: payload,
        error,
      };
    });
    return {
      type: stagesActionType,
      asyncActionType,
      payload,
      promise,
      success: successAction,
      failure: failureAction,
    };
  }
  const staticSuccessAction = createAction(`${stagesActionType}_SUCCESS`, (response: any) => ({
    request: void 0,
    response,
  }));
  const staticFailureAction = createAction(`${stagesActionType}_FAILURE`, (error: any) => ({
    request: void 0,
    error,
  }));
  actionCreator.type = stagesActionType;
  actionCreator.asyncActionType = asyncActionType;
  actionCreator.success = staticSuccessAction;
  actionCreator.failure = staticFailureAction;
  actionCreator.toString = () => stagesActionType;
  return actionCreator;
}
