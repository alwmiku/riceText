import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import {
  buildSpoilerOverlayPieces,
  type CornerRadii,
  type SpoilerOverlayPiece,
  type SpoilerRect,
} from "./spoiler-overlay-geometry.js";

/*
 * 黑幕的绘制层。
 *
 * 黑幕正文仍由真实 span 承担交互、选区与揭示状态，但黑底不在 span 上画：混合字号会把
 * 行内盒切成高低不同的片段，在行内盒上做圆角、渐变或伪元素都会留下毛刺和错位。
 *
 * 这里改成 VS Code 选择区那样的「测量 + 独立覆盖层」：PluginView 读取每个内层 span 的
 * getClientRects()，交给 spoiler-overlay-geometry 算出方块，再用普通绝对定位元素的
 * border-radius 绘制。
 *
 * 覆盖层由 ProseMirror 的 Decoration.widget 挂在每个含黑幕的 textblock 内部，因此：
 * - 跟随 NodeView transform、分页、滚动与 overflow 裁切，不需要自己算这些偏移；
 * - 覆盖层位于同一个层叠上下文里、z-index 低于正文，读者仍能正常选中和点击黑幕；
 * - widget 不参与文档位置，不会改变任何持久化结构。
 */

export const spoilerOverlayKey = new PluginKey<DecorationSet>("spoilerOverlay");

/** 承载覆盖层的 textblock 类名，提供 position: relative 作为定位基准。 */
const BLOCK_HOST_CLASS = "rt-spoiler-overlay-block-host";
const OVERLAY_CLASS = "rt-spoiler-overlay";
const PIECE_CLASS = "rt-spoiler-overlay__piece";
const FILL_CLASS = "rt-spoiler-overlay__piece--fill";
const CUTOUT_CLASS = "rt-spoiler-overlay__piece--cutout";
/** 向上找不到不透明背景时的兜底表面色；与 --rt-surface 的默认值一致。 */
const FALLBACK_SURFACE = "#ffffff";

/** 一个黑幕内层 span 的测量结果。 */
interface MeasuredSource {
  /** 该片段在文档中的位置区间，用于判断两个 span 是否连续。 */
  from: number;
  to: number;
  /** 所属 textblock 的内容起点，同时是覆盖层 widget 的定位位置。 */
  blockStart: number;
  rects: SpoilerRect[];
  /** 该片段下面的实际表面色，阴角裁切块要用它盖回背景。 */
  surfaceColor: string;
}

/** 一条逻辑黑带：若干连续的测量片段合并后的结果。 */
interface MeasuredRun {
  key: string;
  blockStart: number;
  rects: SpoilerRect[];
  surfaceColor: string;
}

/** 已经定位到某个 textblock 覆盖层内的待渲染方块。 */
interface RenderedPiece {
  id: string;
  blockStart: number;
  piece: SpoilerOverlayPiece;
  surfaceColor: string;
}

function domRect(value: DOMRect): SpoilerRect {
  return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
}

/** 解析 rgb()/rgba()/空格斜杠语法，取出 alpha；解析不出来时按不透明处理。 */
function alphaFromColor(color: string): number {
  if (color === "transparent") return 0;
  const match = color.match(/^rgba?\((.*)\)$/i);
  if (!match) return 1;
  const body = match[1]!.trim();
  if (body.includes("/")) {
    const alpha = Number.parseFloat(body.split("/").at(-1)!.trim());
    return Number.isFinite(alpha) ? alpha : 1;
  }
  const parts = body.split(",");
  if (parts.length < 4) return 1;
  const alpha = Number.parseFloat(parts[3]!.trim());
  return Number.isFinite(alpha) ? alpha : 1;
}

/**
 * 从内层 span 向外找第一个不透明背景色。
 *
 * 阴角必须用真实表面色去「裁」出缺口；正文可能落在白底编辑器、阅读页纸张色或回复区底色上，
 * 因此不能写死一种颜色。
 */
