/*
 * 黑幕轮廓的纯几何计算：输入同一段黑幕的可见矩形，输出覆盖层要画的方块。
 *
 * 这里的规则参考 VS Code 选择区渲染器：先测量真实片段，把每个角分类成外角、内角或平边，
 * 再交给普通块元素用 border-radius 绘制，而不是在行内盒上拼渐变或伪元素。
 *
 * 两条必须守住的不变式：
 * 1. 输出圆角只有「完整半径」和「0（平边）」两种取值，不出现中间值，避免同一段黑幕里
 *    出现好几种弧度，看起来像没对齐。
 * 2. 局部高度差不足两个半径时，不缩小半径，而是把该侧边缘归一成平边——否则相邻的凹角
 *    和凸角会挤在一起，形成毛刺。
 *
 * 本模块不访问 DOM：坐标一律使用调用方传入的视口坐标，换算成覆盖层内坐标是调用方的职责。
 */

/** 阳角与阴角共用的完整圆角半径。 */
export const SPOILER_CORNER_RADIUS = 3;

/** 一个可见片段：黑幕内层 span 的 getClientRects() 之一。 */
export interface SpoilerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 单个方块四角的圆角半径，取值只会是 0 或 SPOILER_CORNER_RADIUS。 */
export interface CornerRadii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/**
 * 覆盖层绘制单元。
 *
 * - fill：直接画黑带的方块；
 * - cutout：用当前表面色画一个「只缺一个圆角」的方块，盖在 fill 上，缺口处就露出黑色，
 *   从而得到向内凹的阴角。所有弧线都是普通 border-radius，不依赖实验性 CSS。
 */
export interface SpoilerOverlayPiece {
  id: string;
  kind: "fill" | "cutout";
  rect: SpoilerRect;
  radii: CornerRadii;
}

export interface SpoilerGeometryOptions {
  /** 圆角半径，默认 SPOILER_CORNER_RADIUS。 */
  radius?: number;
  /** 分数像素比较容差，调用方通常传 max(0.5, 1 / devicePixelRatio)。 */
  epsilon?: number;
}

const ZERO_RADII: CornerRadii = {
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
};

function width(rect: SpoilerRect): number {
  return rect.right - rect.left;
}

function height(rect: SpoilerRect): number {
  return rect.bottom - rect.top;
}

function finiteRect(rect: SpoilerRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom)
  );
}

function near(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) <= epsilon;
}

function cloneRect(rect: SpoilerRect): SpoilerRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** 以 epsilon 为量化单位生成去重键，避免同一片段因分数坐标被当成两个。 */
function rectKey(rect: SpoilerRect, epsilon: number): string {
  const scale = 1 / Math.max(epsilon, 0.001);
  return [rect.left, rect.top, rect.right, rect.bottom]
    .map((value) => Math.round(value * scale))
    .join(":");
}

/**
 * 判断两个片段是否落在同一视觉行：高度重叠至少要占较矮片段的一半。
 *
 * 用「重叠比例」而不是「顶端相等」，是因为同一行的黑幕可能被字号 mark 切成不同高度的片段，
 * 它们的 top/bottom 本来就不相等。
 */
function verticallyCompatible(a: SpoilerRect, b: SpoilerRect, epsilon: number): boolean {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return overlap + epsilon >= Math.min(height(a), height(b)) / 2;
}

/** 水平相邻（间隙不超过容差）且在同一视觉行时，两个片段属于同一条黑带。 */
function horizontallyConnected(a: SpoilerRect, b: SpoilerRect, epsilon: number): boolean {
  const gap = Math.max(a.left - b.right, b.left - a.right, 0);
  return gap <= epsilon && verticallyCompatible(a, b, epsilon);
}

/**
 * 用深度优先把互相连通的片段聚成一条黑带。
 *
 * 真实的正文空隙（未加黑幕的空格、折行后的下一行）不会连通，因此各自成为独立组件，
 * 各自拥有完整的阳角。
 */
function connectedComponents(rects: SpoilerRect[], epsilon: number): SpoilerRect[][] {
  const seen = new Set<number>();
  const components: SpoilerRect[][] = [];

  for (let start = 0; start < rects.length; start += 1) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component: SpoilerRect[] = [];
    seen.add(start);

    while (stack.length > 0) {
      const index = stack.pop()!;
      const rect = rects[index]!;
      component.push(cloneRect(rect));
      for (let candidate = 0; candidate < rects.length; candidate += 1) {
        if (seen.has(candidate)) continue;
        if (!horizontallyConnected(rect, rects[candidate]!, epsilon)) continue;
        seen.add(candidate);
        stack.push(candidate);
      }
    }

    components.push(component);
  }

  return components;
}

/** 并查集：把连续多级微台阶串成一组，统一决定是否归平。 */
class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parent[index]!;
    if (parent === index) return index;
    const root = this.find(parent);
    this.parent[index] = root;
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

