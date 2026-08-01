import { Sparkles, X } from "lucide-react"
import { useEffect } from "react"

interface FeatureToastProps {
  dismissLabel: string
  message: string | null
  onDismiss: () => void
}

export function FeatureToast({
  dismissLabel,
  message,
  onDismiss
}: FeatureToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDismiss, 3200)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div
      className="absolute bottom-4 left-4 right-4 z-[80] flex items-center gap-2 rounded-xl border border-border-default bg-bg-primary/95 px-3 py-2.5 shadow-popover backdrop-blur"
      role="status"
      aria-live="polite">
      <Sparkles
        className="h-4 w-4 shrink-0 text-accent-primary"
        strokeWidth={1.8}
      />
      <p className="m-0 flex-1 text-[12px] font-medium text-text-primary">
        {message}
      </p>
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="flex h-6 w-6 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-secondary hover:text-text-primary">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
