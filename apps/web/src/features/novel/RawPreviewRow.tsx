import type { RowComponentProps } from "react-window";
import type { RowMeasure } from "./raw-row-measure";

export interface RawRowProps {
  measure: RowMeasure;
}

/** 单行渲染：章高亮、空洞删除线、章首/章尾标记与空洞标签。 */
export function RawPreviewRow({
  index,
  style,
  ariaAttributes,
  measure,
}: RowComponentProps<RawRowProps>) {
  // 渲染行时精确化测量（缓存命中为 O(1)），滚动过程逐行渐进精化。
  const layout = measure.ensureRowLayout(index);
  if (layout.height === 0 && layout.segments.length === 0) return null;
  return (
    <div style={style} {...ariaAttributes} className="px-2">
      {layout.segments.map((segment) => {
        const kindClass =
          segment.kind === "chapter"
            ? "bg-[#e9f6f1]"
            : segment.kind === "gap"
              ? "bg-[#fdf1f0] text-[#8f2b24] line-through decoration-[#e5a3a0]"
              : "bg-[#fbfcfc]";
        return (
          <div key={`${segment.start}-${segment.end}`}>
            {segment.gapLabel ? (
              <div className="my-[3px] inline-block rounded-[3px] bg-[#fbe3e1] px-1.5 py-px text-[10px] leading-[14px] font-semibold text-[#8f2b24]">
                {segment.gapLabel}
              </div>
            ) : null}
            {segment.markStart ? (
              <div
                className="my-[3px] rounded border-l-[3px] border-[#209065] bg-[#e2efec] px-1.5 py-[3px] text-[11px] leading-[16px] font-semibold text-[#176e66]"
                data-raw-anchor={`start-${segment.start}`}
              >
                {segment.markStart}
              </div>
            ) : null}
            <div
              className={`text-[13px] leading-[22px] whitespace-pre-wrap break-words text-[#1d2a33] ${kindClass}`}
            >
              {segment.text}
            </div>
            {segment.markEnd ? (
              <div
                className="my-[3px] rounded border-l-[3px] border-[#9aa4ad] bg-[#eef1f4] px-1.5 py-[3px] text-[11px] leading-[16px] font-semibold text-[#5b6670]"
                data-raw-anchor={`end-${segment.end}`}
              >
                {segment.markEnd}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
