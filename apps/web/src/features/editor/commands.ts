import type { Editor } from "@tiptap/react";

/** ProseMirror step 的 JSON 形状，仅取动作描述所需字段。 */
export interface StepJson {
  stepType?: string;
  markType?: string;
  from?: number;
  to?: number;
  slice?: { content?: Array<{ type?: string }> };
}

const blockActionLabels: ReadonlyArray<[string, string]> = [
  ["replyGate", "回复可见"],
  ["pollRef", "投票"],
  ["richImage", "图片"],
  ["attachmentRef", "附件"],
  ["diceRoll", "骰子"],
  ["mention", "提及"],
  ["novelExcerpt", "小说摘录"],
  ["inlineCommentAnchor", "间贴锚点"],
  ["heading", "标题"],
  ["blockquote", "引用"],
  ["bulletList", "列表"],
  ["orderedList", "列表"],
  ["horizontalRule", "分隔线"],
];

/** 把最近一次 ProseMirror transform 的步骤描述成用户可读动作。 */
export function describeSteps(
  steps: readonly { toJSON(): StepJson }[],
): string {
  const actions: string[] = [];
  for (const step of steps) {
    const json = step.toJSON();
    if (json.stepType === "addMark") {
      actions.push(
        json.markType === "bold"
          ? "加粗"
          : json.markType === "italic"
            ? "斜体"
            : json.markType === "underline"
              ? "下划线"
              : json.markType === "strike"
                ? "删除线"
                : json.markType === "spoiler"
                  ? "黑幕"
                  : json.markType === "link"
                    ? "链接"
                    : json.markType === "textStyle"
                      ? "字体变化"
                      : "文字格式",
      );
    } else if (json.stepType === "removeMark") {
      actions.push("清除格式");
    } else if (
      json.stepType === "setNodeMarkup" ||
      json.stepType === "attr" ||
      json.stepType === "nodeAttr"
    ) {
      actions.push("修改属性");
    } else if (
      json.stepType === "replace" ||
      json.stepType === "replaceAround" ||
      json.stepType === "insert"
    ) {
      const types = new Set(
        (json.slice?.content ?? []).map((node) => node.type),
      );
      if (types.has("text")) actions.push("输入");
      if (types.has("hardBreak")) actions.push("换行");
      let matchedBlock = false;
      for (const [type, label] of blockActionLabels) {
        if (types.has(type)) {
          actions.push(label);
          matchedBlock = true;
        }
      }
      if (!matchedBlock && !types.has("text") && types.size === 0) {
        actions.push("删除");
      }
    } else {
      actions.push("编辑");
    }
  }
  const unique = [...new Set(actions)];
  return unique.length > 0 ? unique.join("、") : "编辑";
}

/** 把需要 Editor 的命令包装成稳定的按钮回调。 */
export function cmd(
  editor: Editor | null,
  action: (editor: Editor) => boolean,
): () => void {
  return () => {
    if (editor) action(editor);
  };
}

/** 返回当前 NodeSelection 选中的节点名，非节点选择时返回 undefined。 */
export function getSelectedNodeName(editor: Editor): string | undefined {
  const selection = editor.state.selection as {
    node?: { type?: { name?: string } };
  };
  return selection.node?.type?.name;
}

/** 原子节点按钮的激活判定：只认当前选中的节点本身。 */
export function isRichNodeActive(editor: Editor, nodeName: string): boolean {
  return getSelectedNodeName(editor) === nodeName;
}

/** 容器节点按钮的激活判定：光标在容器内时也视为激活，但选中子节点时不误亮。 */
export function isContainerNodeActive(
  editor: Editor,
  nodeName: string,
): boolean {
  const selectedNodeName = getSelectedNodeName(editor);
  return selectedNodeName
    ? selectedNodeName === nodeName
    : editor.isActive(nodeName);
}

/** 移除当前光标所在的最外层回复可见容器，保留其内部内容。 */
export function unwrapOutermostReplyGate(editor: Editor): boolean {
  const { selection } = editor.state;
  const { $from } = selection;
  for (let depth = 1; depth <= $from.depth; depth += 1) {
    const node = $from.node(depth);
    if (node.type.name !== "replyGate") continue;
    const from = $from.before(depth);
    const to = $from.after(depth);
    return editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        tr.replaceWith(from, to, node.content);
        dispatch?.(tr);
        return true;
      })
      .run();
  }

  const selectedNode = (
    selection as {
      node?: { type?: { name?: string }; content: unknown };
    }
  ).node;
  if (selectedNode?.type?.name === "replyGate") {
    return editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        tr.replaceWith(
          selection.from,
          selection.to,
          selectedNode.content as Parameters<typeof tr.replaceWith>[2],
        );
        dispatch?.(tr);
        return true;
      })
      .run();
  }
  return false;
}
