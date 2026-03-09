import { expect, describe, test } from "vitest";
import { createAction, createAsyncAction } from "./create-action";
import type { PayloadModifier } from "../types";

// Test data types
type ChatItem = {
  id: string;
  content: string;
  timestamp: number;
};

describe("createAction", () => {
  test("creates and calls action with various argument patterns", () => {
    // No arguments
    const noArgsAction = createAction("NO_ARGS");
    expect(noArgsAction.type).toBe("NO_ARGS");
    expect(noArgsAction.toString()).toBe("NO_ARGS");
    expect(noArgsAction().payload).toEqual([]);

    // Single argument
    const singleArgAction = createAction<[string]>("SINGLE_ARG");
    expect(singleArgAction("test").payload).toEqual(["test"]);

    // Multiple arguments
    const multiArgAction = createAction<[string, number, boolean]>("MULTI_ARG");
    expect(multiArgAction("test", 42, true).payload).toEqual(["test", 42, true]);
  });

  test("works with payload modifier", () => {
    const modifier: PayloadModifier<[string, number], { combined: string }> = (str, num) => ({
      combined: `${str}-${num}`,
    });
    const action = createAction("WITH_MODIFIER", modifier);

    expect(action("test", 42).payload).toEqual({ combined: "test-42" });
  });

  test("tuple type overload accepts multiple arguments (memory requirement)", () => {
    // This tests the specific memory requirement about tuple type overloads
    const action =
      createAction<[conversationId: string, requestId: string, chatItem: ChatItem]>(
        "ADD_CHAT_ITEM"
      );
    const chatItem: ChatItem = { id: "chat-1", content: "Hello", timestamp: Date.now() };

    const result = action("conv-123", "req-456", chatItem);

    expect(result.type).toBe("ADD_CHAT_ITEM");
    expect(result.payload).toEqual(["conv-123", "req-456", chatItem]);
  });

  test("handles edge cases", () => {
    // Null/undefined values
    const nullAction = createAction<[string | null, number | undefined]>("NULL_ACTION");
    expect(nullAction(null, undefined).payload).toEqual([null, undefined]);

    // Empty values
    const emptyAction = createAction<[string, number]>("EMPTY_ACTION");
    expect(emptyAction("", 0).payload).toEqual(["", 0]);
  });
});

describe("createAsyncAction", () => {
  test("creates and calls async action with various patterns", () => {
    // Basic creation
    const action = createAsyncAction("ASYNC_ACTION", "ASYNC_STAGES");
    expect(action.type).toBe("ASYNC_STAGES");
    expect(action.asyncActionType).toBe("ASYNC_ACTION");
    expect(typeof action.success).toBe("function");
    expect(typeof action.failure).toBe("function");

    // Call with arguments
    const result = action();
    expect(result.type).toBe("ASYNC_STAGES");
    expect(result.payload).toEqual([]);
    expect(result.promise).toBeInstanceOf(Promise);
  });

  test("works with payload modifier", () => {
    const modifier: PayloadModifier<[string, number], { combined: string }> = (str, num) => ({
      combined: `${str}-${num}`,
    });
    const action = createAsyncAction("ASYNC_ACTION", "ASYNC_STAGES", modifier);

    expect(action("test", 42).payload).toEqual({ combined: "test-42" });
  });

  test("handles success and failure actions", async () => {
    const action = createAsyncAction<[string]>("ASYNC_ACTION", "ASYNC_STAGES");
    const asyncResult = action("test-payload");

    // Test success
    const successResult = asyncResult.success("response-data");
    expect(successResult.type).toBe("ASYNC_STAGES_SUCCESS");
    expect(successResult.payload.request).toEqual(["test-payload"]);
    expect(successResult.payload.response).toBe("response-data");

    // Test promise resolution
    const result = await asyncResult.promise;
    expect(result).toBe("response-data");
  });

  test("handles promise rejection", async () => {
    const action = createAsyncAction<[string]>("ASYNC_ACTION", "ASYNC_STAGES");
    const asyncResult = action("test-payload");

    const error = new Error("Test error");
    const failureResult = asyncResult.failure(error);

    expect(failureResult.type).toBe("ASYNC_STAGES_FAILURE");
    expect(failureResult.payload.error).toBe(error);

    await expect(asyncResult.promise).rejects.toBe(error);
  });

  test("tuple type overload for async actions", () => {
    const action = createAsyncAction<
      [conversationId: string, requestId: string, chatItem: ChatItem]
    >("ASYNC_ACTION", "ASYNC_STAGES");
    const chatItem: ChatItem = { id: "chat-1", content: "Hello", timestamp: Date.now() };

    const result = action("conv-123", "req-456", chatItem);

    expect(result.type).toBe("ASYNC_STAGES");
    expect(result.payload).toEqual(["conv-123", "req-456", chatItem]);
  });
});
