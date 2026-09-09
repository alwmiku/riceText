import { Extension, type Extendable } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * 扩展能力契约（单一权威来源）。
 *
 * 每种能力都在 {@link ExtensionCapabilities} 上占一个字段，扩展通过自己的
 * config 声明（例如 `Node.create({ ...spec, capabilities: { revision } })`），
 * 消费方按能力名读取，绝不按扩展名分支。{@link extensionCapabilities} 把声明
 * 注入对应的 ProseMirror 规格，因此 `additionalExtensions` 注册的第三方扩展
 * 无需修改任何共享代码即可参与。
 *
 * 新增一种能力：在 {@link ExtensionCapabilities} 追加字段，在本文件提供读取
 * 辅助函数，在消费方按字段读取；不要为具体节点名写分支。
 */

/** 修订面：正文（持久化为 text 节点的文本）或装饰（节点属性/视图派生文本）。 */
export type RevisionSurface = "prose" | "chrome";

/** 单个扩展对「哪些渲染区域可以修订」的声明。 */
export interface RevisionCapability {
  /** 该扩展渲染文本的默认修订面。 */
  surface: RevisionSurface;
  /** `surface` 为 prose 时的附加条件；元素不匹配即视为装饰（如未展开的黑幕）。 */
  proseWhen?: string;
  /**
   * 定位该扩展渲染元素的选择器。
   *
   * 节点无需提供：修订面装饰按 ProseMirror 节点逐个打点。
   * 标记必须提供：标记没有独立的节点 DOM，只能按自己渲染出的签名定位。
   */
  domSelector?: string;
}

/** 原子节点在纯文本剪贴板中的投影能力。 */
export interface TextProjectionCapability {
  /** 该节点贡献的纯文本；用于剪贴板序列化。 */
  leafText: (node: ProseMirrorNode) => string;
}

/** 扩展能力登记表。 */
export interface ExtensionCapabilities {
  /** 修订区域能力。 */
  revision?: RevisionCapability;
  /** 纯文本投影能力。 */
  text?: TextProjectionCapability;
}

/** 修订面标记属性，取值 `prose`、`chrome` 或 `when`。 */
export const REVISION_SURFACE_ATTRIBUTE = "data-rt-revise";
/** 条件修订面（属性值为 `when`）需要匹配的选择器。 */
export const REVISION_SURFACE_WHEN_ATTRIBUTE = "data-rt-revise-when";

/**
 * 声明一段渲染 DOM 是装饰：文本来自节点属性或视图装饰，不属于可修订正文。
 * 在扩展自己的 `renderHTML`/`NodeView` 里铺开即可，两条渲染路径共用同一份声明。
 */
export function chromeSurface(): Record<string, string> {
  return { [REVISION_SURFACE_ATTRIBUTE]: "chrome" };
}

/** 从 ProseMirror 规格读取扩展能力声明。 */
export function capabilitiesOfSpec(spec: unknown): ExtensionCapabilities | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  const capabilities = (spec as { capabilities?: unknown }).capabilities;
  if (!capabilities || typeof capabilities !== "object") return undefined;
  return capabilities as ExtensionCapabilities;
}

/** 从 ProseMirror 规格读取修订区域声明。 */
export function revisionCapabilityOfSpec(spec: unknown): RevisionCapability | undefined {
  return capabilitiesOfSpec(spec)?.revision;
}

/**
 * 有效修订面：显式声明优先。
 *
 * 未声明的原子节点其文本一定来自属性，默认按装饰处理；其余默认正文。
 */
export function effectiveRevisionSurface(spec: unknown, isAtom: boolean): RevisionSurface {
  return revisionCapabilityOfSpec(spec)?.surface ?? (isAtom ? "chrome" : "prose");
}

function injectedCapabilities(extension: Extendable): Record<string, unknown> {
  const { capabilities } = extension.config as { capabilities?: ExtensionCapabilities };
  return capabilities ? { capabilities } : {};
}

/**
 * 把扩展 config 上的能力声明注入对应的 ProseMirror 规格。
 *
 * Tiptap 的 schema 构建只按白名单复制已知字段，`extendNodeSchema`/
 * `extendMarkSchema` 是官方追加字段的入口；本扩展对每个节点与标记各调用一次，
 * 因此规范扩展与 `additionalExtensions` 注册的第三方扩展被同等对待。
 */
export const extensionCapabilities = Extension.create({
  name: "extensionCapabilities",
  extendNodeSchema(extension) {
    return injectedCapabilities(extension);
  },
  extendMarkSchema(extension) {
    return injectedCapabilities(extension);
  },
});

declare module "@tiptap/core" {
  interface ExtendableConfig {
    /** 该扩展声明的能力；见 {@link ExtensionCapabilities}。 */
    capabilities?: ExtensionCapabilities;
  }
}
