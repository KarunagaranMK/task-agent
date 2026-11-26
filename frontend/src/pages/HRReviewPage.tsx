import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bot, Check, CheckCheck, Clock3, RefreshCw, ShieldCheck } from 'lucide-react'
import { decideHRReview, getHRReviews, type HRReview } from '../api/client'

export default function HRReviewPage() {
  const client = useQueryClient()
  const reviews = useQuery({ queryKey: ['hr-reviews'], queryFn: getHRReviews, refetchInterval: 15_000 })
  const action = useMutation({
    mutationFn: ({ taskId, decision }: { taskId: string; decision: 'accept' | 'alternative' }) => decideHRReview(taskId, decision),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['hr-reviews'] }); void client.invalidateQueries({ queryKey: ['hires'] }); void client.invalidateQueries({ queryKey: ['notifications'] }) },
  })
  const rows: HRReview[] = reviews.data ?? []

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">HR WORKSPACE</span><h1>Department review</h1><p>Teams submit completed work here. Accept it or ask the agent to suggest an alternative for your approval.</p></div><button className="button-secondary" onClick={() => void reviews.refetch()}><RefreshCw size={15} />Refresh</button></div>
    <div className="queue-stats"><div><strong>{rows.filter(item => item.status === 'pending_review').length}</strong><span>Waiting for review</span></div><div><strong>{rows.filter(item => item.status === 'alternative_pending').length}</strong><span>Agent alternatives</span></div><div><strong>{rows.length}</strong><span>Open decisions</span></div></div>
    {action.isError && <div className="action-error" role="alert"><AlertCircle size={16} />The review could not be saved. Refresh and try again.</div>}
    {reviews.isLoading ? <div className="table-skeleton" role="status" aria-label="Loading HR reviews"><span /><span /></div> : reviews.isError ? <div className="empty-state"><AlertCircle size={26} /><h2>Reviews could not be loaded</h2><p>Check your connection and retry.</p><button className="button-secondary" onClick={() => void reviews.refetch()}>Retry</button></div> : rows.length === 0 ? <div className="empty-state"><CheckCheck size={28} /><h2>Nothing needs your review</h2><p>When a department completes work, its submission and notification will appear here.</p></div> : <section className="approval-list" aria-label="Department submissions">{rows.map(item => <article className="content-card" key={item.task_id} style={{ padding: 20 }}><div className="section-heading"><div><span className="eyebrow">{item.team.toUpperCase()} · {item.ticket_id}</span><h2>{item.hire_name}</h2><p>{item.status === 'alternative_pending' ? 'Alternative proposed by the planning agent' : 'Department says this task is complete'}</p></div><span className={`ticket-status ${item.status === 'alternative_pending' ? 'in_progress' : 'open'}`}><i />{item.status === 'alternative_pending' ? 'Needs HR approval' : 'Submitted'}</span></div><div className="drawer-ticket-title"><strong>{item.task_title}</strong>{item.suggested_title && <div className="sla-box"><strong><Bot size={14} /> Agent suggestion</strong><span>{item.suggested_title}</span></div>}<small><Clock3 size={13} />Submitted {new Date(item.updated_at).toLocaleString()}</small></div><div className="wizard-actions">{item.status === 'pending_review' ? <><button className="button-secondary" disabled={action.isPending} onClick={() => action.mutate({ taskId: item.task_id, decision: 'alternative' })}><Bot size={15} />Ask agent for alternative</button><button className="button-primary" disabled={action.isPending} onClick={() => action.mutate({ taskId: item.task_id, decision: 'accept' })}><Check size={15} />Accept completion</button></> : <button className="button-primary" disabled={action.isPending} onClick={() => action.mutate({ taskId: item.task_id, decision: 'accept' })}><ShieldCheck size={15} />Approve alternative</button>}</div></article>)}</section>}
  </div>
}
