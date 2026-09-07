export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly publicMessage: string

  constructor(code: ErrorCode, publicMessage: string, options?: { cause?: unknown }) {
    super(publicMessage, options)
    this.code = code
    this.publicMessage = publicMessage
    this.name = 'AppError'
  }
}

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Anda harus masuk untuk melakukan tindakan ini.',
  FORBIDDEN: 'Anda tidak memiliki akses untuk melakukan tindakan ini.',
  NOT_FOUND: 'Data yang Anda cari tidak ditemukan.',
  VALIDATION_ERROR: 'Data yang Anda masukkan tidak valid.',
  CONFLICT: 'Tindakan ini tidak dapat dilakukan karena ada perubahan data terkait.',
  INTERNAL_ERROR: 'Terjadi kesalahan pada sistem. Silakan coba lagi.',
}

export function appError(code: ErrorCode, message?: string): AppError {
  return new AppError(code, message ?? DEFAULT_MESSAGES[code])
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.publicMessage
  }

  if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
    return DEFAULT_MESSAGES.UNAUTHENTICATED
  }

  if (error instanceof Error && error.message === 'FORBIDDEN') {
    return DEFAULT_MESSAGES.FORBIDDEN
  }

  console.error('[unhandled-error]', error)
  return DEFAULT_MESSAGES.INTERNAL_ERROR
}
