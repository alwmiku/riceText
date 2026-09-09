import {
  REVISION_SURFACE_ATTRIBUTE,
  REVISION_SURFACE_WHEN_ATTRIBUTE,
} from "@ricetext/document-core";

/** 查看器正文 DOM 的公开选择器；宿主与功能模块统一用它定位阅读器。 */
export const RICH_TEXT_VIEWER_CONTENT_SELECTOR = ".rt-viewer .tiptap.ProseMirror";

/**
 * 平台级装饰规则：任何交互控件或显式不可编辑区域都不是正文。
 *
 * 这是框架规则而非业务规则；每项都排除已声明修订面的元素，
 * 让扩展声明可以覆盖平台默认（如展开后的黑幕）。
 */
const PLATFORM_CHROME_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  '[contenteditable="false"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
]
  .map((selector) => `${selector}:not([${REVISION_SURFACE_ATTRIBUTE}])`)
  .join(",");

/** 一次可修订选区的解析结果。 */
export interface RevisionRegion {
  /** 选区文本（已 trim）。 */
  fromText: string;
  /** 选区起点所在的顶层块行号（1 起）；0 表示无法定位。 */
  lineNo: number;
  /** 该行完整文本，供服务端核对。 */
  lineText: string;
}

/**
 * 元素的**有效**修订面。
 *
 * 沿祖先链走到查看器根（不含根本身，避免命中 `contenteditable="false"`），
 * **最近的信号**决定结果：扩展声明的 `prose` 是正文、`chrome` 是装饰、
 * `when` 按被标记元素当前是否匹配条件决定；平台控件规则次之；默认正文。
 *
 * 「最近信号优先」让两类覆盖都成立：声明为正文的容器里的按钮仍是装饰，
 * 装饰容器里显式声明为正文的子区域仍是正文。
 */
export function isRevisionSurfaceProse(viewer: Element, node: Node): boolean {
  for (
    let element = startElement(node);
    element && element !== viewer;
    element = element.parentElement
  ) {
    const surface = element.getAttribute(REVISION_SURFACE_ATTRIBUTE);
    if (surface !== null) {
      if (surface !== "when") return surface === "prose";
      const when = element.getAttribute(REVISION_SURFACE_WHEN_ATTRIBUTE);
      return Boolean(when) && element.matches(when!);
    }
    if (element.matches(PLATFORM_CHROME_SELECTOR)) return false;
  }
  return true;
}

/**
 * 把浏览器选区解析为可提交的修订区域；任何落在装饰区域的选择都返回 null。
 *
 * 行号沿用「顶层块索引」，与章节行文本 (`chapterTextLines`) 的口径一致。
 */
export function resolveRevisionRegion(options: {
  viewer: Element;
  range: Range;
  lines: readonly string[];
}): RevisionRegion | null {
  const { viewer, range, lines } = options;
  if (!viewer.contains(range.commonAncestorContainer)) return null;
  if (
    !isRevisionSurfaceProse(viewer, range.startContainer) ||
    !isRevisionSurfaceProse(viewer, range.endContainer)
  )
    return null;
  const fromText = range.toString().trim();
  if (!fromText) return null;
  // 起点和终点在正文中，也可能跨过中间的投票、图片或间贴标记。
  for (const element of viewer.querySelectorAll(
    `[${REVISION_SURFACE_ATTRIBUTE}],${PLATFORM_CHROME_SELECTOR}`,
  )) {
    if (!range.intersectsNode(element)) continue;
    if (!isRevisionSurfaceProse(viewer, element)) return null;
  }
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const blocks = Array.from(viewer.children);
  const lineIndex = blocks.findIndex(
    (block) => block === startElement || (startElement ? block.contains(startElement) : false),
  );
  const lineNo = lineIndex >= 0 ? lineIndex + 1 : 0;
  return {
    fromText,
    lineNo,
    lineText: lineNo > 0 ? (lines[lineNo - 1] ?? "") : "",
  };
}

/** 取节点自身元素；文本节点取父元素。 */
function startElement(node: Node | null): Element | null {
  if (node === null) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}
