import { describe, expect, it } from "vitest";
import { getNodeAIContextMenuActions } from "./node-ai-context-menu";

describe("getNodeAIContextMenuActions", () => {
  it("provides AI actions without offering regeneration for ordinary nodes", () => {
    const actions = getNodeAIContextMenuActions(false);

    expect(actions.map(action => action.id)).toEqual([
      "ask",
      "image",
      "flashcards"
    ]);
    expect(actions.some(action => action.id === "regenerate")).toBe(false);
    expect(actions.map(action => action.title)).toEqual(["问 AI", "生成图片", "生成闪卡"]);
  });

  it("offers regeneration only for generated AI nodes", () => {
    const actions = getNodeAIContextMenuActions(true);

    expect(actions.map(action => action.id)).toEqual([
      "ask",
      "image",
      "flashcards",
      "regenerate"
    ]);
    expect(actions.find(action => action.id === "regenerate")?.title)
      .toBe("重生成");
  });
});
