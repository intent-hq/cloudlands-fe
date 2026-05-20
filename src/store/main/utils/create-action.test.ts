import {
  describe,
  expect,
  expectTypeOf,
  test,
} from "vitest";
import type { PayloadModifier } from "svelte-redux-toolkit/types";
import {
  createAction,
  type MainStoreAction,
} from "./create-action";

type ChatItem = {
  id: string;
  content: string;
  timestamp: number;
};

describe("main createAction", () => {
  test("auto-tags actions with the main store marker", () => {
    const action = createAction<[id: string, enabled: boolean]>("main/testAction");

    expect(action.type).toBe("main/testAction");
    expect(action.toString()).toBe("main/testAction");
    expect(action("abc", true)).toEqual({
      type: "main/testAction",
      payload: ["abc", true],
      __store: "main",
    });
  });

  test("preserves payload modifier behavior while adding the main store marker", () => {
    const payloadModifier: PayloadModifier<[name: string, count: number], { key: string }> = (
      name,
      count
    ) => ({ key: `${name}:${count}` });

    const action = createAction("main/withModifier", payloadModifier);

    expect(action("test", 2)).toEqual({
      type: "main/withModifier",
      payload: { key: "test:2" },
      __store: "main",
    });
  });

  test("preserves the base overload signatures", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const noArgsAction = createAction("main/noArgs");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const tupleAction = createAction<
      [conversationId: string, requestId: string, chatItem: ChatItem]
    >("main/addChatItem");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const modifiedAction = createAction(
      "main/modified",
      (name: string, count: number) => ({ name, count })
    );

    expectTypeOf<Parameters<typeof noArgsAction>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<typeof noArgsAction>>().toEqualTypeOf<MainStoreAction<undefined>>();

    expectTypeOf<Parameters<typeof tupleAction>>().toEqualTypeOf<[
      conversationId: string,
      requestId: string,
      chatItem: ChatItem,
    ]>();
    expectTypeOf<ReturnType<typeof tupleAction>>().toEqualTypeOf<
      MainStoreAction<[string, string, ChatItem]>
    >();

    expectTypeOf<Parameters<typeof modifiedAction>>().toEqualTypeOf<[string, number]>();
    expectTypeOf<ReturnType<typeof modifiedAction>>().toEqualTypeOf<
      MainStoreAction<{ name: string; count: number }>
    >();
  });
});