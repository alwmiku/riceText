import { Mark } from "@tiptap/core";

/** Tiptap mark for hover-to-reveal and tap-to-toggle spoiler text. */
export const Spoiler = Mark.create({
  name: "spoiler",
  inclusive: false,
  excludes: "bold italic textStyle",
  parseHTML() {
    return [{ tag: "span[data-spoiler]" }];
  },
  renderHTML() {
    return ["span", { class: "rt-spoiler", "data-spoiler": "true" }, 0];
  },
  addCommands() {
    return {
      setSpoiler:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleSpoiler:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetSpoiler:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
