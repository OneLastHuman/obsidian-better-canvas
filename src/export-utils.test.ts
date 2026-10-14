import { describe, expect, it } from "vitest";
import { scaleSvgIntrinsicDimensions } from "./export-utils";

describe("SVG intrinsic export scaling", () => {
  it("scales numeric dimensions without changing the viewBox", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="10" height="10"/></svg>';
    const result = scaleSvgIntrinsicDimensions(source, 2);

    expect(result).toContain('width="1280px"');
    expect(result).toContain('height="720px"');
    expect(result).toContain('viewBox="0 0 640 360"');
    expect(result).toContain("<rect");
  });

  it("uses viewBox dimensions when SVG width and height are percentages", () => {
    const source = '<svg width="100%" height="100%" viewBox="0 0 320 180"><path d="M0 0"/></svg>';
    const result = scaleSvgIntrinsicDimensions(source, 1.5);

    expect(result).toContain('width="480px"');
    expect(result).toContain('height="270px"');
  });

  it("leaves scale 1 exports byte-for-byte unchanged", () => {
    const source = '<svg width="100" height="50"></svg>';
    expect(scaleSvgIntrinsicDimensions(source, 1)).toBe(source);
  });

  it("rejects invalid SVG data and out-of-range scales", () => {
    expect(() => scaleSvgIntrinsicDimensions("<html/>", 2)).toThrow(/SVG root/);
    expect(() => scaleSvgIntrinsicDimensions("<svg/>", 0.5)).toThrow(/between 1x and 4x/);
    expect(() => scaleSvgIntrinsicDimensions("<svg/>", 5)).toThrow(/between 1x and 4x/);
  });
});