function nearestOpaqueSurface(element: HTMLElement, fallback: string): string {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const color = getComputedStyle(current).backgroundColor;
    if (alphaFromColor(color) >= 0.995) return color;
    current = current.parentElement;
  }
  return fallback;
}

/** 向上找到包含该位置的最内层 textblock，返回其内容起点。 */
function textblockStart(doc: ProseMirrorNode, position: number): number {
  const safe = Math.max(0, Math.min(position, doc.content.size));
  const resolved: ResolvedPos = doc.resolve(safe);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).isTextblock) return resolved.start(depth);
  }
  return resolved.start(0);
}

/**
 * 取内层 span 对应的文档位置区间。
 *
 * 位置取自外层 [data-spoiler] 元素：mark 的 DOM 是外层 span，内层只是测量锚点。
 * 视图尚未布局或节点已移除时 posAtDOM 会抛错，这里按「测不到」处理。
 */
function sourcePositions(
  view: EditorView,
  element: HTMLElement,
): { from: number; to: number } | null {
  const outer = element.closest<HTMLElement>('[data-spoiler="true"]');
  if (!outer) return null;
  try {
    const from = view.posAtDOM(outer, 0);
    const to = view.posAtDOM(outer, outer.childNodes.length);
    return { from: Math.min(from, to), to: Math.max(from, to) };
  } catch {
    return null;
  }
}

/**
 * 取片段的可见矩形。用 getClientRects() 而不是 bounding box：折行后每一行要各自成块，
 * bounding box 会把整个折行块当成一个大矩形。
 */
function sourceRects(element: HTMLElement): SpoilerRect[] {
  return Array.from(element.getClientRects(), (value) => domRect(value)).filter(
    (rect) => rect.right > rect.left && rect.bottom > rect.top,
  );
}

/**
 * 扫描正文里所有黑幕片段，合并成一条条逻辑黑带。
 *
 * 字号 mark 会把连续的黑幕拆成多个 span，但它们视觉上属于同一条带，必须一起做几何计算，
 * 否则接缝会被当成黑带边缘而画出多余的圆角。
 *
 * 遇到下面任一情况就断开：跨 textblock（位置不连续）、中间夹着未加黑幕的正文、
 * 或表面色不同（裁切块颜色不能混用）。
 */
function collectRuns(view: EditorView): MeasuredRun[] {
  const fallback =
    getComputedStyle(view.dom).getPropertyValue("--rt-surface").trim() || FALLBACK_SURFACE;
  const sources: MeasuredSource[] = [];

  view.dom.querySelectorAll<HTMLElement>(".rt-spoiler__ink").forEach((element) => {
    const positions = sourcePositions(view, element);
    const rects = sourceRects(element);
    if (!positions || rects.length === 0) return;
    sources.push({
      ...positions,
      blockStart: textblockStart(view.state.doc, positions.from),
      rects,
      surfaceColor: nearestOpaqueSurface(element, fallback),
    });
  });

  sources.sort((a, b) => a.blockStart - b.blockStart || a.from - b.from || a.to - b.to);
  const runs: MeasuredRun[] = [];
  let currentSources: MeasuredSource[] = [];

  const flush = () => {
    if (currentSources.length === 0) return;
    const first = currentSources[0]!;
    const last = currentSources.at(-1)!;
    runs.push({
      key: [first.blockStart, first.from, last.to, runs.length].join(":"),
      blockStart: first.blockStart,
      rects: currentSources.flatMap((source) => source.rects),
      surfaceColor: first.surfaceColor,
    });
    currentSources = [];
  };

  for (const source of sources) {
    const previous = currentSources.at(-1);
    if (
      previous &&
      (source.blockStart !== previous.blockStart ||
        source.from > previous.to ||
        source.surfaceColor !== previous.surfaceColor)
    ) {
      flush();
    }
    currentSources.push(source);
  }
  flush();
  return runs;
}

