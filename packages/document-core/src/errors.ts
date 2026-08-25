/** steps 解析或应用失败的可分类错误，服务端映射为 422。 */
export class ApplyStepsError extends Error {
  constructor(
    readonly code: "INVALID_STEP" | "STEP_APPLY_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ApplyStepsError";
  }
}
