import { createId } from "../utils";
import type { UploadedAsset } from "../types";
import {
  ApiError,
  api,
  isApiClientError,
  resolveApiUrl,
  rethrowClientError,
} from "./client";

export async function uploadAsset(file: File): Promise<UploadedAsset> {
  try {
    const asset = await api().uploadAsset(file);
    return {
      assetId: asset.assetId,
      url: resolveApiUrl(asset.url) ?? asset.url,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
    };
  } catch (error) {
    if (isApiClientError(error)) rethrowClientError(error);
    if (file.size > 8 * 1024 * 1024)
      throw new ApiError("上传限制为 8 MB", 422);
    return {
      assetId: createId("asset"),
      url: URL.createObjectURL(file),
      name: file.name,
      mimeType: file.type,
      size: file.size,
    };
  }
}
