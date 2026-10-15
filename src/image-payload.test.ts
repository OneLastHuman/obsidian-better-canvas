import { describe, expect, it } from "vitest";
import { decodeBase64Image, detectImageFormat } from "./image-payload";

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
]);

describe("image payload validation", () => {
  it("recognizes PNG, JPEG, GIF and WebP signatures", () => {
    expect(detectImageFormat(png)).toEqual({ extension: "png", mimeType: "image/png" });
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])))
      .toEqual({ extension: "jpg", mimeType: "image/jpeg" });
    expect(detectImageFormat(new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00
    ])).extension).toBe("gif");
    expect(detectImageFormat(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20
    ])).extension).toBe("webp");
  });

  it("rejects non-image content and malformed base64", () => {
    expect(() => decodeBase64Image("dGhpcy1pcy1ub3QtYS1wbmc="))
      .toThrow(/不是受支持的图片格式/);
    expect(() => decodeBase64Image("%%%invalid%%"))
      .toThrow(/无效的 base64/);
  });

  it("checks PNG dimensions and header rather than just the first four bytes", () => {
    expect(() => detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47])))
      .toThrow(/不是受支持的图片格式/);
    expect(() => detectImageFormat(new Uint8Array([
      ...png.slice(0, 16), 0, 0, 0, 0, 0, 0, 0, 0
    ]))).toThrow(/不是受支持的图片格式/);
  });
});
