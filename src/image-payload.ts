export type SupportedImageExtension = "png" | "jpg" | "gif" | "webp";

export interface DetectedImageFormat {
  extension: SupportedImageExtension;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

/** Detect supported image data by file signature instead of trusting provider metadata. */
export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat {
  const startsWith = (...signature: number[]) =>
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

  if (
    bytes.length >= 24 &&
    startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  ) {
    const width = (bytes[16] * 0x1000000) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19];
    const height = (bytes[20] * 0x1000000) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23];
    if (width > 0 && height > 0) return { extension: "png", mimeType: "image/png" };
  }

  if (bytes.length >= 4 && startsWith(0xff, 0xd8, 0xff)) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }

  if (bytes.length >= 10 &&
      (startsWith(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || startsWith(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width > 0 && height > 0) return { extension: "gif", mimeType: "image/gif" };
  }

  if (bytes.length >= 16 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { extension: "webp", mimeType: "image/webp" };
  }

  throw new Error("图像服务返回的数据不是受支持的图片格式（PNG、JPEG、GIF 或 WebP）。");
}

/** Decode and validate a base64-encoded image response without relying on Node APIs. */
export function decodeBase64Image(value: string): { bytes: Uint8Array } & DetectedImageFormat {
  let binary: string;
  try {
    binary = atob(value.replace(/\s/g, ""));
  } catch {
    throw new Error("图像服务返回了无效的 base64 图片数据。");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, ...detectImageFormat(bytes) };
}
