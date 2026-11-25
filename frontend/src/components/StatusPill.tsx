const toneByStatus: Record<string, string> = {
  on_track: 'on_track', at_risk: 'at_risk', ready: 'ready', paused: 'warning', cancelled: 'neutral',
  done: 'ready', dispatched: 'on_track', pending: 'neutral', awaiting_approval: 'warning',
  queued: 'warning', blocked: 'at_risk',
}

type StatusPillProps = { status: string; label?: string; tone?: string }

export function StatusPill({ status, label, tone }: StatusPillProps) {
  const text = label ?? status.replace(/_/g, ' ')
  return <span className={`status-pill ${tone ?? toneByStatus[status] ?? 'neutral'}`} aria-label={text}>{text}</span>
}
