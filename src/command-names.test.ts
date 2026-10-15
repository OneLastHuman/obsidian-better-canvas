import { describe, expect, it } from "vitest";
import { normalizeCommandDisplayName } from "./command-names";

describe("command display names", () => {
  it("removes one or more plugin prefixes so Obsidian can add exactly one", () => {
    expect(normalizeCommandDisplayName("Better Canvas: 根据所选节点生成图片"))
      .toBe("根据所选节点生成图片");
    expect(normalizeCommandDisplayName("Better Canvas: Better Canvas: 创建子节点"))
      .toBe("创建子节点");
  });

  it("trims names and keeps unrelated text intact", () => {
    expect(normalizeCommandDisplayName("  自定义命令  ")).toBe("自定义命令");
  });
});
