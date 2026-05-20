import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { getItem } from "svelte-redux-toolkit/utils/collections/collection-utils";
import {
  approvePermission,
  denyPermission,
  cancelPermission,
  selectPermissionOption,
  removePermissionRequest,
  type PermissionRequest,
} from "../permission-slice";
import { selectPermissionRequestsCollection } from "../permission-selectors";
function* getRequest(requestId: string): Generator<any, PermissionRequest | undefined, any> {
    const requests = yield* selectPermissionRequestsCollection.effect();
    return getItem(requests, requestId);
}
function* handleApprove(action: ReturnType<typeof approvePermission>) {
    const [requestId] = action.payload;
    const request = yield* getRequest(requestId);
    if (!request) {
        return;
    }
    // Find the first non-destructive option, or fall back to the first option
    const approveOption = request.options.find((opt) => !opt.destructive) || request.options[0];
    const optionId = approveOption?.id || "allow_once";
    try {
        yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
            requestId,
            outcome: { outcome: "selected", optionId },
        });
        yield* put(removePermissionRequest(requestId));
    }
    catch {
    }
}
function* handleDeny(action: ReturnType<typeof denyPermission>) {
    const [requestId] = action.payload;
    const request = yield* getRequest(requestId);
    if (!request) {
        return;
    }
    // Find the first destructive option, or fall back to the last option
    const denyOption = request.options.find((opt) => opt.destructive) || request.options[request.options.length - 1];
    const optionId = denyOption?.id || "reject_once";
    try {
        yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
            requestId,
            outcome: { outcome: "selected", optionId },
        });
        yield* put(removePermissionRequest(requestId));
    }
    catch {
    }
}
function* handleCancel(action: ReturnType<typeof cancelPermission>) {
    const [requestId] = action.payload;
    try {
        yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
            requestId,
            outcome: { outcome: "cancelled" },
        });
        yield* put(removePermissionRequest(requestId));
    }
    catch {
    }
}
function* handleSelectOption(action: ReturnType<typeof selectPermissionOption>) {
    const [requestId, optionId] = action.payload;
    const request = yield* getRequest(requestId);
    if (!request) {
        return;
    }
    try {
        yield* call(invoke, IPC_CHANNELS.PERMISSION.RESPOND, {
            requestId,
            outcome: { outcome: "selected", optionId },
        });
        yield* put(removePermissionRequest(requestId));
    }
    catch {
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
