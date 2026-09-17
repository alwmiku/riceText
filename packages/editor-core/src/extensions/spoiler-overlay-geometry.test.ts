/*
 * 几何规则回归。这里盯的是两条不变式：
 * 1. 输出的圆角只会是 0 或 SPOILER_CORNER_RADIUS，不出现中间值；
 * 2. 局部高度差不足 2r 时归平，达到 2r 才出现完整的阴角与阳角。
 * 另外覆盖折行、真实间隙、重复测量和 RTL 视觉顺序等分组边界。
 */
import { describe, expect, it } from "vitest";

import {
  buildSpoilerOverlayPieces,
  SPOILER_CORNER_RADIUS,
  type CornerRadii,
  type SpoilerOverlayPiece,
  type SpoilerRect,
} from "./spoiler-overlay-geometry.js";

function rect(left: number, top: number, right: number, bottom: number): SpoilerRect {
  return { left, top, right, bottom };
}

function fills(pieces: SpoilerOverlayPiece[]): SpoilerOverlayPiece[] {
  return pieces.filter((piece) => piece.kind === "fill" && piece.id.includes(":rect-"));
}

function corners(piece: SpoilerOverlayPiece): number[] {
  return Object.values(piece.radii);
}

/** 断言所有方块的圆角都只有 0 或完整半径。 */
function expectBinaryRadii(pieces: SpoilerOverlayPiece[]): void {
  for (const piece of pieces) {
    for (const radius of Object.values(piece.radii)) {
      expect([0, SPOILER_CORNER_RADIUS]).toContain(radius);
    }
  }
}

function expectRadii(radii: CornerRadii, expected: Partial<CornerRadii>): void {
  expect(radii).toMatchObject(expected);
}

describe("spoiler overlay geometry", () => {
  it("merges equal-height adjacent fragments into one rounded pill", () => {
    const pieces = buildSpoilerOverlayPieces([
      rect(0, 0, 20, 20),
      rect(20, 0, 40, 20),
      rect(40, 0, 60, 20),
    ]);

    expect(pieces).toEqual([
      {
        id: "component-0:rect-0",
        kind: "fill",
        rect: rect(0, 0, 60, 20),
        radii: { topLeft: 3, topRight: 3, bottomRight: 3, bottomLeft: 3 },
      },
    ]);
  });

  // 上方差 10px（≥ 2r）保留完整台阶；下方差 4px（< 2r）归平，避免两个弧挤在一起。
  it("keeps a full top step but flattens a bottom delta smaller than 2r", () => {
    const pieces = buildSpoilerOverlayPieces([rect(0, 10, 20, 30), rect(20, 0, 50, 34)]);
    const main = fills(pieces);

    expect(main).toHaveLength(2);
    expect(main[0]!.rect).toEqual(rect(0, 10, 20, 34));
    expect(main[1]!.rect).toEqual(rect(20, 0, 50, 34));
    expectRadii(main[0]!.radii, { topLeft: 3, topRight: 0, bottomRight: 0, bottomLeft: 3 });
    expectRadii(main[1]!.radii, { topLeft: 3, topRight: 3, bottomRight: 3, bottomLeft: 0 });

    expect(pieces.some((piece) => piece.id.includes(":top-left:"))).toBe(true);
    expect(pieces.some((piece) => piece.id.includes(":bottom-"))).toBe(false);
    expectBinaryRadii(pieces);
  });

  // 恰好 2r 是临界值：两个圆角在中点相切，仍按完整圆角输出。
  it("keeps complete inner and outer corners when the local step is exactly 2r", () => {
    const pieces = buildSpoilerOverlayPieces([rect(0, 6, 20, 20), rect(20, 0, 50, 26)]);

    expect(fills(pieces)).toHaveLength(2);
    expect(pieces.filter((piece) => piece.kind === "cutout")).toHaveLength(2);
    expect(pieces.some((piece) => piece.id.includes(":top-left:"))).toBe(true);
    expect(pieces.some((piece) => piece.id.includes(":bottom-left:"))).toBe(true);
    expectBinaryRadii(pieces);
  });

  // 上下都放不下圆角时，整段合成一条等高黑带，而不是画缩水半径。
  it("flattens both sides of a micro-step instead of emitting small radii", () => {
    const pieces = buildSpoilerOverlayPieces([rect(0, 2, 20, 18), rect(20, 0, 40, 20)]);

    expect(pieces).toEqual([
      {
        id: "component-0:rect-0",
        kind: "fill",
        rect: rect(0, 0, 40, 20),
        radii: { topLeft: 3, topRight: 3, bottomRight: 3, bottomLeft: 3 },
      },
    ]);
  });

  // 相邻关系在归一化之前记录，因此 16→20→24px 这类链式微台阶会整体归平。
  it("normalizes chained small steps using the original adjacency graph", () => {
    const pieces = buildSpoilerOverlayPieces([
      rect(0, 10, 20, 30),
      rect(20, 6, 40, 32),
      rect(40, 2, 60, 34),
    ]);

    expect(pieces).toEqual([
      {
        id: "component-0:rect-0",
        kind: "fill",
        rect: rect(0, 2, 60, 34),
        radii: { topLeft: 3, topRight: 3, bottomRight: 3, bottomLeft: 3 },
      },
    ]);
  });

  it("keeps real horizontal gaps and wrapped rows as separate pills", () => {
    const pieces = buildSpoilerOverlayPieces([
      rect(0, 0, 20, 20),
      rect(24, 0, 44, 20),
      rect(0, 30, 30, 50),
    ]);

    const main = fills(pieces);
    expect(main).toHaveLength(3);
    expect(main.map((piece) => piece.rect)).toEqual([
      rect(0, 0, 20, 20),
      rect(24, 0, 44, 20),
      rect(0, 30, 30, 50),
    ]);
    expect(main.every((piece) => corners(piece).every((radius) => radius === 3))).toBe(true);
  });

  it("deduplicates rectangles and ignores invalid or zero-area values", () => {
    const pieces = buildSpoilerOverlayPieces([
      rect(0, 0, 20, 20),
      rect(0.1, 0.1, 20.1, 20.1),
      rect(10, 10, 10, 20),
      rect(Number.NaN, 0, 20, 20),
    ]);

    expect(fills(pieces)).toHaveLength(1);
  });

  // 输入顺序按文本流，可能与视觉左右次序相反；分组必须只依赖几何位置。
  it("sorts visual fragments geometrically so reversed RTL input still joins", () => {
    const pieces = buildSpoilerOverlayPieces([rect(20, 0, 40, 20), rect(0, 0, 20, 20)]);

    expect(fills(pieces)).toEqual([
      {
        id: "component-0:rect-0",
        kind: "fill",
        rect: rect(0, 0, 40, 20),
        radii: { topLeft: 3, topRight: 3, bottomRight: 3, bottomLeft: 3 },
      },
    ]);
  });

  // 只有几像素宽的片段放不下两个半径，宁可给直角，也不画两个半截弧。
  it("uses only full or flat corners for narrow fragments", () => {
    const pieces = buildSpoilerOverlayPieces([rect(0, 0, 4, 20)]);
    expectBinaryRadii(pieces);
    expect(fills(pieces)[0]!.radii).toEqual({
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    });
  });
});
