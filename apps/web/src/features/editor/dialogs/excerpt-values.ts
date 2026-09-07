import type { JSONContent } from "@ricetext/editor-core";
import { currentReaderTime } from "@ricetext/document-core";

export interface ExcerptValues {
  bookTitle: string;
  chapterTitle: string;
  author: string;
  sourceUrl: string;
  variant: string;
  text: string;
  readerTime: string;
  batteryLevel: string;
  pageLabel: string;
  progressLabel: string;
  headerLabel: string;
}

export const emptyExcerptValues: ExcerptValues = {
  bookTitle: "", chapterTitle: "", author: "", sourceUrl: "", variant: "fanqie", text: "",
  readerTime: "", batteryLevel: "100", pageLabel: "1/1", progressLabel: "", headerLabel: "",
};

export function createExcerptValues(): ExcerptValues {
  return { ...emptyExcerptValues, readerTime: currentReaderTime() };
}

export function readerDisplayDefaults(variant: string) {
  return variant === "qidian"
    ? { batteryLevel: "75", headerLabel: "" }
    : { batteryLevel: "100", headerLabel: "" };
}

export function isExcerptBatteryValid(value: string): boolean {
  const amount = Number(value);
  return value.trim() !== "" && Number.isInteger(amount) && amount >= 0 && amount <= 100;
}

export function isExcerptSourceUrlValid(value: string): boolean {
  if (!value.trim()) return true;
  const hasControlCharacter = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (value.trim().length > 2048 || hasControlCharacter) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function excerptAttributes(values: ExcerptValues) {
  return {
    bookTitle: values.bookTitle.trim(),
    chapterTitle: values.chapterTitle.trim(),
    author: values.author.trim(),
    sourceUrl: values.sourceUrl.trim() || null,
    variant: values.variant,
    readerTime: values.readerTime.trim(),
    batteryLevel: isExcerptBatteryValid(values.batteryLevel) ? Number(values.batteryLevel) : 100,
    pageLabel: values.pageLabel.trim(),
    progressLabel: values.progressLabel.trim(),
    headerLabel: values.headerLabel.trim(),
  };
}

export function excerptParagraphs(text: string): JSONContent[] {
  return text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim().length > 0).map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
}