/** 合并左右紧邻且上下等高的片段，使等高段落显示为一条连续黑带。 */
function mergeSameHeight(rects: SpoilerRect[], epsilon: number): SpoilerRect[] {
  const sorted = rects
    .map(cloneRect)
    .sort((a, b) => a.left - b.left || a.top - b.top || a.bottom - b.bottom);
  const merged: SpoilerRect[] = [];

  for (const rect of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      rect.left <= previous.right + epsilon &&
      near(rect.top, previous.top, epsilon) &&
      near(rect.bottom, previous.bottom, epsilon)
    ) {
      previous.right = Math.max(previous.right, rect.right);
      continue;
    }
    merged.push(rect);
  }

  return merged;
}

/**
 * 把「不够画两个圆角」的微台阶归平成一条边，这是整套方案的核心规则。
 *
 * 一条竖直边上要同时容纳一个阴角和一个阳角，至少需要 2r 的高度差；不足 2r 时无论怎么
 * 分配半径都会互相挤压，出现毛刺。这里的处理不是缩小半径（那会让弧度与其它圆角不一致），
 * 而是把这一侧的边缘拉到同一个 top/bottom，该侧直接退化为平边。
 *
 * 归平按「原始相邻关系」分组：相邻判断在归一化之前完成，因此 16→20→24px 这类链式微台阶
 * 会被整体归平，不会因为中间一步变平而漏掉后面一步。
 */
function normalizeSmallSteps(rects: SpoilerRect[], radius: number, epsilon: number): SpoilerRect[] {
  const normalized = mergeSameHeight(rects, epsilon);
  if (normalized.length < 2) return normalized;

  const topGroups = new DisjointSet(normalized.length);
  const bottomGroups = new DisjointSet(normalized.length);
  const minimumRoundedStep = radius * 2;

  for (let index = 0; index + 1 < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[index + 1]!;
    if (Math.abs(current.right - next.left) > epsilon) continue;
    if (Math.abs(current.top - next.top) < minimumRoundedStep) {
      topGroups.union(index, index + 1);
    }
    if (Math.abs(current.bottom - next.bottom) < minimumRoundedStep) {
      bottomGroups.union(index, index + 1);
    }
  }

  const topTargets = new Map<number, number>();
  const bottomTargets = new Map<number, number>();
  for (let index = 0; index < normalized.length; index += 1) {
    const rect = normalized[index]!;
    const topRoot = topGroups.find(index);
    const bottomRoot = bottomGroups.find(index);
    topTargets.set(topRoot, Math.min(topTargets.get(topRoot) ?? rect.top, rect.top));
    bottomTargets.set(
      bottomRoot,
      Math.max(bottomTargets.get(bottomRoot) ?? rect.bottom, rect.bottom),
    );
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const rect = normalized[index]!;
    rect.top = topTargets.get(topGroups.find(index))!;
    rect.bottom = bottomTargets.get(bottomGroups.find(index))!;
  }

  const merged = mergeSameHeight(normalized, epsilon);
  for (let index = 0; index + 1 < merged.length; index += 1) {
    const current = merged[index]!;
    const next = merged[index + 1]!;
    if (Math.abs(current.right - next.left) > epsilon) continue;
    const boundary = (current.right + next.left) / 2;
    current.right = boundary;
    next.left = boundary;
  }
  return merged;
}

/**
 * 保证圆角只取 0 或完整半径，并把放不下的成对圆角直接清零。
 *
 * 边长小于两个半径时（例如只有一个字的窄片段），与其画两个半截弧，不如给直角。
 */
function fitBinaryRadii(rect: SpoilerRect, radii: CornerRadii, radius: number): CornerRadii {
  const fitted = { ...radii };
  const horizontal = width(rect);
  const vertical = height(rect);

  if (fitted.topLeft + fitted.topRight > horizontal) {
    fitted.topLeft = 0;
    fitted.topRight = 0;
  }
  if (fitted.bottomLeft + fitted.bottomRight > horizontal) {
    fitted.bottomLeft = 0;
    fitted.bottomRight = 0;
  }
  if (fitted.topLeft + fitted.bottomLeft > vertical) {
    fitted.topLeft = 0;
    fitted.bottomLeft = 0;
  }
  if (fitted.topRight + fitted.bottomRight > vertical) {
    fitted.topRight = 0;
    fitted.bottomRight = 0;
  }

  for (const key of Object.keys(fitted) as (keyof CornerRadii)[]) {
    if (fitted[key] !== 0) fitted[key] = radius;
  }
  return fitted;
}

function square(left: number, top: number, size: number): SpoilerRect {
  return { left, top, right: left + size, bottom: top + size };
}

