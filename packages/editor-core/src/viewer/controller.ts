import { useCallback, useEffect, useState } from "react";

import type { RichTextViewerController, ViewerLightboxState } from "./types.js";

/**
 * 在不实例化 Tiptap 编辑器的情况下管理剧透展开与全屏图库状态。
 * 该控制器可与外层应用 UI 共享。
 */
export function useRichTextViewerController(
  imageCount: number,
): RichTextViewerController {
  const [lightbox, setLightbox] = useState<ViewerLightboxState>({
    index: null,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [revealedSpoilers, setRevealedSpoilers] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const reset = useCallback(
    (index: number | null) =>
      setLightbox({ index, zoom: 1, offsetX: 0, offsetY: 0 }),
    [],
  );
  const openImage = useCallback(
    (index: number) => {
      if (imageCount > 0) reset(Math.min(imageCount - 1, Math.max(0, index)));
    },
    [imageCount, reset],
  );
  const closeImage = useCallback(() => reset(null), [reset]);
  const previousImage = useCallback(
    () =>
      setLightbox((value) => ({
        index:
          value.index === null || imageCount === 0
            ? null
            : (value.index - 1 + imageCount) % imageCount,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      })),
    [imageCount],
  );
  const nextImage = useCallback(
    () =>
      setLightbox((value) => ({
        index:
          value.index === null || imageCount === 0
            ? null
            : (value.index + 1) % imageCount,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      })),
    [imageCount],
  );
  const changeZoom = useCallback(
    (delta: number) =>
      setLightbox((value) => ({
        ...value,
        zoom: Math.min(4, Math.max(0.5, value.zoom + delta)),
      })),
    [],
  );
  const resetTransform = useCallback(
    () =>
      setLightbox((value) => ({ ...value, zoom: 1, offsetX: 0, offsetY: 0 })),
    [],
  );
  const panBy = useCallback(
    (deltaX: number, deltaY: number) =>
      setLightbox((value) => ({
        ...value,
        offsetX: value.offsetX + deltaX,
        offsetY: value.offsetY + deltaY,
      })),
    [],
  );
  const toggleSpoiler = useCallback(
    (key: string) =>
      setRevealedSpoilers((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  useEffect(() => {
    if (lightbox.index !== null && lightbox.index >= imageCount)
      reset(imageCount > 0 ? imageCount - 1 : null);
  }, [imageCount, lightbox.index, reset]);
  return {
    lightbox,
    revealedSpoilers,
    openImage,
    closeImage,
    previousImage,
    nextImage,
    changeZoom,
    resetTransform,
    panBy,
    toggleSpoiler,
  };
}
