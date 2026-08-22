import {
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

function clampWidth(value: number): number {
  return Math.min(100, Math.max(10, Math.round(value)));
}

/** 带拖拽手柄、可持久化宽度百分比的可编辑富图片视图。 */
export function RichImageView({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps) {
  const wrapperRef = useRef<HTMLElement | null>(null);
  const attrs = node.attrs as unknown as {
    src?: string;
    alt?: string;
    caption?: string;
    align?: string;
    width?: number;
  };
  const align =
    attrs.align === "left" || attrs.align === "right" ? attrs.align : "center";
  const width = clampWidth(typeof attrs.width === "number" ? attrs.width : 100);
  const src = typeof attrs.src === "string" ? attrs.src : "";
  const alt = typeof attrs.alt === "string" ? attrs.alt : "";
  const caption = typeof attrs.caption === "string" ? attrs.caption : "";
  const editable = editor.isEditable;

  const className = useMemo(
    () =>
      `rt-rich-image rt-rich-image--${align}${selected ? " rt-rich-image--selected" : ""}`,
    [align, selected],
  );

  const startResize = useCallback(
    (side: "left" | "right") =>
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        const wrapper = wrapperRef.current;
        const parent = wrapper?.parentElement;
        if (!wrapper || !parent || !editable) return;
        event.preventDefault();
        event.stopPropagation();

        const parentWidth =
          parent.getBoundingClientRect().width ||
          wrapper.getBoundingClientRect().width;
        const startX = event.clientX;
        const startWidth = width;
        const direction = side === "right" ? 1 : -1;
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = "ew-resize";

        const move = (moveEvent: globalThis.PointerEvent) => {
          moveEvent.preventDefault();
          const deltaPercent =
            ((moveEvent.clientX - startX) / parentWidth) * 100 * direction;
          updateAttributes({ width: clampWidth(startWidth + deltaPercent) });
        };
        const stop = () => {
          document.body.style.cursor = previousCursor;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
        window.addEventListener("pointercancel", stop, { once: true });
      },
    [editable, updateAttributes, width],
  );

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      as="figure"
      className={className}
      data-node-type="rich-image"
      data-align={align}
      data-width={String(width)}
      style={{ width: `${width}%` }}
      contentEditable={false}
    >
      <img src={src} alt={alt} draggable={false} />
      {caption ? <figcaption>{caption}</figcaption> : <figcaption />}
      {editable ? (
        <>
          <button
            type="button"
            className="rt-rich-image__resize rt-rich-image__resize--left"
            aria-label="Resize image from left edge"
            onPointerDown={startResize("left")}
          />
          <button
            type="button"
            className="rt-rich-image__resize rt-rich-image__resize--right"
            aria-label="Resize image from right edge"
            onPointerDown={startResize("right")}
          />
          <span className="rt-rich-image__size" aria-hidden="true">
            {width}%
          </span>
        </>
      ) : null}
    </NodeViewWrapper>
  );
}
