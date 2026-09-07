import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark } from "@tiptap/pm/model";
import {
  AllSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@tiptap/pm/state";

type PainterMode = "off" | "once" | "continuous";
type PainterState = { mode: PainterMode; marks: readonly Mark[] };
const idle: PainterState = { mode: "off", marks: [] };
const copiedMarks = ["bold", "italic", "underline", "strike", "textStyle"];
const painterKey = new PluginKey<PainterState>("formatPainter");
const appliedMeta = "formatPainterApplied";

export function getFormatPainterState(editor: Editor): PainterState {
  return painterKey.getState(editor.state) ?? idle;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    formatPainter: {
      startFormatPainter: (mode?: "once" | "continuous") => ReturnType;
      stopFormatPainter: () => ReturnType;
      applyFormatPainter: () => ReturnType;
    };
  }
}

export const FormatPainter = Extension.create({
  name: "formatPainter",
  addCommands() {
    return {
      startFormatPainter:
        (mode = "once") =>
        ({ editor, tr, dispatch }) => {
          if (
            !editor.isEditable ||
            (!(tr.selection instanceof TextSelection) &&
              !(tr.selection instanceof AllSelection))
          )
            return false;
          const current = getFormatPainterState(editor);
          let marks =
            current.mode !== "off"
              ? current.marks
              : (tr.storedMarks ?? tr.selection.$from.marks());
          if (current.mode === "off" && !tr.selection.empty) {
            let found = false;
            tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node) => {
              if (found || !node.isText) return;
              marks = node.marks;
              found = true;
            });
            if (!found) return false;
          }
          if (tr.selection.empty && !tr.selection.$from.parent.inlineContent)
            return false;
          if (dispatch)
            tr.setMeta(painterKey, {
              mode,
              marks: marks.filter((mark) =>
                copiedMarks.includes(mark.type.name),
              ),
            });
          return true;
        },
      stopFormatPainter:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(painterKey, idle);
          return true;
        },
      applyFormatPainter:
        () =>
        ({ editor, tr, dispatch, chain }) => {
          const source = getFormatPainterState(editor);
          const selection = tr.selection;
          if (
            !editor.isEditable ||
            source.mode === "off" ||
            (!(selection instanceof TextSelection) &&
              !(selection instanceof AllSelection)) ||
            selection.empty
          )
            return false;
          const targets: {
            from: number;
            to: number;
            marks: readonly Mark[];
          }[] = [];
          tr.doc.nodesBetween(
            selection.from,
            selection.to,
            (node, pos, parent) => {
              if (!node.isText || !parent) return;
              const preserved = node.marks.filter(
                (mark) => !copiedMarks.includes(mark.type.name),
              );
              targets.push({
                from: Math.max(pos, selection.from),
                to: Math.min(pos + node.nodeSize, selection.to),
                marks: source.marks.filter(
                  (mark) =>
                    parent.type.allowsMarkType(mark.type) &&
                    !preserved.some(
                      (other) =>
                        other.type.excludes(mark.type) ||
                        mark.type.excludes(other.type),
                    ),
                ),
              });
            },
          );
          if (!targets.length) return false;
          if (dispatch) {
            closeHistory(tr);
            // The command chain shares this transaction, including every target range.
            const commands = chain();
            for (const target of targets) {
              commands.setTextSelection({ from: target.from, to: target.to });
              for (const name of copiedMarks) commands.unsetMark(name);
              for (const mark of target.marks)
                commands.setMark(mark.type.name, mark.attrs);
            }
            commands.run();
            tr.setSelection(selection.getBookmark().resolve(tr.doc));
            tr.setMeta(appliedMeta, true);
            if (source.mode === "once") tr.setMeta(painterKey, idle);
          }
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        if (getFormatPainterState(this.editor).mode === "off") return false;
        return this.editor.commands.stopFormatPainter();
      },
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    let pointerFrom: number | null = null;
    let pointerTo: number | null = null;
    let pointerActive = false;
    let keyboardSelecting = false;
    let applyTimer: ReturnType<typeof setTimeout> | undefined;
    return [
      new Plugin<PainterState>({
        key: painterKey,
        state: {
          init: () => idle,
          apply: (tr, value) =>
            tr.getMeta("hostContentReplace") ||
            tr.getMeta("preventUpdate") ||
            !editor.isEditable
              ? idle
              : (tr.getMeta(painterKey) ?? value),
        },
        appendTransaction: (transactions, _oldState, newState) =>
          transactions.some((tr) => tr.getMeta(appliedMeta))
            ? closeHistory(newState.tr).setMeta("addToHistory", false)
            : null,
        props: {
          attributes: (state) => ({
            "data-format-painter": painterKey.getState(state)?.mode ?? "off",
          }),
          handleDOMEvents: {
            pointerdown: (_view, event) => {
              keyboardSelecting = false;
              pointerActive =
                event.pointerType !== "touch" &&
                event.button === 0 &&
                getFormatPainterState(editor).mode !== "off";
              pointerFrom = editor.state.selection.from;
              pointerTo = editor.state.selection.to;
              return false;
            },
            pointercancel: () => {
              pointerActive = false;
              return false;
            },
            blur: () => {
              keyboardSelecting = false;
              return false;
            },
            keyup: (_view, event) => {
              if (
                event.shiftKey &&
                /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/u.test(
                  event.key,
                )
              ) {
                keyboardSelecting =
                  getFormatPainterState(editor).mode !== "off";
              }
              if (event.key === "Shift" && keyboardSelecting) {
                keyboardSelecting = false;
                editor.commands.applyFormatPainter();
              }
              return false;
            },
          },
        },
        view: (view) => {
          const pointerUp = (event: PointerEvent) => {
            if (!pointerActive || event.pointerType === "touch") return;
            pointerActive = false;
            clearTimeout(applyTimer);
            // Allow ProseMirror to finish syncing the browser selection first.
            applyTimer = setTimeout(() => {
              if (editor.isDestroyed || !editor.view.hasFocus()) return;
              const { from, to } = editor.state.selection;
              if (from !== pointerFrom || to !== pointerTo)
                editor.commands.applyFormatPainter();
            }, 0);
          };
          view.dom.ownerDocument.addEventListener("pointerup", pointerUp);
          return {
            update: () => {
              if (
                !editor.isEditable &&
                getFormatPainterState(editor).mode !== "off"
              ) {
                queueMicrotask(() => {
                  if (!editor.isDestroyed) editor.commands.stopFormatPainter();
                });
              }
            },
            destroy: () => {
              clearTimeout(applyTimer);
              view.dom.ownerDocument.removeEventListener(
                "pointerup",
                pointerUp,
              );
            },
          };
        },
      }),
    ];
  },
});
