/** 服务端统一错误：code 给前端分支判断，message 可直接展示，不包含凭据或供应商原始响应 */
export class AppError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "invalid_input"
      | "forbidden"
      | "rate_limited"
      | "busy"
      | "unsafe_input"
      | "upstream"
      | "ai_invalid",
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function httpStatusOf(error: AppError): number {
  switch (error.code) {
    case "not_configured":
      return 503;
    case "invalid_input":
    case "unsafe_input":
      return 400;
    case "forbidden":
      return 403;
    case "rate_limited":
      return 429;
    case "busy":
      return 409;
    default:
      return 502;
  }
}
