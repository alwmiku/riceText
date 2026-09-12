/**
 * 为站点表情生成静态缩略图。
 *
 * 表情包的动图是 500×500、几十帧、单张 1.5 MB 上下。面板与候选浮层一次要显示
 * 十几个，直接渲染会造成明显的解码与内存开销，因此这里离线抽取 GIF 首帧
 * 并缩放到 48×48，作为 `/api/emoji/:id/image?frame=first` 的响应。
 *
 * 零依赖：自带 GIF（LZW + 全局调色板）解码与最小 PNG 编码。
 * 用法：`pnpm.cmd run emoji:thumbs`（幂等，可重跑覆盖）。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { CUSTOM_EMOJI_ENTRIES } from "@ricetext/contracts";

/** 缩略图边长（像素）。 */
const THUMBNAIL_SIZE = 48;

const sourceDirectory = join(import.meta.dirname, "..", "apps", "api", "src", "assets", "emoji");
const outputDirectory = join(sourceDirectory, "thumbs");

/** 调色板档位：低频颜色会先映射到未使用档位，避免越界。 */
const QUANTIZE_LEVELS = [0, 51, 102, 153, 204, 255];

/** LZW 解压后的索引缓冲与调色板。 */
interface GifFrame {
  width: number;
  height: number;
  indices: Uint8Array;
  palette: number[][];
}

/** 读取 GIF 的逻辑屏幕尺寸、全局调色板与首帧像素索引。 */
function decodeFirstFrame(buffer: Buffer): GifFrame {
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  const packed = buffer[10]!;
  let offset = 13;
  let palette: number[][] = [];
  if ((packed & 0x80) !== 0) {
    const size = 1 << ((packed & 0x07) + 1);
    palette = readPalette(buffer, offset, size);
    offset += size * 3;
  }
  // 首个图像描述符之前可能有扩展块，逐个跳过：
  // - 图形控制扩展 0x21 0xF9 <size> <data…> 0x00（固定长度块）
  // - 其它扩展 0x21 <label> [<应用/注释标识长度> <标识>] <子块链> 0x00
  let localPalette = palette;
  while (offset < buffer.length && buffer[offset] !== 0x2c) {
    if (buffer[offset] === 0x21) {
      const label = buffer[offset + 1];
      if (label === 0xf9) {
        // 0x21 0xF9 <size> <data…> 0x00：size 字节 + 数据 + 末尾终止字节。
        offset += 2 + buffer[offset + 2]! + 2;
        continue;
      }
      let cursor = offset + 2;
      // 应用扩展（0xFF）与注释扩展（0xFE）先有一个固定长度的标识块。
      if (label === 0xff || label === 0xfe) cursor += 1 + buffer[cursor]!;
      offset = readSubBlocks(buffer, cursor).next;
      continue;
    }
    if (buffer[offset] === 0x3b) throw new Error("GIF 里没有图像数据");
    throw new Error(`GIF 结构异常：在偏移 ${offset} 遇到未知块 0x${buffer[offset]!.toString(16)}`);
  }
  if (offset >= buffer.length) throw new Error("GIF 缺少图像描述符");
  // 图像描述符：0x2C、left(2)、top(2)、width(2)、height(2)、packed(1)。
  offset += 1;
  const frameWidth = buffer.readUInt16LE(offset + 4);
  const frameHeight = buffer.readUInt16LE(offset + 6);
  const framePacked = buffer[offset + 8]!;
  offset += 9;
  if ((framePacked & 0x80) !== 0) {
    const size = 1 << ((framePacked & 0x07) + 1);
    localPalette = readPalette(buffer, offset, size);
    offset += size * 3;
  }
  if (frameWidth !== width || frameHeight !== height) {
    throw new Error(
      `暂不支持带偏移的首帧（${frameWidth}×${frameHeight} 落在 ${width}×${height} 内）`,
    );
  }
  const lzwMinCodeSize = buffer[offset]!;
  offset += 1;
  const { bytes } = readSubBlocks(buffer, offset);
  return {
    width,
    height,
    indices: lzwDecode(bytes, lzwMinCodeSize, width * height),
    palette: localPalette.length > 0 ? localPalette : palette,
  };
}

function readPalette(buffer: Buffer, offset: number, entries: number): number[][] {
  const palette: number[][] = [];
  for (let index = 0; index < entries; index += 1) {
    palette.push([
      buffer[offset + index * 3]!,
      buffer[offset + index * 3 + 1]!,
      buffer[offset + index * 3 + 2]!,
    ]);
  }
  return palette;
}

/** 把 GIF 的子块序列拼成一个连续字节串，返回结束位置。 */
function readSubBlocks(buffer: Buffer, offset: number): { bytes: Buffer; next: number } {
  const parts: Buffer[] = [];
  let cursor = offset;
  while (cursor < buffer.length) {
    const size = buffer[cursor]!;
    cursor += 1;
    if (size === 0) break;
    parts.push(buffer.subarray(cursor, cursor + size));
    cursor += size;
  }
  return { bytes: Buffer.concat(parts), next: cursor };
}

