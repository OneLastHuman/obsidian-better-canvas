import { describe, expect, it } from "vitest";
import { getNodeAIContextMenuActions } from "./node-ai-context-menu";

describe("getNodeAIContextMenuActions", () => {
  it("provides AI actions without offering regeneration for ordinary nodes", () => {
    const actions = getNodeAIContextMenuActions(false);

    expect(actions.map(action => action.id)).toEqual([
      "ask",
      "image",
      "flashcards",
      "model"
    ]);
    expect(actions.some(action => action.id === "regenerate")).toBe(false);
  });

  it("offers regeneration only for generated AI nodes", () => {
    const actions = getNodeAIContextMenuActions(true);

    expect(actions.map(action => action.id)).toEqual([
      "ask",
      "image",
      "flashcards",
      "model",
      "regenerate"
    ]);
    expect(actions.find(action => action.id === "regenerate")?.title)
      .toBe("Better Canvas: 重新生成 AI 节点");
  });
});
