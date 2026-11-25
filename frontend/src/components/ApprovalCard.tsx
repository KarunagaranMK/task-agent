import { Check, ShieldCheck, X } from 'lucide-react'
import type { Task } from '../api/client'

export type ApprovalTask = Task & { hire_name: string }

type ApprovalCardProps = {
  task: ApprovalTask
  disabled?: boolean
  onApprove: (taskId: string) => void
  onReject: (taskId: string) => void
}

export function ApprovalCard({ task, disabled = false, onApprove, onReject }: ApprovalCardProps) {
  return <article className="approval-item">
    <div className="approval-item-icon"><ShieldCheck size={18} /></div>
    <div className="approval-item-main">
      <div className="approval-title-row"><strong>{task.title}</strong><span className="approval-badge">Approval required</span></div>
      <p>{task.hire_name} <span>·</span> {task.team} <span>·</span> {task.duration_days} day{task.duration_days === 1 ? '' : 's'}</p>
      <small>Required for this hire’s role-specific onboarding plan.</small>
    </div>
    <div className="approval-actions">
      <button className="button-secondary reject-action" disabled={disabled} onClick={() => onReject(task.id)}><X size={15} />Reject</button>
      <button className="button-primary" disabled={disabled} onClick={() => onApprove(task.id)}><Check size={15} />Approve</button>
    </div>
  </article>
}
