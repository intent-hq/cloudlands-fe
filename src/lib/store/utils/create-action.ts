import type {
  StoreAction,
  StoreAsyncActionCreator,
  StoreActionCreator,
  PayloadModifier,
  StoreAsyncAction,
  SuccessResponse,
  ErrorResponse,
} from "../types";

// Overload 1: With payloadModifier - payload is whatever the modifier returns
export function createAction<ARGS extends any[], PL>(
  actionType: string,
  payloadModifier: PayloadModifier<ARGS, PL>
): StoreActionCreator<ARGS, PL>;

export function createAction<ARGS extends any[]>(
  actionType: string,
  payloadModifier: PayloadModifier<ARGS, ARGS>
): StoreActionCreator<ARGS, ARGS>;

// Overload 2: No payloadModifier, no arguments - payload is undefined
export function createAction(
  actionType: string,
  payloadModifier?: undefined
): StoreActionCreator<[], undefined>;

// Overload 3: No payloadModifier, tuple type - spreads as multiple arguments, payload is the tuple
// This matches when T is explicitly a tuple type like [string, number] or [string]
// The constraint excludes array types: if number extends T['length'], it's an array (variable length)
// If T['length'] is a literal like 2 or 3, then number does NOT extend it, so it's a tuple
export function createAction<ARGS extends any[]>(
  actionType: string,
  payloadModifier?: undefined
): StoreActionCreator<ARGS, ARGS>;

export function createAction<ARGS extends any[] = [], PL = ARGS>(
  actionType: string,
  payloadModifier?: PayloadModifier<ARGS, PL>
): StoreActionCreator<ARGS, PL> {
  function actionCreator(...args: any[]): StoreAction<PL> {
    if (payloadModifier) {
      return {
        type: actionType,
        payload: payloadModifier(...(args as ARGS)),
      };
    }

    // No modifier - use args as payload
    return {
      type: actionType,
      payload: args as unknown as PL,
    };
  }

  actionCreator.type = actionType;
  actionCreator.toString = () => actionType;

  return actionCreator as StoreActionCreator<ARGS, PL>;
}

// Overload 1: With payloadModifier - payload is whatever the modifier returns
export function createAsyncAction<ARGS extends any[], PL, R = unknown>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier: PayloadModifier<ARGS, PL>
): StoreAsyncActionCreator<ARGS, PL, R>;

// Overload 1.5: No payload modifier, only arguments types provided
export function createAsyncAction<ARGS extends any[]>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier?: PayloadModifier<ARGS, ARGS>
): StoreAsyncActionCreator<ARGS>;

// Overload 2: No payloadModifier, no arguments - payload is undefined
export function createAsyncAction<R = unknown>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier?: undefined
): StoreAsyncActionCreator<[], undefined, R>;

// Overload 4: No payloadModifier, multiple arguments - payload is the tuple of arguments
export function createAsyncAction<ARGS extends any[], R = unknown>(
  asyncActionType: string,
  stagesActionType: string
): StoreAsyncActionCreator<ARGS, ARGS, R>;

// Implementation
export function createAsyncAction<ARGS extends any[] = [], PL = ARGS, R = unknown>(
  asyncActionType: string,
  stagesActionType: string,
  payloadModifier?: PayloadModifier<ARGS, PL>
): StoreAsyncActionCreator<ARGS, PL, R> {
  function actionCreator(...args: any[]): StoreAsyncAction<PL, R> {
    // Determine payload using same logic as createAction
    let payload: PL;
    let resolve: (resolve: R) => void;
    let reject: (error: Error) => void;

    const promise = new Promise<R>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    if (payloadModifier) {
      payload = (payloadModifier as any)(...args);
    } else {
      payload = args as unknown as PL;
    }

    // Create success action with captured payload
    const successAction = createAction<[R], SuccessResponse<PL, R>>(
      `${stagesActionType}_SUCCESS`,
      (response: R) => {
        resolve(response);
        return {
          request: payload,
          response,
        };
      }
    );

    const failureAction = createAction<[Error], ErrorResponse<PL>>(
      `${stagesActionType}_FAILURE`,
      (error: Error) => {
        reject(error);
        return {
          request: payload,
          error,
        };
      }
    );

    return {
      type: stagesActionType,
      asyncActionType: asyncActionType,
      payload,
      promise,
      success: successAction,
      failure: failureAction,
    };
  }

  // Create static success action (without captured payload)
  const staticSuccessAction = createAction<[R], SuccessResponse<PL, R>>(
    `${stagesActionType}_SUCCESS`,
    (response: R) => ({
      request: undefined as unknown as PL,
      response,
    })
  );

  const staticFailureAction = createAction<[Error], ErrorResponse<PL>>(
    `${stagesActionType}_FAILURE`,
    (error: Error) => ({
      request: undefined as unknown as PL,
      error,
    })
  );

  actionCreator.type = stagesActionType;
  actionCreator.asyncActionType = asyncActionType;
  actionCreator.success = staticSuccessAction;
  actionCreator.failure = staticFailureAction;
  actionCreator.toString = () => stagesActionType;

  return actionCreator as StoreAsyncActionCreator<ARGS, PL, R>;
}
