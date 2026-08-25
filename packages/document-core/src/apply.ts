import type { JSONContent } from "@tiptap/core";
import { Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { ApplyStepsError } from "./errors.js";
import { stepFromJson, type StepJson } from "./steps.js";

/** 把 Tiptap JSON 文档解析为 ProseMirror 节点（服务端运行时入口）。 */
export function parseDocument(
  schema: Schema,
  json: JSONContent,
): ProseMirrorNode {
  try {
    return ProseMirrorNode.fromJSON(schema, json);
  } catch (error) {
    throw new ApplyStepsError(
      "INVALID_STEP",
      `文档无法解析: ${error instanceof Error ? error.message : "未知错误"}`,
    );
  }
}

/**
 * 在服务端完整运行 ProseMirror：把 steps 依序应用到文档并返回新文档 JSON。
 * 任意步骤解析失败或无法应用到当前文档时抛出 {@link ApplyStepsError}，
 * 且不修改调用方的输入文档。
 */
export function applyStepsToDocument(
  schema: Schema,
  docJson: JSONContent,
  stepsJson: readonly StepJson[],
): JSONContent {
  let doc = parseDocument(schema, docJson);
  for (const raw of stepsJson) {
    const step = stepFromJson(schema, raw);
    let result;
    try {
      result = step.apply(doc);
    } catch (error) {
      throw new ApplyStepsError(
        "STEP_APPLY_FAILED",
        `步骤 ${step.toJSON().stepType} 应用失败: ${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
    if (!result.doc) {
      throw new ApplyStepsError(
        "STEP_APPLY_FAILED",
        `步骤 ${step.toJSON().stepType} 无法应用到当前文档: ${result.failed ?? "位置越界或结构不合法"}`,
      );
    }
    doc = result.doc;
  }
  return doc.toJSON();
}

/** 校验 steps 能够应用到给定文档；成功返回 null，失败返回分类错误信息。 */
export function validateSteps(
  schema: Schema,
  docJson: JSONContent,
  stepsJson: readonly StepJson[],
): { code: "INVALID_STEP" | "STEP_APPLY_FAILED"; message: string } | null {
  try {
    applyStepsToDocument(schema, docJson, stepsJson);
    return null;
  } catch (error) {
    if (error instanceof ApplyStepsError) {
      return { code: error.code, message: error.message };
    }
    return { code: "INVALID_STEP", message: "步骤校验失败" };
  }
}