/** GIF 的 LZW 解码。 */
function lzwDecode(bytes: Buffer, minCodeSize: number, pixelCount: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const output = new Uint8Array(pixelCount);
  let written = 0;
  let codeSize = minCodeSize + 1;
  let dictionary: number[][] = [];
  const resetDictionary = () => {
    dictionary = [];
    for (let index = 0; index < clearCode; index += 1) dictionary.push([index]);
    dictionary.push([], []);
    codeSize = minCodeSize + 1;
  };
  resetDictionary();

  let bitBuffer = 0;
  let bitCount = 0;
  let previous: number[] | null = null;
  for (let index = 0; index < bytes.length && written < pixelCount; index += 1) {
    bitBuffer |= bytes[index]! << bitCount;
    bitCount += 8;
    while (bitCount >= codeSize) {
      const code = bitBuffer & ((1 << codeSize) - 1);
      bitBuffer >>= codeSize;
      bitCount -= codeSize;
      if (code === clearCode) {
        resetDictionary();
        previous = null;
        continue;
      }
      if (code === endCode) return output;
      let entry = dictionary[code];
      if (!entry) {
        if (!previous) throw new Error("GIF LZW 数据损坏");
        entry = [...previous, previous[0]!];
      }
      for (const value of entry) {
        if (written >= pixelCount) break;
        output[written] = value;
        written += 1;
      }
      if (previous) {
        dictionary.push([...previous, entry[0]!]);
        // 字典增长到当前码长上限时提升码长（与 GIF 规范一致）。
        if (dictionary.length === 1 << codeSize && codeSize < 12) codeSize += 1;
      }
      previous = entry;
      if (written >= pixelCount) return output;
    }
  }
  return output;
}

/** 把任意 RGB 映射到 6×6×6 的固定档位，保持脚本零依赖。 */
function quantize(value: number): number {
  let best = QUANTIZE_LEVELS[0]!;
  for (const level of QUANTIZE_LEVELS) {
    if (Math.abs(level - value) < Math.abs(best - value)) best = level;
  }
  return best;
}

/** 直接采样缩放到目标尺寸，输出 RGBA。 */
function downscale(frame: GifFrame, size: number): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  const { width, height, indices, palette } = frame;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / size));
      const sourceY = Math.min(height - 1, Math.floor((y * height) / size));
      const [r = 0, g = 0, b = 0] = palette[indices[sourceY * width + sourceX]!] ?? [];
      const offset = (y * size + x) * 4;
      rgba[offset] = quantize(r);
      rgba[offset + 1] = quantize(g);
      rgba[offset + 2] = quantize(b);
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** 编码 8 位调色板 PNG（每个像素 1 字节索引）。 */
function encodeIndexedPng(size: number, pixels: Uint8Array, palette: number[][]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 1);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 位深
  header[9] = 3; // 色彩类型：索引
  // IHDR 的第一个字段是宽度，这里统一在下面写全。
  header.writeUInt32BE(size, 0);
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], index) => {
    plte[index * 3] = r!;
    plte[index * 3 + 1] = g!;
    plte[index * 3 + 2] = b!;
  });
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size + 1)] = 0;
    Buffer.from(pixels.subarray(y * size, (y + 1) * size)).copy(raw, y * (size + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 统计缩略图里出现过的颜色，生成稳定的调色板与索引图。 */
function buildIndexed(size: number, rgba: Buffer): { pixels: Uint8Array; palette: number[][] } {
  const palette: number[][] = [];
  const lookup = new Map<string, number>();
  const pixels = new Uint8Array(size * size);
  for (let index = 0; index < size * size; index += 1) {
    const key = `${rgba[index * 4]},${rgba[index * 4 + 1]},${rgba[index * 4 + 2]}`;
    let code = lookup.get(key);
    if (code === undefined) {
      code = palette.length;
      if (code >= 256) throw new Error("缩略图调色板超过 256 色");
      lookup.set(key, code);
      palette.push([rgba[index * 4]!, rgba[index * 4 + 1]!, rgba[index * 4 + 2]!]);
    }
    pixels[index] = code;
  }
  return { pixels, palette };
}

function main(): void {
  mkdirSync(outputDirectory, { recursive: true });
  const files = new Set(readdirSync(sourceDirectory));
  const written: string[] = [];
  for (const entry of CUSTOM_EMOJI_ENTRIES) {
    const assetFile = entry.assetFile;
    if (!assetFile) continue;
    if (!files.has(assetFile)) {
      throw new Error(`表情目录里的 ${entry.id} 指向的 ${assetFile} 不存在`);
    }
    if (!assetFile.toLowerCase().endsWith(".gif")) continue;
    const frame = decodeFirstFrame(readFileSync(join(sourceDirectory, assetFile)));
    const { pixels, palette } = buildIndexed(THUMBNAIL_SIZE, downscale(frame, THUMBNAIL_SIZE));
    writeFileSync(
      join(outputDirectory, `${entry.id}.png`),
      encodeIndexedPng(THUMBNAIL_SIZE, pixels, palette),
    );
    written.push(`${entry.id}.png`);
  }
  console.log(`已生成 ${written.length} 张 ${THUMBNAIL_SIZE}×${THUMBNAIL_SIZE} 表情缩略图：`);
  for (const file of written) console.log(`  - ${file}`);
}

main();
