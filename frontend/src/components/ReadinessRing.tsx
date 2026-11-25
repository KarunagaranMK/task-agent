import type { CSSProperties } from 'react'

type ReadinessRingProps = { value: number; label?: string }

export function ReadinessRing({ value, label = 'Day-1 readiness' }: ReadinessRingProps) {
  const bounded = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const rounded = Math.round(bounded)
  return <div
    className="readiness-donut"
    style={{ '--readiness': `${bounded}%` } as CSSProperties}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={rounded}
    aria-valuetext={`${rounded}% complete`}
  >
    <span>{rounded}<small>%</small></span>
  </div>
}