/**
 * 追加一组阴角绘制块：先铺满黑色方块，再用「缺一个圆角」的表面色方块盖上去。
 *
 * 缺角朝黑带内侧，因此露出的黑色边缘是向内凹的弧，半径与阳角同为 radius。
 * 两个方块的 rect 完全一致，交给调用方按 fill 在前、cutout 在后排序。
 */
function addInnerCorner(
  pieces: SpoilerOverlayPiece[],
  id: string,
  rect: SpoilerRect,
  corner: keyof CornerRadii,
  radius: number,
): void {
  pieces.push({ id: id + ":fill", kind: "fill", rect, radii: { ...ZERO_RADII } });
  pieces.push({
    id: id + ":cutout",
    kind: "cutout",
    rect: cloneRect(rect),
    radii: { ...ZERO_RADII, [corner]: radius },
  });
}

/**
 * 把一条黑带（一个连通组件）转换成绘制块。
 *
 * 第一步：每个片段先定自己的阳角——只要某侧邻居没有比自己更靠外，那一侧就是接缝，
 * 圆角收直；最外侧才画圆角。
 * 第二步：在接缝两侧高度不同的地方补阴角，缺口方向由哪一边更高决定。
 */
function componentPieces(
  source: SpoilerRect[],
  componentIndex: number,
  radius: number,
  epsilon: number,
): SpoilerOverlayPiece[] {
  const rects = normalizeSmallSteps(source, radius, epsilon);
  const pieces: SpoilerOverlayPiece[] = [];

  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]!;
    const previous = rects[index - 1];
    const next = rects[index + 1];
    const radii: CornerRadii = {
      topLeft: !previous || rect.top < previous.top - epsilon ? radius : 0,
      bottomLeft: !previous || rect.bottom > previous.bottom + epsilon ? radius : 0,
      topRight: !next || rect.top < next.top - epsilon ? radius : 0,
      bottomRight: !next || rect.bottom > next.bottom + epsilon ? radius : 0,
    };
    pieces.push({
      id: "component-" + componentIndex + ":rect-" + index,
      kind: "fill",
      rect: cloneRect(rect),
      radii: fitBinaryRadii(rect, radii, radius),
    });
  }

  for (let index = 0; index + 1 < rects.length; index += 1) {
    const left = rects[index]!;
    const right = rects[index + 1]!;
    const boundary = (left.right + right.left) / 2;

    if (right.top < left.top - epsilon) {
      addInnerCorner(
        pieces,
        "component-" + componentIndex + ":joint-" + index + ":top-left",
        square(boundary - radius, left.top - radius, radius),
        "bottomRight",
        radius,
      );
    } else if (left.top < right.top - epsilon) {
      addInnerCorner(
        pieces,
        "component-" + componentIndex + ":joint-" + index + ":top-right",
        square(boundary, right.top - radius, radius),
        "bottomLeft",
        radius,
      );
    }

    if (right.bottom > left.bottom + epsilon) {
      addInnerCorner(
        pieces,
        "component-" + componentIndex + ":joint-" + index + ":bottom-left",
        square(boundary - radius, left.bottom, radius),
        "topRight",
        radius,
      );
    } else if (left.bottom > right.bottom + epsilon) {
      addInnerCorner(
        pieces,
        "component-" + componentIndex + ":joint-" + index + ":bottom-right",
        square(boundary, right.bottom, radius),
        "topLeft",
        radius,
      );
    }
  }

  return pieces;
}

/**
 * 几何计算入口：把测量到的片段转成覆盖层绘制块。
 *
 * 输出顺序在组件内是 fill 在前、cutout 在后；组件之间按视觉位置（先上后左）排序，
 * 保证多次渲染的 DOM 顺序稳定，不引起无谓的节点搬移。
 */
export function buildSpoilerOverlayPieces(
  input: readonly SpoilerRect[],
  options: SpoilerGeometryOptions = {},
): SpoilerOverlayPiece[] {
  const radius = options.radius ?? SPOILER_CORNER_RADIUS;
  const epsilon = options.epsilon ?? 0.5;
  if (!(radius > 0) || !(epsilon >= 0)) return [];

  const deduped: SpoilerRect[] = [];
  const keys = new Set<string>();
  for (const value of input) {
    const rect = cloneRect(value);
    if (!finiteRect(rect) || width(rect) <= 0 || height(rect) <= 0) continue;
    const key = rectKey(rect, epsilon);
    if (keys.has(key)) continue;
    keys.add(key);
    deduped.push(rect);
  }

  const components = connectedComponents(deduped, epsilon).sort((a, b) => {
    const aTop = Math.min(...a.map((rect) => rect.top));
    const bTop = Math.min(...b.map((rect) => rect.top));
    if (!near(aTop, bTop, epsilon)) return aTop - bTop;
    return Math.min(...a.map((rect) => rect.left)) - Math.min(...b.map((rect) => rect.left));
  });

  return components.flatMap((component, index) =>
    componentPieces(component, index, radius, epsilon),
  );
}
