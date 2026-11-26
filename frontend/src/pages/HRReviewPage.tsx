import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bot, Check, CheckCheck, Clock3, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { decideAlternativeRequest, decideHRReview, getAlternativeRequests, getHRReviews, type AlternativeRequest, type HRReview } from '../api/client'

type View = 'work' | 'alternatives' | 'history'

export default function HRReviewPage() {
  const client = useQueryClient()
  const [view, setView] = useState<View>('work')
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({})
  const reviews = useQuery({ queryKey: ['hr-reviews'], queryFn: getHRReviews, refetchInterval: 15_000 })
  const alternatives = useQuery({ queryKey: ['alternative-requests'], queryFn: getAlternativeRequests, refetchInterval: 15_000 })
  const refreshData = () => {
    void client.invalidateQueries({ queryKey: ['hr-reviews'] })
    void client.invalidateQueries({ queryKey: ['alternative-requests'] })
    void client.invalidateQueries({ queryKey: ['hires'] })
    void client.invalidateQueries({ queryKey: ['tickets'] })
    void client.invalidateQueries({ queryKey: ['metrics'] })
    void client.invalidateQueries({ queryKey: ['notifications'] })
  }
  const reviewAction = useMutation({
    mutationFn: ({ taskId, decision }: { taskId: string; decision: 'accept' | 'alternative' }) => decideHRReview(taskId, decision),
    onSuccess: refreshData,
  })
  const alternativeAction = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => decideAlternativeRequest(id, decision, decisionNote[id] ?? ''),
    onSuccess: refreshData,
  })
  const allReviews: HRReview[] = reviews.data ?? []
  const completions = allReviews.filter(item => item.status === 'pending_review')
  const accepted = allReviews.filter(item => item.status === 'done')
  const allAlternatives: AlternativeRequest[] = alternatives.data ?? []
  const waitingAlternatives = allAlternatives.filter(item => item.status === 'pending')
  const decidedAlternatives = allAlternatives.filter(item => item.status !== 'pending')
  const isLoading = reviews.isLoading || alternatives.isLoading
  const isError = reviews.isError || alternatives.isError

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">HR WORKSPACE</span><h1>Department review</h1><p>Review completed work and decide whether proposed alternatives can proceed.</p></div><button className="button-secondary" onClick={refreshData}><RefreshCw size={15} />Refresh</button></div>
    <div className="queue-stats"><div><strong>{completions.length}</strong><span>Work submissions</span></div><div><strong>{waitingAlternatives.length}</strong><span>Alternative requests</span></div><div><strong>{accepted.length + allAlternatives.filter(item => item.status === 'approved').length}</strong><span>Approved and accepted</span></div></div>
    {(reviewAction.isError || alternativeAction.isError) && <div className="action-error" role="alert"><AlertCircle size={16} />The decision could not be saved. Refresh and try again.</div>}
    <div className="filter-chips" aria-label="HR review sections">
      <button className={`filter-chip ${view === 'work' ? 'selected' : ''}`} aria-pressed={view === 'work'} onClick={() => setView('work')}>Work submissions ({completions.length})</button>
      <button className={`filter-chip ${view === 'alternatives' ? 'selected' : ''}`} aria-pressed={view === 'alternatives'} onClick={() => setView('alternatives')}>Alternative requests ({waitingAlternatives.length})</button>
      <button className={`filter-chip ${view === 'history' ? 'selected' : ''}`} aria-pressed={view === 'history'} onClick={() => setView('history')}>Decision history ({accepted.length + decidedAlternatives.length})</button>
    </div>
    {isLoading ? <div className="table-skeleton" role="status" aria-label="Loading HR reviews"><span /><span /></div> : isError ? <div className="empty-state"><AlertCircle size={26} /><h2>Reviews could not be loaded</h2><p>Check your connection and retry.</p><button className="button-secondary" onClick={() => { void reviews.refetch(); void alternatives.refetch() }}>Retry</button></div> : <>
      {view === 'work' && (completions.length ? <section className="approval-list" aria-label="Department work submissions">{completions.map(item => <article className="content-card" key={item.task_id} style={{ padding: 20 }}><div className="section-heading"><div><span className="eyebrow">{item.team.toUpperCase()} · {item.ticket_id}</span><h2>{item.hire_name}</h2><p>Department completed this task and submitted its verification evidence.</p></div><span className="ticket-status open"><i />Waiting for HR</span></div><div className="drawer-ticket-title"><strong>{item.task_title}</strong><small><Clock3 size={13} />Updated {new Date(item.updated_at).toLocaleString()}</small></div><section className="ticket-comments"><div className="section-heading"><div><h3>Department verification</h3><p>Evidence attached by the team completing this work.</p></div></div>{item.verification_notes.length ? <div className="comment-list">{item.verification_notes.map((note, index) => <article key={`${note.created_at}-${index}`}><span className="comment-avatar">{note.author.split(' ').map(part => part[0]).join('').slice(0,2)}</span><div><div className="comment-meta"><strong>{note.author}</strong><small>{new Date(note.created_at).toLocaleString()}</small></div><p>{note.body}</p></div></article>)}</div> : <p className="comment-empty">No verification note was added for this handoff.</p>}</section><div className="wizard-actions"><button className="button-secondary" disabled={reviewAction.isPending} onClick={() => reviewAction.mutate({ taskId: item.task_id, decision: 'alternative' })}><Bot size={15} />Request an alternative</button><button className="button-primary" disabled={reviewAction.isPending} onClick={() => reviewAction.mutate({ taskId: item.task_id, decision: 'accept' })}><Check size={15} />Accept completion</button></div><Link className="text-action" to={`/hire/${item.hire_id}`}>Open employee onboarding progress</Link></article>)}</section> : <Empty title="No work submissions" text="When a department completes an assigned task, its verification notes will appear here." />)}
      {view === 'alternatives' && (waitingAlternatives.length ? <section className="approval-list" aria-label="Alternative requests">{waitingAlternatives.map(item => <AlternativeCard key={item.id} item={item} busy={alternativeAction.isPending} note={decisionNote[item.id] ?? ''} onNote={value => setDecisionNote(current => ({ ...current, [item.id]: value }))} onDecision={decision => alternativeAction.mutate({ id: item.id, decision })} />)}</section> : <Empty title="No alternatives need review" text="Department blocker reports and monitor recommendations will arrive here for your decision." />)}
      {view === 'history' && (accepted.length + decidedAlternatives.length ? <section className="approval-list" aria-label="HR decision history">{decidedAlternatives.map(item => <AlternativeCard key={item.id} item={item} readOnly />)}{accepted.map(item => <article className="content-card" key={item.task_id} style={{ padding: 20 }}><div className="section-heading"><div><span className="eyebrow">{item.team.toUpperCase()} · {item.ticket_id}</span><h2>{item.hire_name}</h2><p>{item.task_title}</p></div><span className="ticket-status done"><i />Completion accepted</span></div><Link className="text-action" to={`/hire/${item.hire_id}`}>Open employee onboarding progress</Link></article>)}</section> : <Empty title="No decisions recorded" text="Accepted work and decided alternatives will remain available here." />)}
    </>}
  </div>
}