/** 该块内是否含有黑幕文字；只有需要的块才挂覆盖层。 */
function blockHasSpoiler(node: ProseMirrorNode): boolean {
  let found = false;
  node.descendants((child) => {
    if (child.marks.some((mark) => mark.type.name === "spoiler")) {
      found = true;
      return false;
    }
    return !found;
  });
  return found;
}

/**
 * 创建一个 textblock 内的覆盖层容器。
 *
 * contenteditable="false" 与 aria-hidden 让覆盖层对输入和读屏都不可见；
 * 它只用来承载绘制块，本身不接收指针事件（见 styles.css）。
 */
function overlayWidget(blockStart: number): HTMLElement {
  const overlay = document.createElement("span");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("contenteditable", "false");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-rt-spoiler-overlay", String(blockStart));
  return overlay;
}

/**
 * 为每个含黑幕的 textblock 生成装饰：一个标记类名，加一个覆盖层 widget。
 *
 * widget 放在块内容起点（blockStart）而不是块之前，这样它会留在块内部，随该块一起被
 * 分页 transform 与 overflow 裁切，移动端翻页时不会出现错位的黑带。
 */
function overlayDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    if (!blockHasSpoiler(node)) return false;
    const blockStart = position + 1;
    decorations.push(
      Decoration.node(position, position + node.nodeSize, {
        class: BLOCK_HOST_CLASS,
        "data-rt-spoiler-block": String(blockStart),
      }),
      Decoration.widget(blockStart, () => overlayWidget(blockStart), {
        key: "spoiler-overlay:" + blockStart,
        side: -1,
      }),
    );
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * 测量并计算本轮要画的所有方块。
 *
 * 容差取 1 个设备像素：浏览器返回的分数坐标在整数与半像素之间抖动，容差太小会把同一条
 * 边判成两条，太大会把真实空隙吃掉。
 */
