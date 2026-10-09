import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@dealdash/types';

/** Application error with a stable machine-readable code (see ERROR_CODES). */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: number,
    readonly field?: string,
    /** Several field-level problems reported together (for example an incomplete deal). */
    readonly extra?: Array<{ code: string; message: string; field?: string }>,
  ) {
    super({ code, message, field }, status);
  }

  static authRequired(message = 'Authentication is required') {
    return new AppError('AUTH_REQUIRED', message, 401);
  }
  static authInvalid(message = 'Invalid credentials') {
    return new AppError('AUTH_INVALID', message, 401);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError('FORBIDDEN', message, 403);
  }
  /** Used instead of 403 for other tenants' resources so existence is never revealed. */
  static notFound(message = 'Not found') {
    return new AppError('NOT_FOUND', message, 404);
  }
  static validation(message: string, field?: string) {
    return new AppError('VALIDATION_FAILED', message, 400, field);
  }
  static conflict(code: ErrorCode, message: string) {
    return new AppError(code, message, 409);
  }
  static rateLimited(code: ErrorCode, message: string) {
    return new AppError(code, message, 429);
  }
}
