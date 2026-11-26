import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bot, Check, CheckCheck, Clock3, RefreshCw, ShieldCheck } from 'lucide-react'
import { decideHRReview, getHRReviews, type HRReview } from '../api/client'

export default function HRReviewPage() {
  const client = useQueryClient()
  const [view, setView] = useState<'pending' | 'approved'>('pending')
  const reviews = useQuery({ queryKey: ['hr-reviews'], queryFn: getHRReviews, refetchInterval: 15_000 })
  const action = useMutation({
    mutationFn: ({ taskId, decision }: { taskId: string; decision: 'accept' | 'alternative' }) => decideHRReview(taskId, decision),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['hr-reviews'] })
      void client.invalidateQueries({ queryKey: ['hires'] })
      void client.invalidateQueries({ queryKey: ['metrics'] })
      void client.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  const rows: HRReview[] = reviews.data ?? []
  const waiting = rows.filter(item => item.status !== 'done')
  const accepted = rows.filter(item => item.status === 'done')
  const shown = view === 'pending' ? waiting : accepted

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">HR WORKSPACE</span><h1>Department review</h1><p>Review each IT and Facilities handoff, read the verification notes, then accept completion or request an agent alternative.</p></div><button className="button-secondary" onClick={() => void reviews.refetch()}><RefreshCw size={15} />Refresh</button></div>
    <div className="queue-stats"><div><strong>{waiting.filter(item => item.status === 'pending_review').length}</strong><span>Waiting for review</span></div><div><strong>{waiting.filter(item => item.status === 'alternative_pending').length}</strong><span>Alternatives to approve</span></div><div><strong>{accepted.length}</strong><span>Accepted by HR</span></div></div>
    {action.isError && <div className="action-error" role="alert"><AlertCircle size={16} />The review could not be saved. Refresh and try again.</div>}
    <div className="filter-chips" aria-label="Review list"><button className={`filter-chip ${view === 'pending' ? 'selected' : ''}`} aria-pressed={view === 'pending'} onClick={() => setView('pending')}>Needs review ({waiting.length})</button><button className={`filter-chip ${view === 'approved' ? 'selected' : ''}`} aria-pressed={view === 'approved'} onClick={() => setView('approved')}>HR accepted ({accepted.length})</button></div>
    {reviews.isLoading ? <div className="table-skeleton" role="status" aria-label="Loading HR reviews"><span /><span /></div> : reviews.isError ? <div className="empty-state"><AlertCircle size={26} /><h2>Reviews could not be loaded</h2><p>Check your connection and retry.</p><button className="button-secondary" onClick={() => void reviews.refetch()}>Retry</button></div> : shown.length === 0 ? <div className="empty-state"><CheckCheck size={28} /><h2>{view === 'pending' ? 'Nothing needs your review' : 'No accepted handoffs yet'}</h2><p>{view === 'pending' ? 'When IT or Facilities submits completed work, it will appear here with its verification notes.' : 'After HR accepts a department submission, it will remain available here.'}</p></div> : <section className="approval-list" aria-label={view === 'pending' ? 'Department submissions' : 'HR accepted submissions'}>{shown.map(item => <article className="content-card" key={item.task_id} style={{ padding: 20 }}><div className="section-heading"><div><span className="eyebrow">{item.team.toUpperCase()} · {item.ticket_id}</span><h2>{item.hire_name}</h2><p>{item.status === 'alternative_pending' ? 'Alternative proposed by the planning agent' : item.status === 'done' ? 'HR accepted this department handoff' : 'Department submitted this task for HR review'}</p></div><span className={`ticket-status ${item.status === 'done' ? 'done' : item.status === 'alternative_pending' ? 'in_progress' : 'open'}`}><i />{item.status === 'done' ? 'HR accepted' : item.status === 'alternative_pending' ? 'Needs HR approval' : 'Submitted'}</span></div><div className="drawer-ticket-title"><strong>{item.task_title}</strong>{item.suggested_title && <div className="sla-box"><strong><Bot size={14} /> Agent suggestion</strong><span>{item.suggested_title}</span></div>}<small><Clock3 size={13} />Updated {new Date(item.updated_at).toLocaleString()}</small></div><section className="ticket-comments"><div className="section-heading"><div><h3>Department verification</h3><p>Notes attached by the team completing this work.</p></div></div>{item.verification_notes.length ? <div className="comment-list">{item.verification_notes.map((note, index) => <article key={`${note.created_at}-${index}`}><span className="comment-avatar">{note.author.split(' ').map(part => part[0]).join('').slice(0,2)}</span><div><div className="comment-meta"><strong>{note.author}</strong><small>{new Date(note.created_at).toLocaleString()}</small></div><p>{note.body}</p></div></article>)}</div> : <p className="comment-empty">No verification note was added for this handoff.</p>}</section>{view === 'pending' && <div className="wizard-actions">{item.status === 'pending_review' ? <><button className="button-secondary" disabled={action.isPending} onClick={() => action.mutate({ taskId: item.task_id, decision: 'alternative' })}><Bot size={15} />Ask agent for alternative</button><button className="button-primary" disabled={action.isPending} onClick={() => action.mutate({ taskId: item.task_id, decision: 'accept' })}><Check size={15} />Accept completion</button></> : <button className="button-primary" disabled={action.isPending} onClick={() => action.mutate({ taskId: item.task_id, decision: 'accept' })}><ShieldCheck size={15} />Approve alternative</button>}</div>}<Link className="text-action" to={`/hire/${item.hire_id}`}>Open employee onboarding progress</Link></article>)}</section>}
  </div>
}
