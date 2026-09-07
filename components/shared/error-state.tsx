"use client"

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({
  title = "Terjadi kesalahan",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Coba lagi
        </button>
      ) : null}
    </div>
  )
}
