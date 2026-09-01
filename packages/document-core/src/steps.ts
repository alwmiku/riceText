import type { Schema } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { ApplyStepsError } from "./errors.js";

/** ProseMirror transaction step 的最小 JSON 形状（与 contracts 一致）。 */
export interface StepJson {
  stepType: string;
  from?: number;
  to?: number;
  slice?: unknown;
  markType?: string;
  attrs?: unknown;
  start?: number;
  end?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从 JSON 恢复 ProseMirror Step；结构非法时抛出 {@link ApplyStepsError}。 */
export function stepFromJson(schema: Schema, json: unknown): Step {
  if (!isRecord(json) || typeof json.stepType !== "string") {
    throw new ApplyStepsError("INVALID_STEP", "步骤必须是带 stepType 的 JSON 对象");
  }
  let step: Step;
  try {
    step = Step.fromJSON(schema, json);
  } catch (error) {
    throw new ApplyStepsError(
      "INVALID_STEP",
      `无法解析步骤 ${json.stepType}: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
  return step;
}

const markLabels: Readonly<Record<string, string>> = {
  bold: "加粗",
  italic: "斜体",
  underline: "下划线",
  strike: "删除线",
  spoiler: "黑幕",
  link: "链接",
  textStyle: "字体样式",
};

const nodeLabels: Readonly<Record<string, string>> = {
  paragraph: "段落",
  heading: "标题",
  blockquote: "引用",
  bulletList: "无序列表",
  orderedList: "有序列表",
  codeBlock: "代码块",
  horizontalRule: "分隔线",
  replyGate: "回复可见",
  pollRef: "投票",
  richImage: "图片",
  attachmentRef: "附件",
  diceRoll: "骰子",
  mention: "提及",
  novelExcerpt: "小说摘录",
  inlineCommentAnchor: "间贴锚点",
  longTextBlock: "长文本章节",
};

/** 把 steps JSON 描述为人类可读动作，供历史溯源与审计展示。 */
export function describeStepsJson(steps: readonly StepJson[]): string {
  const actions: string[] = [];
  for (const step of steps) {
    if (step.stepType === "addMark") {
      actions.push(markLabels[String(step.markType ?? "")] ?? "文字格式");
    } else if (step.stepType === "removeMark") {
      actions.push("清除格式");
    } else if (step.stepType === "replace") {
      const slice = isRecord(step.slice)
        ? (step.slice as { content?: unknown })
        : undefined;
      const types = new Set<string>();
      if (Array.isArray(slice?.content)) {
        for (const node of slice.content) {
          if (isRecord(node) && typeof node.type === "string") types.add(node.type);
        }
      }
      const inserted = step.from !== undefined && step.from === step.to;
      if (types.has("text")) {
        actions.push(inserted ? "插入文字" : "修改文字");
      } else if (types.size > 0) {
        const labels = [...types].map((type) => nodeLabels[type] ?? type);
        actions.push(
          `${inserted ? "插入" : "替换"}${labels.length > 2 ? "多个内容块" : labels.join("、")}`,
        );
      } else if (inserted) {
        actions.push("插入内容");
      } else {
        actions.push("删除内容");
      }
    } else if (step.stepType === "setNodeMarkup" || step.stepType === "attr") {
      actions.push("修改属性");
    } else {
      actions.push("编辑");
    }
  }
  const unique = [...new Set(actions)];
  return unique.length > 0 ? unique.join("、") : "编辑";
}
