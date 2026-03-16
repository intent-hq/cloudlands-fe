import { call, put, select, takeEvery } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { createLogger } from "$lib/utils/client-logger";
import {
  approvePermission,
  denyPermission,
  cancelPermission,
  selectPermissionOption,
  removePermissionRequest,
  type PermissionRequest,
} from "../permission-slice";

const logger = createLogger("PermissionSaga");

function* getRequest(requestId: string): Generator<any, PermissionRequest | undefined, any> {
  const requests: PermissionRequest[] = yield* select(
    (state: any) => state.permission.requests,
  );
  return requests.find((r) => r.requestId === requestId);
}

function* handleApprove(action: ReturnType<typeof approvePermission>) {
  const [requestId] = action.payload;
  const request = yield* getRequest(requestId);
  if (!request) {
    logger.warn("Cannot approve: request not found", { requestId });
    return;
  }

  // Find the first non-destructive option, or fall back to the first option
  const approveOption = request.options.find((opt) => !opt.destructive) || request.options[0];
  const optionId = approveOption?.id || "allow_once";

  logger.info("Approving permission request", {
    requestId,
    title: request.title,
    optionId,
    availableOptions: request.options.map((o) => o.id),
  });

  try {
    yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
      requestId,
      outcome: { outcome: "selected", optionId },
    });
    yield* put(removePermissionRequest(requestId));
  } catch (error) {
    logger.error("Failed to approve permission request", { requestId, error });
  }
}

function* handleDeny(action: ReturnType<typeof denyPermission>) {
  const [requestId] = action.payload;
  const request = yield* getRequest(requestId);
  if (!request) {
    logger.warn("Cannot deny: request not found", { requestId });
    return;
  }

  // Find the first destructive option, or fall back to the last option
  const denyOption =
    request.options.find((opt) => opt.destructive) || request.options[request.options.length - 1];
  const optionId = denyOption?.id || "reject_once";

  logger.info("Denying permission request", {
    requestId,
    title: request.title,
    optionId,
    availableOptions: request.options.map((o) => o.id),
  });

  try {
    yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
      requestId,
      outcome: { outcome: "selected", optionId },
    });
    yield* put(removePermissionRequest(requestId));
  } catch (error) {
    logger.error("Failed to deny permission request", { requestId, error });
  }
}

function* handleCancel(action: ReturnType<typeof cancelPermission>) {
  const [requestId] = action.payload;

  logger.info("Cancelling permission request", { requestId });

  try {
    yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
      requestId,
      outcome: { outcome: "cancelled" },
    });
    yield* put(removePermissionRequest(requestId));
  } catch (error) {
    logger.error("Failed to cancel permission request", { requestId, error });
  }
}

function* handleSelectOption(action: ReturnType<typeof selectPermissionOption>) {
  const [requestId, optionId] = action.payload;
  const request = yield* getRequest(requestId);
  if (!request) {
    logger.warn("Cannot select option: request not found", { requestId });
    return;
  }

  logger.info("Selecting permission option", {
    requestId,
    title: request.title,
    optionId,
  });

  try {
    yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
      requestId,
      outcome: { outcome: "selected", optionId },
    });
    yield* put(removePermissionRequest(requestId));
  } catch (error) {
    logger.error("Failed to select permission option", { requestId, optionId, error });
  }
}

/**
 * Root respond saga: watches for approve/deny/cancel/selectOption actions.
 */
export function* respondPermissionSaga() {
  yield* takeEvery(approvePermission, handleApprove);
  yield* takeEvery(denyPermission, handleDeny);
  yield* takeEvery(cancelPermission, handleCancel);
  yield* takeEvery(selectPermissionOption, handleSelectOption);
}

