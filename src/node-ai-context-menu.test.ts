import { describe, expect, it } from "vitest";
import {
  addNodeAIContextMenuItems,
  getNodeAIContextMenuActions,
  type NodeAIContextMenuItem
} from "./node-ai-context-menu";

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

describe("addNodeAIContextMenuItems", () => {
  function createMenu() {
    const calls: string[] = [];
    const handlers: Array<() => void> = [];
    const menu = {
      addItem(callback: (item: NodeAIContextMenuItem) => void) {
        const item: NodeAIContextMenuItem = {
          setTitle(title) {
            calls.push(`title:${title}`);
            return item;
          },
          setIcon(icon) {
            calls.push(`icon:${icon}`);
            return item;
          },
          onClick(handler) {
            handlers.push(handler);
            return item;
          }
        };
        callback(item);
      },
      addSeparator() {
        calls.push("separator");
      }
    };
    return { menu, calls, handlers };
  }

  it("adds the AI group after the native separator and closes it with one separator", () => {
    const { menu, calls } = createMenu();

    addNodeAIContextMenuItems(menu, false, () => {});

    expect(calls).toEqual([
      "title:问 AI",
      "icon:sparkles",
      "title:生成图片",
      "icon:image",
      "title:生成闪卡",
      "icon:graduation-cap",
      "separator"
    ]);
    expect(calls.filter(call => call === "separator")).toHaveLength(1);
    expect(calls[0]).not.toBe("separator");
  });

  it("keeps regeneration inside the AI group for generated nodes", () => {
    const { menu, calls } = createMenu();

    addNodeAIContextMenuItems(menu, true, () => {});

    expect(calls.filter(call => call === "title:重生成")).toHaveLength(1);
    expect(calls.indexOf("title:重生成"))
      .toBeGreaterThan(calls.indexOf("title:生成闪卡"));
    expect(calls.indexOf("title:重生成"))
      .toBeLessThan(calls.indexOf("separator"));
  });

  it("dispatches the matching action id when an item is clicked", () => {
    const dispatched: string[] = [];
    const { menu, handlers } = createMenu();

    addNodeAIContextMenuItems(menu, true, id => dispatched.push(id));
    handlers.forEach(handler => handler());

    expect(dispatched).toEqual(["ask", "image", "flashcards", "regenerate"]);
  });
});
