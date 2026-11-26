import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Lightbulb, Check, CheckCircle2, Circle, Clock3, LayoutGrid, List, MessageSquare, Play, Plus, Send, ShieldAlert, X } from 'lucide-react'
import { addTicketComment, blockTicket, completeTicket, getTicketComments, getTickets, stallTicket, startTicket, submitAlternative, suggestAlternative, type Ticket, type TicketComment } from '../api/client'

type TicketStatus = 'open' | 'in_progress' | 'done' | 'pending_review' | 'alternative_pending' | 'blocked' | 'stalled'
const columns: Array<{ key: string; label: string; icon: typeof Circle; statuses: TicketStatus[] }> = [
  { key: 'open', label: 'Open', icon: Circle, statuses: ['open'] },
  { key: 'in_progress', label: 'In progress', icon: Play, statuses: ['in_progress'] },
  { key: 'blocked', label: 'Blocked / stalled', icon: AlertCircle, statuses: ['blocked', 'stalled'] },
  { key: 'pending_review', label: 'Waiting for HR', icon: Clock3, statuses: ['pending_review', 'alternative_pending'] },
  { key: 'done', label: 'Done', icon: CheckCircle2, statuses: ['done'] },
]

export default function ITPage({ department }: { department: 'HR' | 'IT' | 'Facilities' }) {
  const client = useQueryClient()
  const [layout, setLayout] = useState<'board' | 'list'>('board')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [comment, setComment] = useState('')
  const [completionTicket, setCompletionTicket] = useState<Ticket | null>(null)
  const [verificationNote, setVerificationNote] = useState('')
  const [alternativeTicket, setAlternativeTicket] = useState<Ticket | null>(null)
  const [blockerReason, setBlockerReason] = useState('')
  const [suggestion, setSuggestion] = useState<{ ticket_id: string; employee_name: string; employee_id: string; issue: string; suggested_title: string; suggested_days: number } | null>(null)
  const [error, setError] = useState('')
  const { data: tickets = [], isLoading, isError } = useQuery<Ticket[]>({ queryKey: ['tickets'], queryFn: getTickets, refetchInterval: 10_000 })
  const commentsQuery = useQuery<TicketComment[]>({ queryKey: ['ticket-comments', selected?.ticket_id], queryFn: () => getTicketComments(selected!.ticket_id), enabled: Boolean(selected) })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['tickets'] }); if (selected) void client.invalidateQueries({ queryKey: ['ticket-comments', selected.ticket_id] }) }
  const mutation = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'start' | 'complete' | 'block' | 'stall'; note?: string }) => action === 'complete' ? completeTicket(id, note ?? '') : ({ start: startTicket, block: blockTicket, stall: stallTicket }[action])(id),
    onSuccess: refresh,
    onError: () => setError('The ticket could not be updated. The ITSM service may be unavailable.'),
  })
  const commentMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => addTicketComment(id, body),
    onSuccess: () => { setComment(''); refresh() },
    onError: () => setError('Your comment could not be saved. Try again.'),
  })
  const suggestionMutation = useMutation({
    mutationFn: ({ ticketId, issue }: { ticketId: string; issue: string }) => suggestAlternative(ticketId, issue),
    onSuccess: setSuggestion,
    onError: () => setError('The system could not prepare a recommendation. Check the connection and try again.'),
  })
  const alternativeMutation = useMutation({
    mutationFn: ({ ticketId, issue, suggested_title, suggested_days }: { ticketId: string; issue: string; suggested_title: string; suggested_days: number }) => submitAlternative(ticketId, { issue, suggested_title, suggested_days }),
    onSuccess: () => {
      setAlternativeTicket(null); setBlockerReason(''); setSuggestion(null)
      void client.invalidateQueries({ queryKey: ['tickets'] })
      void client.invalidateQueries({ queryKey: ['alternative-requests'] })
      void client.invalidateQueries({ queryKey: ['hr-reviews'] })
    },
    onError: () => setError('The alternative request could not be sent to HR. Refresh and try again.'),
  })
  const visible = tickets.filter(ticket => ticket.team === department)
  const counts = {
    active: visible.filter(ticket => ticket.status !== 'done').length,
    inProgress: visible.filter(ticket => ticket.status === 'in_progress').length,
    blocked: visible.filter(ticket => ['blocked', 'stalled'].includes(ticket.status)).length,
    done: visible.filter(ticket => ticket.status === 'done').length,
  }

  const transition = (ticket: Ticket, action: 'start' | 'complete' | 'block' | 'stall') => {
    if (action === 'complete') {
      setVerificationNote('')
      setCompletionTicket(ticket)
      return
    }
    setError(''); mutation.mutate({ id: ticket.ticket_id, action })
  }
  const submitCompletion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!completionTicket || verificationNote.trim().length < 5) return
    setError('')
    mutation.mutate({ id: completionTicket.ticket_id, action: 'complete', note: verificationNote.trim() }, {
      onSuccess: () => { setCompletionTicket(null); setVerificationNote('') },
    })
  }
  const ageDays = (ticket: Ticket) => Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 86_400_000))
  const statusTitle: Record<TicketStatus, string> = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', stalled: 'Stalled', pending_review: 'Waiting for HR review', alternative_pending: 'Alternative sent to HR', done: 'Done' }
  const openAlternative = (ticket: Ticket) => { setError(''); setAlternativeTicket(ticket); setBlockerReason(''); setSuggestion(null) }

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">{department.toUpperCase()} OPERATIONS</span><h1>{department} onboarding tasks</h1><p>Track assigned work by employee, report blockers, and send alternative recommendations to HR.</p></div><div className="queue-view-toggle" role="group" aria-label="Ticket view"><button aria-pressed={layout === 'board'} className={layout === 'board' ? 'selected' : ''} onClick={() => setLayout('board')}><LayoutGrid size={15} />Board</button><button aria-pressed={layout === 'list'} className={layout === 'list' ? 'selected' : ''} onClick={() => setLayout('list')}><List size={15} />List</button></div></div>
    <div className="queue-stats"><div><strong>{counts.active}</strong><span>Active</span></div><div><strong>{counts.inProgress}</strong><span>In progress</span></div><div className={counts.blocked ? 'warning' : ''}><strong>{counts.blocked}</strong><span>Blocked</span></div><div><strong>{counts.done}</strong><span>HR accepted</span></div><div><strong>{visible.filter(ticket => ['pending_review', 'alternative_pending'].includes(ticket.status)).length}</strong><span>Waiting for HR</span></div></div>
    {error && <div className="action-error" role="alert"><AlertCircle size={16} />{error}<button aria-label="Dismiss" onClick={() => setError('')}><X size={14} /></button></div>}
    {isLoading ? <div className="table-skeleton" aria-label="Loading team queue"><span /><span /><span /></div> : isError ? <div className="empty-state"><AlertCircle size={25} /><h1>Ticket queue unavailable</h1><p>Check your connection and retry.</p><button className="button-secondary" onClick={refresh}>Retry</button></div> : visible.length === 0 ? <div className="empty-state"><CheckCircle2 size={25} /><h1>Queue is clear</h1><p>New team requests appear here when an onboarding plan is dispatched.</p></div> : layout === 'board' ? <div className="ticket-board">{columns.map(column => {
      const ColumnIcon = column.icon
      const items = visible.filter(ticket => column.statuses.includes(ticket.status as TicketStatus))
      return <section className={`ticket-column ${column.key}`} key={column.key} aria-label={`${column.label} tickets`}><div className="ticket-column-head"><h2><ColumnIcon size={15} />{column.label}</h2><span>{items.length}</span></div><div className="ticket-column-body">{items.map(ticket => <TicketCard key={ticket.ticket_id} ticket={ticket} onOpen={() => setSelected(ticket)} onAction={action => transition(ticket, action)} onAlternative={() => openAlternative(ticket)} ageDays={ageDays(ticket)} busy={mutation.isPending || alternativeMutation.isPending} />)}{items.length === 0 && <div className="column-empty">No tickets</div>}</div></section>
    })}</div> : <section className="content-card queue-list"><div className="section-heading"><div><h2>Team tickets</h2><p>{visible.length} requests in this queue</p></div></div><div className="queue-list-items">{visible.map(ticket => <div className="queue-list-row" key={ticket.ticket_id}><button className="queue-ticket-open" onClick={() => setSelected(ticket)}><span className="queue-team-dot" /><span><strong>{ticket.title}</strong><small>{ticket.employee_name} · {ticket.employee_id} · {ticket.ticket_id}</small></span></button><span className={`ticket-status ${ticket.status}`}><i />{statusTitle[ticket.status as TicketStatus] ?? ticket.status}</span><TicketActions ticket={ticket} onAction={action => transition(ticket, action)} onAlternative={() => openAlternative(ticket)} busy={mutation.isPending || alternativeMutation.isPending} /></div>)}</div></section>}

    {selected && <div className="drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null) }}><aside className="ticket-drawer" role="dialog" aria-modal="true" aria-labelledby="ticket-drawer-title"><header><div><span className="eyebrow">{selected.team.toUpperCase()} TICKET</span><h2 id="ticket-drawer-title">Request details</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close ticket details"><X size={18} /></button></header><div className="drawer-ticket-title"><span className="ticket-id">{selected.ticket_id}</span><h3>{selected.title}</h3><div className="employee-ticket-identity"><strong>{selected.employee_name}</strong><span>{selected.employee_id}</span></div><div className="drawer-ticket-meta"><span>{selected.team}</span><span className={`ticket-status ${selected.status}`}><i />{statusTitle[selected.status as TicketStatus] ?? selected.status}</span><span><Clock3 size={12} />{ageDays(selected)}d in queue</span></div><div className="sla-box"><strong>SLA estimate</strong><span className={ageDays(selected) >= selected.estimate_days ? 'overdue' : ''}>{Math.max(0, selected.estimate_days - ageDays(selected))} days remaining</span></div>{selected.alternative && <AlternativeStatus ticket={selected} /> }<TicketActions ticket={selected} onAction={action => transition(selected, action)} onAlternative={() => openAlternative(selected)} busy={mutation.isPending || alternativeMutation.isPending} /></div><section className="ticket-comments"><div className="section-heading"><div><h2><MessageSquare size={15} />Work notes</h2><p>Keep the team updated on progress.</p></div></div>{commentsQuery.isLoading ? <div className="comment-skeleton" /> : commentsQuery.data?.length ? <div className="comment-list">{commentsQuery.data.map(item => <article key={item.id}><span className="comment-avatar">{item.author.split(' ').map(part => part[0]).join('').slice(0,2)}</span><div><div className="comment-meta"><strong>{item.author}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div><p>{item.body}</p></div></article>)}</div> : <p className="comment-empty">No work notes yet. Add a comment to keep the handoff clear.</p>}<form onSubmit={event => { event.preventDefault(); if (comment.trim()) commentMutation.mutate({ id: selected.ticket_id, body: comment.trim() }) }} className="comment-form"><textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={1000} placeholder="Add a work note…" aria-label="Add a work note" /><button className="button-primary" disabled={comment.trim().length === 0 || commentMutation.isPending}><Send size={14} />{commentMutation.isPending ? 'Saving…' : 'Add note'}</button></form></section></aside></div>}
    {completionTicket && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !mutation.isPending) setCompletionTicket(null) }}><form className="hire-wizard" role="dialog" aria-modal="true" aria-labelledby="completion-note-title" onSubmit={submitCompletion}><div className="wizard-top"><div><span className="eyebrow">{department.toUpperCase()} HANDOFF</span><h2 id="completion-note-title">Submit completed work to HR</h2></div><button type="button" className="icon-button wizard-close" onClick={() => setCompletionTicket(null)} aria-label="Cancel submission" disabled={mutation.isPending}><X size={18} /></button></div><div className="employee-ticket-identity"><strong>{completionTicket.employee_name}</strong><span>{completionTicket.employee_id}</span></div><p><strong>{completionTicket.title}</strong></p><p>HR will review this verification note before the task counts toward onboarding readiness.</p><label>What did your team verify?<textarea required minLength={5} maxLength={1000} rows={4} autoFocus value={verificationNote} onChange={event => setVerificationNote(event.target.value)} placeholder="Describe what was completed and verified…" /></label>{mutation.isError && <p className="form-error" role="alert">The handoff could not be submitted. Check the connection and try again.</p>}<div className="wizard-actions"><button type="button" className="button-secondary" disabled={mutation.isPending} onClick={() => setCompletionTicket(null)}>Cancel</button><button className="button-primary" disabled={mutation.isPending || verificationNote.trim().length < 5}><Send size={15} />{mutation.isPending ? 'Submitting…' : 'Submit to HR'}</button></div></form></div>}
    {alternativeTicket && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !alternativeMutation.isPending && !suggestionMutation.isPending) { setAlternativeTicket(null); setSuggestion(null) } }}><form className="hire-wizard alternative-wizard" role="dialog" aria-modal="true" aria-labelledby="alternative-title" onSubmit={event => { event.preventDefault(); if (!suggestion) { if (blockerReason.trim().length >= 8) suggestionMutation.mutate({ ticketId: alternativeTicket.ticket_id, issue: blockerReason.trim() }) } else { alternativeMutation.mutate({ ticketId: alternativeTicket.ticket_id, issue: suggestion.issue, suggested_title: suggestion.suggested_title, suggested_days: suggestion.suggested_days }) } }}><div className="wizard-top"><div><span className="eyebrow">{department.toUpperCase()} · ALTERNATIVE REQUEST</span><h2 id="alternative-title">{suggestion ? 'Review recommendation' : 'Report a blocker'}</h2></div><button type="button" className="icon-button wizard-close" onClick={() => { setAlternativeTicket(null); setSuggestion(null) }} aria-label="Close alternative request"><X size={18} /></button></div><div className="employee-ticket-identity"><strong>{alternativeTicket.employee_name}</strong><span>{alternativeTicket.employee_id}</span></div><p><strong>{alternativeTicket.title}</strong></p>{!suggestion ? <><p>Describe what is preventing this task. The system will prepare a practical recommendation for HR to review.</p><label>What is blocked?<textarea required minLength={8} maxLength={1000} rows={4} autoFocus value={blockerReason} onChange={event => setBlockerReason(event.target.value)} placeholder="Example: No standard laptop is available for this employee’s start date." /></label></> : <div className="alternative-suggestion-preview"><div><span className="eyebrow">BLOCKER</span><p>{suggestion.issue}</p></div><div><span className="eyebrow"><Lightbulb size={13} /> AUTOMATED RECOMMENDATION</span><strong>{suggestion.suggested_title}</strong><small>Estimated {suggestion.suggested_days} business day{suggestion.suggested_days === 1 ? '' : 's'}</small></div><p>Review this recommendation before sending it to HR. The team remains blocked until HR decides.</p></div>}{error && <p className="form-error" role="alert">{error}</p>}{(suggestionMutation.isError || alternativeMutation.isError) && <p className="form-error" role="alert">The request could not be completed. Check the connection and try again.</p>}<div className="wizard-actions"><button type="button" className="button-secondary" onClick={() => { if (suggestion) setSuggestion(null); else setAlternativeTicket(null) }}>{suggestion ? 'Edit blocker' : 'Cancel'}</button><button className="button-primary" disabled={suggestionMutation.isPending || alternativeMutation.isPending || (!suggestion && blockerReason.trim().length < 8)}><Lightbulb size={15} />{suggestionMutation.isPending ? 'Generating…' : alternativeMutation.isPending ? 'Sending to HR…' : suggestion ? 'Submit to HR' : 'Get recommendation'}</button></div></form></div>}
  </div>
}

