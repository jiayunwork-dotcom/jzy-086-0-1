/**
 * 领域内可预期的错误。
 *
 * - `validation`：输入参数非法（含缺字段、取值无意义）。
 * - `grid`：调用方给定的离散参数凑不出库朗数恰为 1 的贴格网格。
 * - `limit`：推进步数超过允许上限，强制终止以防死循环。
 */
export type ServiceErrorCode = 'validation' | 'grid' | 'limit';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ServiceErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}

export function validationError(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ServiceError('validation', message, details);
}

export function gridError(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ServiceError('grid', message, details);
}

export function limitError(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ServiceError('limit', message, details);
}
