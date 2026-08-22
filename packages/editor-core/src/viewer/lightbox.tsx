import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useEffect, useRef } from "react";

import type { ViewerImage } from "../types.js";
import type {
  RichTextViewerController,
  RichTextViewerLabels,
} from "./types.js";

interface ImageLightboxProps {
  controller: RichTextViewerController;
  images: readonly ViewerImage[];
  labels: RichTextViewerLabels;
}

export function ImageLightbox({
  controller,
  images,
  labels,
}: ImageLightboxProps) {
  const drag = useRef<{ x: number; y: number } | null>(null);
  const index = controller.lightbox.index;
  const image = index === null ? undefined : images[index];
  useEffect(() => {
    if (!image) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") controller.closeImage();
      if (event.key === "ArrowLeft") controller.previousImage();
      if (event.key === "ArrowRight") controller.nextImage();
      if (event.key === "+" || event.key === "=") controller.changeZoom(0.25);
      if (event.key === "-") controller.changeZoom(-0.25);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [controller, image]);
  if (!image) return null;

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || controller.lightbox.zoom <= 1) return;
    controller.panBy(
      event.clientX - drag.current.x,
      event.clientY - drag.current.y,
    );
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const stopDrag = () => {
    drag.current = null;
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    controller.changeZoom(event.deltaY < 0 ? 0.25 : -0.25);
  };
  const transform = `translate(${controller.lightbox.offsetX}px, ${controller.lightbox.offsetY}px) scale(${controller.lightbox.zoom})`;
  return (
    <div
      className="rt-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || "Image viewer"}
    >
      <div
        className="rt-lightbox__stage"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onWheel={onWheel}
      >
        <img
          src={image.src}
          alt={image.alt}
          draggable={false}
          style={{ transform }}
        />
      </div>
      <div className="rt-lightbox__toolbar">
        <button
          type="button"
          title={labels.closeImage}
          aria-label={labels.closeImage}
          onClick={controller.closeImage}
        >
          ×
        </button>
        <button
          type="button"
          title={labels.previousImage}
          aria-label={labels.previousImage}
          onClick={controller.previousImage}
        >
          ‹
        </button>
        <span>
          {(index ?? 0) + 1} / {images.length}
        </span>
        <button
          type="button"
          title={labels.nextImage}
          aria-label={labels.nextImage}
          onClick={controller.nextImage}
        >
          ›
        </button>
        <button
          type="button"
          title={labels.zoomOut}
          aria-label={labels.zoomOut}
          onClick={() => controller.changeZoom(-0.25)}
        >
          −
        </button>
        <button
          type="button"
          title={labels.resetZoom}
          aria-label={labels.resetZoom}
          onClick={controller.resetTransform}
        >
          {Math.round(controller.lightbox.zoom * 100)}%
        </button>
        <button
          type="button"
          title={labels.zoomIn}
          aria-label={labels.zoomIn}
          onClick={() => controller.changeZoom(0.25)}
        >
          +
        </button>
      </div>
    </div>
  );
}