function TicketCard({ ticket, onOpen, onAction, onAlternative, ageDays, busy }: { ticket: Ticket; onOpen: () => void; onAction: (action: 'start' | 'complete' | 'block' | 'stall') => void; onAlternative: () => void; ageDays: number; busy: boolean }) {
  const label = ticket.status === 'pending_review' ? 'Waiting for HR review' : ticket.status === 'alternative_pending' ? 'Alternative sent to HR' : ticket.status.replace('_', ' ')
  return <article className={`ticket-card ${ticket.status === 'stalled' ? 'stalled' : ''}`}><button className="ticket-card-main" onClick={onOpen}><div className="ticket-card-top"><span className="ticket-id">{ticket.ticket_id}</span><span className={`ticket-status ${ticket.status}`}><i />{label}</span></div><h3>{ticket.title}</h3><div className="ticket-employee-line"><strong>{ticket.employee_name}</strong><span>{ticket.employee_id}</span></div><div className="ticket-card-meta"><span>{ticket.team}</span><span><Clock3 size={12} />{ageDays}d / {ticket.estimate_days}d SLA</span></div>{ticket.alternative && ticket.alternative.status !== 'pending' && <AlternativeStatus ticket={ticket} />}</button><TicketActions ticket={ticket} onAction={onAction} onAlternative={onAlternative} busy={busy} /></article>
}

