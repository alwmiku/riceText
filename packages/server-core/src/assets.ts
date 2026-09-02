export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** 只按文件魔数识别图片，不能信任客户端提交的 MIME 元数据。 */
export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((value, index) => bytes[index] === value)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionForImage(mime: ImageMime): string {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  }[mime];
}

export function sanitizeOriginalName(fileName: string, fallback: string): string {
  const baseName = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return (
    Array.from(baseName, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? "_" : character;
    })
      .join("")
      .slice(0, 255) || fallback
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", source.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
