import { describe, expect, it } from "vitest";
import { canEmbedExportMedia, estimateDataUrlByteLength, scaleSvgIntrinsicDimensions } from "./export-utils";

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


describe("bounded media embedding for Canvas exports", () => {
  it("estimates bytes in Base64 and percent-encoded data URLs", () => {
    expect(estimateDataUrlByteLength("data:image/png;base64,AAAA")).toBe(3);
    expect(estimateDataUrlByteLength("data:image/png;base64,AA==")).toBe(1);
    expect(estimateDataUrlByteLength("data:text/plain,Hello%20world")).toBe(11);
  });

  it("returns zero for malformed data URLs", () => {
    expect(estimateDataUrlByteLength("no-comma")).toBe(0);
    expect(estimateDataUrlByteLength("data:image/png;base64,BAD!")).toBe(0);
    expect(estimateDataUrlByteLength("data:text/plain,%E0%A4%A")).toBe(0);
  });

  it("enforces per-item, cumulative and item-count budgets", () => {
    const limits = { perItemLimit: 4, totalLimit: 7, maxItems: 2 };
    expect(canEmbedExportMedia(4, 0, 0, limits)).toBe(true);
    expect(canEmbedExportMedia(5, 0, 0, limits)).toBe(false);
    expect(canEmbedExportMedia(4, 4, 1, limits)).toBe(false);
    expect(canEmbedExportMedia(1, 0, 2, limits)).toBe(false);
    expect(canEmbedExportMedia(0, 0, 0, limits)).toBe(false);
  });
});
