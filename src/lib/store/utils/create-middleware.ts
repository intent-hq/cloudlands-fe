import type { GenericAction, MiddlewareFunction, StoreMiddleware } from "../types";

const isPromise = (value: any): value is Promise<any> => {
  if (!value || value === null) {
    return false;
  }
  return value instanceof Promise;
};

export const createMiddleware = (middleware: MiddlewareFunction): StoreMiddleware => {
  return (middlewareApi) => (next) => (action) => {
    const result = middleware(action as GenericAction, middlewareApi);

    if (isPromise(result)) {
      return Promise.resolve(result)
        .then((resolvedResult) => {
          return next(resolvedResult ?? action);
        })
        .catch((error) => {
          next(action);
          throw error;
        });
    } else {
      return next(result ?? action);
    }
  };
};
