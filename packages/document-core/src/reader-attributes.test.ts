import { describe, expect, it } from "vitest";
import { sanitizeDocument } from "./sanitize.js";

function attrs(raw: Record<string, unknown>) {
  return sanitizeDocument({ type: "doc", content: [{ type: "novelExcerpt", attrs: raw, content: [{ type: "paragraph" }] }] }).content?.[0]?.attrs;
}

describe("reader excerpt attributes", () => {
  it("provides backward-compatible display defaults", () => {
    expect(attrs({ variant: "fanqie" })).toMatchObject({ readerTime: "13:59", batteryLevel: 100, pageLabel: "16/843", progressLabel: "", headerLabel: "" });
  });
  it("preserves zero battery, custom labels, and explicitly empty text", () => {
    expect(attrs({ variant: "qidian", readerTime: "", batteryLevel: 0, pageLabel: "2/20", progressLabel: "1.0%", headerLabel: "Custom" })).toMatchObject({ readerTime: "", batteryLevel: 0, pageLabel: "2/20", progressLabel: "1.0%", headerLabel: "Custom" });
  });
  it.each([[110, 100], [-10, 0], [45.7, 46], [Number.NaN, 100], ["50", 100]])("bounds battery %s to %s", (input, expected) => {
    expect(attrs({ batteryLevel: input })?.batteryLevel).toBe(expected);
  });
  it("bounds display text lengths and rejects non-string text", () => {
    const result = attrs({ readerTime: "x".repeat(100), pageLabel: "x".repeat(100), progressLabel: "x".repeat(100), headerLabel: "x".repeat(100) });
    expect(result?.readerTime).toHaveLength(16);
    expect(result?.pageLabel).toHaveLength(40);
    expect(result?.progressLabel).toHaveLength(24);
    expect(result?.headerLabel).toHaveLength(80);
    expect(attrs({ readerTime: 123, headerLabel: {} })).toMatchObject({ readerTime: "13:59", headerLabel: "" });
  });
});
