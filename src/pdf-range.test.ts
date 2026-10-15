import { describe, expect, it } from "vitest";
import { parsePdfPageSelection } from "./pdf-range";

describe("parsePdfPageSelection", () => {
  it("parses single pages and ranges", () => {
    expect(parsePdfPageSelection("4")).toEqual([4]);
    expect(parsePdfPageSelection("1-3, 5, 8-10")).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it("deduplicates overlaps and normalizes ordering", () => {
    expect(parsePdfPageSelection("5, 1-3, 3-6, 2")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(["", "1,,3", "0", "-1", "4-2", "x", "1 -", "10001"])(
    "rejects malformed or out-of-bounds page selection: %s",
    input => {
      expect(() => parsePdfPageSelection(input)).toThrow();
    }
  );

  it("rejects selections exceeding the configured page cap", () => {
    expect(() => parsePdfPageSelection("1-21")).toThrow(/最多处理 20 页/);
    expect(parsePdfPageSelection("1-20")).toHaveLength(20);
  });
});