function AlternativeCard({ item, busy = false, note = '', onNote, onDecision, readOnly = false }: { item: AlternativeRequest; busy?: boolean; note?: string; onNote?: (value: string) => void; onDecision?: (decision: 'approve' | 'reject') => void; readOnly?: boolean }) {
  return <article className="content-card" style={{ padding: 20 }}><div className="section-heading"><div><span className="eyebrow">{item.department.toUpperCase()} · {item.ticket_id}</span><h2>{item.employee_name} <small className="employee-id">{item.employee_id}</small></h2><p>{item.task_title} · Requested by {item.requested_by}</p></div><span className={`ticket-status ${item.status === 'approved' ? 'done' : item.status === 'rejected' ? 'blocked' : 'open'}`}><i />{item.status === 'pending' ? 'Needs HR decision' : item.status === 'approved' ? 'Approved' : 'Rejected'}</span></div><div className="alternative-review-grid"><section><span className="eyebrow">BLOCKER REPORTED</span><p>{item.issue}</p></section><section><span className="eyebrow"><Bot size={13} /> SUGGESTED ALTERNATIVE</span><strong>{item.suggested_title}</strong><small>Estimated {item.suggested_days} business day{item.suggested_days === 1 ? '' : 's'}</small></section></div>{item.decision_note && <p className="comment-empty">Decision note: {item.decision_note}</p>}{!readOnly && item.status === 'pending' && <><label className="decision-note-field">Decision note <textarea rows={2} maxLength={500} value={note} onChange={event => onNote?.(event.target.value)} placeholder="Optional context for the department" /></label><div className="wizard-actions"><button className="button-secondary" disabled={busy} onClick={() => onDecision?.('reject')}><X size={15} />Reject alternative</button><button className="button-primary" disabled={busy} onClick={() => onDecision?.('approve')}><ShieldCheck size={15} />Approve and send to department</button></div></>}{item.status === 'approved' && <p className="inline-success"><CheckCheck size={15} />The department can continue using the approved alternative.</p>}<small className="alternative-timestamp">Updated {new Date(item.updated_at).toLocaleString()}</small></article>
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><CheckCheck size={28} /><h2>{title}</h2><p>{text}</p></div>
}
