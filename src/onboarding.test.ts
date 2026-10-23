import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/")
}));
import {
  completeWelcome,
  dismissEmptyTip,
  normalizeOnboardingState,
  resetOnboardingState,
  serializeExampleCanvas,
  shouldAutoOpenWelcome,
  shouldShowEmptyTip,
  uniqueCanvasPath,
  createExampleCanvas,
  EXAMPLE_CANVAS
} from "./onboarding";

describe("onboarding state", () => {
  it("defaults a missing state to unseen and normalizes invalid values", () => {
    expect(normalizeOnboardingState(undefined)).toEqual({
      welcome: "unseen",
      emptyTip: "unseen",
      exampleCanvasPath: "",
      updatedAt: ""
    });
    expect(normalizeOnboardingState({
      welcome: "unknown",
      emptyTip: "closed",
      exampleCanvasPath: 42,
      updatedAt: 7
    })).toEqual({
      welcome: "unseen",
      emptyTip: "unseen",
      exampleCanvasPath: "",
      updatedAt: ""
    });
  });

  it("shows the welcome only before the user completes or skips it", () => {
    expect(shouldAutoOpenWelcome({})).toBe(true);
    expect(shouldAutoOpenWelcome({ onboarding: { welcome: "completed" } })).toBe(false);
    expect(shouldAutoOpenWelcome({ onboarding: { welcome: "skipped" } })).toBe(false);
  });

  it("records completion without changing the empty tip state", () => {
    const state = completeWelcome(
      normalizeOnboardingState({ emptyTip: "dismissed" }),
      "completed",
      "Better Canvas/快速入门.canvas",
      new Date("2026-10-23T04:00:00.000Z")
    );
    expect(state).toEqual({
      welcome: "completed",
      emptyTip: "dismissed",
      exampleCanvasPath: "Better Canvas/快速入门.canvas",
      updatedAt: "2026-10-23T04:00:00.000Z"
    });
  });

  it("dismisses the empty tip once and resets both flags", () => {
    const dismissed = dismissEmptyTip(
      normalizeOnboardingState({ welcome: "skipped" }),
      new Date("2026-10-23T04:01:00.000Z")
    );
    expect(shouldShowEmptyTip({ onboarding: dismissed })).toBe(false);
    expect(dismissed.welcome).toBe("skipped");
    const reset = resetOnboardingState(new Date("2026-10-23T04:02:00.000Z"));
    expect(shouldAutoOpenWelcome({ onboarding: reset })).toBe(true);
    expect(shouldShowEmptyTip({ onboarding: reset })).toBe(true);
  });
});

describe("example canvas", () => {
  it("uses the first free numbered name without overwriting an existing file", () => {
    expect(uniqueCanvasPath("Better Canvas", "快速入门", [])).toBe("Better Canvas/快速入门.canvas");
    expect(uniqueCanvasPath("Better Canvas", "快速入门", [
      "Better Canvas/快速入门.canvas",
      "Better Canvas/快速入门 2.canvas"
    ])).toBe("Better Canvas/快速入门 3.canvas");
  });

  it("treats occupied names case-insensitively", () => {
    expect(uniqueCanvasPath("Better Canvas", "Quick Start", ["better canvas/quick start.canvas"]))
      .toBe("Better Canvas/Quick Start 2.canvas");
  });

  it("serializes a valid editable canvas with text cards, edges, and style entries", () => {
    const parsed = JSON.parse(serializeExampleCanvas());
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(6);
    expect(parsed.edges.length).toBeGreaterThanOrEqual(5);
    expect(parsed.nodes.some((node: any) => String(node.text).includes("画布主题"))).toBe(true);
    expect(parsed.nodes.some((node: any) => String(node.text).includes("节点样式"))).toBe(true);
    expect(parsed.nodes.every((node: any) => node.type === "text")).toBe(true);
    expect(parsed).toEqual(EXAMPLE_CANVAS);
    const ids = new Set(parsed.nodes.map((node: { id: string }) => node.id));
    expect(ids.size).toBe(parsed.nodes.length);
    expect(parsed.edges.every((edge: { fromNode: string; toNode: string }) =>
      ids.has(edge.fromNode) && ids.has(edge.toNode))).toBe(true);
  });

  it("opens a recorded example without rewriting the user's edits", async () => {
    const file = { path: "Better Canvas/快速入门.canvas", extension: "canvas" };
    const create = vi.fn();
    const app = { vault: { getAbstractFileByPath: () => file, create } } as any;
    expect(await createExampleCanvas(app, normalizeOnboardingState({ exampleCanvasPath: file.path })))
      .toEqual({ file, created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("retries a filename collision but propagates a genuine write failure", async () => {
    const files = new Map<string, any>([["Better Canvas", { path: "Better Canvas" }]]);
    const create = vi.fn(async (path: string) => {
      if (create.mock.calls.length === 1) {
        files.set(path, { path, extension: "canvas" });
        throw new Error("file already exists");
      }
      const file = { path, extension: "canvas" };
      files.set(path, file);
      return file;
    });
    const app = { vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      getAllLoadedFiles: () => [...files.values()],
      create
    } } as any;
    const result = await createExampleCanvas(app, normalizeOnboardingState(undefined));
    expect(result.file.path).toBe("Better Canvas/快速入门 2.canvas");
    expect(create).toHaveBeenCalledTimes(2);
    create.mockRejectedValueOnce(new Error("read only"));
    await expect(createExampleCanvas(app, normalizeOnboardingState(undefined))).rejects.toThrow("read only");
    expect(create).toHaveBeenCalledTimes(3);
  });
});