function AlternativeStatus({ ticket }: { ticket: Ticket }) {
  if (!ticket.alternative) return null
  const status = ticket.alternative.status
  return <div className={`ticket-alternative-status ${status}`}><strong>{status === 'pending' ? 'HR is reviewing an alternative' : status === 'approved' ? 'HR approved the alternative' : 'HR rejected the alternative'}</strong><span>{ticket.alternative.suggested_title}</span>{status === 'rejected' && ticket.alternative.decision_note && <small>{ticket.alternative.decision_note}</small>}</div>
}

function TicketActions({ ticket, onAction, onAlternative, busy }: { ticket: Ticket; onAction: (action: 'start' | 'complete' | 'block' | 'stall') => void; onAlternative: () => void; busy: boolean }) {
  if (ticket.status === 'done') return <span className="ticket-done-note"><Check size={14} />Completed</span>
  if (ticket.status === 'pending_review') return <span className="ticket-done-note"><Clock3 size={14} />Submitted to HR</span>
  if (ticket.status === 'alternative_pending') return <span className="ticket-done-note"><Clock3 size={14} />Waiting for HR decision</span>
  return <div className="ticket-actions">{ticket.status !== 'in_progress' && <button aria-label={`Start ${ticket.title}`} disabled={busy} onClick={() => onAction('start')}><Play size={13} />Start</button>}<button className="complete-ticket" disabled={busy} onClick={() => onAction('complete')}><Check size={13} />Complete</button>{ticket.status === 'stalled' ? <button disabled={busy} onClick={() => onAction('block')}><ShieldAlert size={13} />Blocked</button> : <button disabled={busy} onClick={() => onAction('block')}><AlertCircle size={13} />Block</button>}{ticket.status !== 'stalled' && <button disabled={busy} onClick={() => onAction('stall')}><Plus size={13} />Flag stalled</button>}<button className="alternative-action" disabled={busy} onClick={onAlternative}><Lightbulb size={13} />Request alternative</button></div>
}