function renderPieces(view: EditorView): RenderedPiece[] {
  const epsilon = Math.max(0.5, 1 / (window.devicePixelRatio || 1));
  const rendered: RenderedPiece[] = [];
  for (const run of collectRuns(view)) {
    const pieces = buildSpoilerOverlayPieces(run.rects, { epsilon });
    for (const piece of pieces) {
      rendered.push({
        id: run.key + ":" + piece.id,
        blockStart: run.blockStart,
        piece,
        surfaceColor: run.surfaceColor,
      });
    }
  }
  rendered.sort((a, b) => {
    if (a.blockStart !== b.blockStart) return a.blockStart - b.blockStart;
    if (a.piece.kind !== b.piece.kind) return a.piece.kind === "fill" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
  return rendered;
}

/** 圆角序列化：0 必须写成 "0" 而不是 "0px"，避免部分内核把它当成无效值。 */
function radius(value: number): string {
  return value === 0 ? "0" : value + "px";
}

function setRadii(element: HTMLElement, radii: CornerRadii): void {
  element.style.borderTopLeftRadius = radius(radii.topLeft);
  element.style.borderTopRightRadius = radius(radii.topRight);
  element.style.borderBottomRightRadius = radius(radii.bottomRight);
  element.style.borderBottomLeftRadius = radius(radii.bottomLeft);
}

/** rAF 包装：jsdom 等环境没有 requestAnimationFrame 时退回定时器。 */
function animationFrame(callback: FrameRequestCallback): number {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

/**
 * 该变动是否发生在我们自己生成的覆盖层里。
 *
 * 覆盖层位于正文子树内，写入绘制块同样会触发 MutationObserver；不过滤就会形成
 * 「渲染 → 触发观察器 → 再渲染」的自激循环。
 */
function mutationInsideOverlay(mutation: MutationRecord): boolean {
  const element =
    mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  return element?.closest(".rt-spoiler-overlay") !== null;
}

/**
 * 覆盖层的 PluginView：负责测量、计算与 DOM 复用。
 *
 * 生命周期约定：
 * - 所有触发源都收敛到 schedule()，一帧只渲染一次，避免读布局与写样式交错导致的反复重排；
 * - render() 是唯一写 DOM 的地方，且先读完所有块的定位矩形再写，减少强制同步布局；
 * - destroy() 必须能安全重复调用，观察器、监听器、未执行的帧和绘制块都要清干净。
 */
export class SpoilerOverlayView {
  private view: EditorView;
  /** 按稳定 id 复用绘制块，避免每帧重建节点引起闪烁。 */
  private readonly elements = new Map<string, HTMLSpanElement>();
  private readonly mutationObserver: MutationObserver | null;
  private readonly resizeObserver: ResizeObserver | null;
  private readonly resizedElements = new Set<Element>();
  private frame = 0;
  private destroyed = false;
  private composing = false;

  /** 合并同一帧内的多次更新；输入法组合期间不重排，避免打断候选词定位。 */
  private readonly schedule = () => {
    if (this.destroyed || this.composing || this.frame) return;
    this.frame = animationFrame(() => {
      this.frame = 0;
      this.render();
    });
  };

  /** 正文结构或受控属性变化时重算；只涉及覆盖层自身的变动直接忽略。 */
  private readonly onMutations = (mutations: MutationRecord[]) => {
    if (mutations.every(mutationInsideOverlay)) return;
    this.schedule();
  };

  private readonly onCompositionStart = () => {
    this.composing = true;
  };

  private readonly onCompositionEnd = () => {
    this.composing = false;
    this.schedule();
  };

  constructor(view: EditorView) {
    this.view = view;
    this.mutationObserver =
      typeof MutationObserver === "function" ? new MutationObserver(this.onMutations) : null;
    this.resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(this.schedule) : null;

    this.mutationObserver?.observe(this.view.dom, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-page-index", "data-paginated"],
    });
    this.addListeners();
    this.schedule();
    void document.fonts?.ready.then(this.schedule);
  }

  /**
   * 只在文档内容变化时重算。选区、光标这类装饰无关的 transaction 很频繁，
   * 每次都重排会明显拖慢输入。
   */
  update(view: EditorView, previousState: EditorView["state"]): void {
    this.view = view;
    if (view.state.doc !== previousState.doc) this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelFrame(this.frame);
    this.frame = 0;
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.resizedElements.clear();
    this.removeListeners();
    for (const element of this.elements.values()) element.remove();
    this.elements.clear();
  }

  /**
   * 同步需要观察尺寸的元素集合。
   *
   * 这里必须做差集：ResizeObserver.observe() 对已观察元素重复调用会重新投递一次初始回调，
   * 每次都全量重挂就会变成永久渲染循环。
   */
  private syncResizeObservation(elements: readonly Element[]): void {
    if (!this.resizeObserver) return;
    const desired = new Set<Element>([this.view.dom, ...elements]);
    for (const element of this.resizedElements) {
      if (desired.has(element)) continue;
      this.resizeObserver.unobserve(element);
      this.resizedElements.delete(element);
    }
    for (const element of desired) {
      if (this.resizedElements.has(element)) continue;
      this.resizeObserver.observe(element);
      this.resizedElements.add(element);
    }
  }

  /**
   * 监听所有会改变排版的来源：图片加载、输入法组合、窗口与视口尺寸、打印前后、字体就绪。
   * load 用捕获阶段是因为 img 的 load 不冒泡。
   */
  private addListeners(): void {
    this.view.dom.addEventListener("load", this.schedule, true);
    this.view.dom.addEventListener("compositionstart", this.onCompositionStart);
    this.view.dom.addEventListener("compositionend", this.onCompositionEnd);
    window.addEventListener("resize", this.schedule);
    window.addEventListener("beforeprint", this.schedule);
    window.addEventListener("afterprint", this.schedule);
    window.visualViewport?.addEventListener("resize", this.schedule);
    document.fonts?.addEventListener("loadingdone", this.schedule);
  }

  private removeListeners(): void {
    this.view.dom.removeEventListener("load", this.schedule, true);
    this.view.dom.removeEventListener("compositionstart", this.onCompositionStart);
    this.view.dom.removeEventListener("compositionend", this.onCompositionEnd);
    window.removeEventListener("resize", this.schedule);
    window.removeEventListener("beforeprint", this.schedule);
    window.removeEventListener("afterprint", this.schedule);
    window.visualViewport?.removeEventListener("resize", this.schedule);
    document.fonts?.removeEventListener("loadingdone", this.schedule);
  }

  /**
   * 重绘覆盖层。
   *
   * 顺序固定为：先收集本帧所有覆盖层与所属块的定位矩形（一次读完），再做几何计算，
   * 最后写样式；否则每个绘制块都触发一次强制同步布局。
   * 渲染结束把本帧未出现的绘制块删掉，编辑、撤销或改变字号后不会残留旧黑带。
   */
  private render(): void {
    if (this.destroyed) return;
    const overlays = new Map<number, HTMLElement>();
    this.view.dom.querySelectorAll<HTMLElement>("[data-rt-spoiler-overlay]").forEach((element) => {
      const blockStart = Number.parseInt(element.dataset.rtSpoilerOverlay ?? "", 10);
      if (Number.isFinite(blockStart)) overlays.set(blockStart, element);
    });
    const targets = new Map<
      number,
      {
        overlay: HTMLElement;
        block: HTMLElement;
        rect: DOMRect;
        clientLeft: number;
        clientTop: number;
      }
    >();
    for (const [blockStart, overlay] of overlays) {
      const block = overlay.parentElement;
      if (!block) continue;
      targets.set(blockStart, {
        overlay,
        block,
        rect: block.getBoundingClientRect(),
        clientLeft: block.clientLeft,
        clientTop: block.clientTop,
      });
    }
    this.syncResizeObservation(Array.from(targets.values(), (target) => target.block));

    const active = new Set<string>();
    for (const item of renderPieces(this.view)) {
      const target = targets.get(item.blockStart);
      if (!target) continue;
      const { id, piece } = item;
      active.add(id);
      let element = this.elements.get(id);
      if (!element) {
        element = document.createElement("span");
        element.setAttribute("data-rt-spoiler-piece", piece.kind);
        this.elements.set(id, element);
      }
      element.className = PIECE_CLASS + " " + (piece.kind === "fill" ? FILL_CLASS : CUTOUT_CLASS);
      const rect = piece.rect;
      element.style.left = rect.left - target.rect.left - target.clientLeft + "px";
      element.style.top = rect.top - target.rect.top - target.clientTop + "px";
      element.style.width = rect.right - rect.left + "px";
      element.style.height = rect.bottom - rect.top + "px";
      element.style.background =
        piece.kind === "fill" ? "var(--rt-spoiler-ink, #171a19)" : item.surfaceColor;
      setRadii(element, piece.radii);
      target.overlay.appendChild(element);
    }

    for (const [id, element] of this.elements) {
      if (active.has(id)) continue;
      element.remove();
      this.elements.delete(id);
    }
  }
}

/**
 * schema-neutral 的黑幕覆盖层扩展：不新增节点或 mark，也不改变文档结构，
 * 因此编辑器与只读查看器共用同一份实现。
 */
export const SpoilerOverlay = Extension.create({
  name: "spoilerOverlay",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: spoilerOverlayKey,
        state: {
          init: (_, state) => overlayDecorations(state.doc),
          apply: (transaction, decorations) =>
            transaction.docChanged ? overlayDecorations(transaction.doc) : decorations,
        },
        props: {
          decorations: (state) => spoilerOverlayKey.getState(state) ?? null,
        },
        view: (view) => new SpoilerOverlayView(view),
      }),
    ];
  },
});
