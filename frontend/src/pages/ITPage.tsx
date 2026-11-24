import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, CheckCircle2, Circle, Clock3, LayoutGrid, List, MessageSquare, Play, Plus, Send, ShieldAlert, X } from 'lucide-react'
import { addTicketComment, blockTicket, completeTicket, getTicketComments, getTickets, stallTicket, startTicket, type Ticket, type TicketComment } from '../api/client'

type TicketStatus = 'open' | 'in_progress' | 'done' | 'blocked' | 'stalled'
const columns: Array<{ key: string; label: string; icon: typeof Circle; statuses: TicketStatus[] }> = [
  { key: 'open', label: 'Open', icon: Circle, statuses: ['open'] },
  { key: 'in_progress', label: 'In progress', icon: Play, statuses: ['in_progress'] },
  { key: 'blocked', label: 'Blocked / stalled', icon: AlertCircle, statuses: ['blocked', 'stalled'] },
  { key: 'done', label: 'Done', icon: CheckCircle2, statuses: ['done'] },
]

export default function ITPage() {
  const client = useQueryClient()
  const [layout, setLayout] = useState<'board' | 'list'>('board')
  const [teamFilter, setTeamFilter] = useState('all')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const { data: tickets = [], isLoading, isError } = useQuery<Ticket[]>({ queryKey: ['tickets'], queryFn: getTickets, refetchInterval: 10_000 })
  const commentsQuery = useQuery<TicketComment[]>({ queryKey: ['ticket-comments', selected?.ticket_id], queryFn: () => getTicketComments(selected!.ticket_id), enabled: Boolean(selected) })
  const refresh = () => { void client.invalidateQueries({ queryKey: ['tickets'] }); if (selected) void client.invalidateQueries({ queryKey: ['ticket-comments', selected.ticket_id] }) }
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'complete' | 'block' | 'stall' }) => ({ start: startTicket, complete: completeTicket, block: blockTicket, stall: stallTicket }[action])(id),
    onSuccess: refresh,
    onError: () => setError('The ticket could not be updated. The ITSM service may be unavailable.'),
  })
  const commentMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => addTicketComment(id, body),
    onSuccess: () => { setComment(''); refresh() },
    onError: () => setError('Your comment could not be saved. Try again.'),
  })
  const teamOptions = useMemo(() => [...new Set(tickets.map(ticket => ticket.team))].sort(), [tickets])
  const visible = tickets.filter(ticket => teamFilter === 'all' || ticket.team === teamFilter)
  const counts = {
    active: tickets.filter(ticket => ticket.status !== 'done').length,
    inProgress: tickets.filter(ticket => ticket.status === 'in_progress').length,
    blocked: tickets.filter(ticket => ['blocked', 'stalled'].includes(ticket.status)).length,
    done: tickets.filter(ticket => ticket.status === 'done').length,
  }

  const transition = (ticket: Ticket, action: 'start' | 'complete' | 'block' | 'stall') => {
    if (action === 'complete' && !window.confirm(`Mark “${ticket.title}” complete?`)) return
    setError(''); mutation.mutate({ id: ticket.ticket_id, action })
  }
  const ageDays = (ticket: Ticket) => Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 86_400_000))
  const statusTitle: Record<TicketStatus, string> = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', stalled: 'Stalled', done: 'Done' }

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">TEAM OPERATIONS</span><h1>Work queue</h1><p>Complete the hands-on work. OnboardIQ keeps the plan and Day 1 status in sync.</p></div><div className="queue-view-toggle" role="group" aria-label="Ticket view"><button aria-pressed={layout === 'board'} className={layout === 'board' ? 'selected' : ''} onClick={() => setLayout('board')}><LayoutGrid size={15} />Board</button><button aria-pressed={layout === 'list'} className={layout === 'list' ? 'selected' : ''} onClick={() => setLayout('list')}><List size={15} />List</button></div></div>
    <div className="queue-stats"><div><strong>{counts.active}</strong><span>Active</span></div><div><strong>{counts.inProgress}</strong><span>In progress</span></div><div className={counts.blocked ? 'warning' : ''}><strong>{counts.blocked}</strong><span>Blocked</span></div><div><strong>{counts.done}</strong><span>Completed</span></div><label>Team<select aria-label="Filter by team" value={teamFilter} onChange={event => setTeamFilter(event.target.value)}><option value="all">All teams</option>{teamOptions.map(team => <option key={team}>{team}</option>)}</select></label></div>
    {error && <div className="action-error" role="alert"><AlertCircle size={16} />{error}<button aria-label="Dismiss" onClick={() => setError('')}><X size={14} /></button></div>}
    {isLoading ? <div className="table-skeleton" aria-label="Loading team queue"><span /><span /><span /></div> : isError ? <div className="empty-state"><AlertCircle size={25} /><h1>Ticket queue unavailable</h1><p>Check your connection and retry.</p><button className="button-secondary" onClick={refresh}>Retry</button></div> : visible.length === 0 ? <div className="empty-state"><CheckCircle2 size={25} /><h1>Queue is clear</h1><p>New team requests appear here when an onboarding plan is dispatched.</p></div> : layout === 'board' ? <div className="ticket-board">{columns.map(column => {
      const ColumnIcon = column.icon
      const items = visible.filter(ticket => column.statuses.includes(ticket.status as TicketStatus))
      return <section className={`ticket-column ${column.key}`} key={column.key} aria-label={`${column.label} tickets`}><div className="ticket-column-head"><h2><ColumnIcon size={15} />{column.label}</h2><span>{items.length}</span></div><div className="ticket-column-body">{items.map(ticket => <TicketCard key={ticket.ticket_id} ticket={ticket} onOpen={() => setSelected(ticket)} onAction={action => transition(ticket, action)} ageDays={ageDays(ticket)} busy={mutation.isPending} />)}{items.length === 0 && <div className="column-empty">No tickets</div>}</div></section>
    })}</div> : <section className="content-card queue-list"><div className="section-heading"><div><h2>Team tickets</h2><p>{visible.length} requests in this queue</p></div></div><div className="queue-list-items">{visible.map(ticket => <div className="queue-list-row" key={ticket.ticket_id}><button className="queue-ticket-open" onClick={() => setSelected(ticket)}><span className="queue-team-dot" /><span><strong>{ticket.title}</strong><small>{ticket.ticket_id} · {ticket.team} · {ageDays(ticket)}d in queue</small></span></button><span className={`ticket-status ${ticket.status}`}><i />{statusTitle[ticket.status as TicketStatus] ?? ticket.status}</span><TicketActions ticket={ticket} onAction={action => transition(ticket, action)} busy={mutation.isPending} /></div>)}</div></section>}

    {selected && <div className="drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null) }}><aside className="ticket-drawer" role="dialog" aria-modal="true" aria-labelledby="ticket-drawer-title"><header><div><span className="eyebrow">{selected.team.toUpperCase()} TICKET</span><h2 id="ticket-drawer-title">Request details</h2></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close ticket details"><X size={18} /></button></header><div className="drawer-ticket-title"><span className="ticket-id">{selected.ticket_id}</span><h3>{selected.title}</h3><div className="drawer-ticket-meta"><span>{selected.team}</span><span className={`ticket-status ${selected.status}`}><i />{statusTitle[selected.status as TicketStatus] ?? selected.status}</span><span><Clock3 size={12} />{ageDays(selected)}d in queue</span></div><div className="sla-box"><strong>SLA estimate</strong><span className={ageDays(selected) >= selected.estimate_days ? 'overdue' : ''}>{Math.max(0, selected.estimate_days - ageDays(selected))} days remaining</span></div><TicketActions ticket={selected} onAction={action => transition(selected, action)} busy={mutation.isPending} /></div><section className="ticket-comments"><div className="section-heading"><div><h2><MessageSquare size={15} />Work notes</h2><p>Keep the team updated on progress.</p></div></div>{commentsQuery.isLoading ? <div className="comment-skeleton" /> : commentsQuery.data?.length ? <div className="comment-list">{commentsQuery.data.map(item => <article key={item.id}><span className="comment-avatar">{item.author.split(' ').map(part => part[0]).join('').slice(0,2)}</span><div><div className="comment-meta"><strong>{item.author}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div><p>{item.body}</p></div></article>)}</div> : <p className="comment-empty">No work notes yet. Add a comment to keep the handoff clear.</p>}<form onSubmit={event => { event.preventDefault(); if (comment.trim()) commentMutation.mutate({ id: selected.ticket_id, body: comment.trim() }) }} className="comment-form"><textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={1000} placeholder="Add a work note…" aria-label="Add a work note" /><button className="button-primary" disabled={comment.trim().length === 0 || commentMutation.isPending}><Send size={14} />{commentMutation.isPending ? 'Saving…' : 'Add note'}</button></form></section></aside></div>}
  </div>
}

function TicketCard({ ticket, onOpen, onAction, ageDays, busy }: { ticket: Ticket; onOpen: () => void; onAction: (action: 'start' | 'complete' | 'block' | 'stall') => void; ageDays: number; busy: boolean }) {
  return <article className={`ticket-card ${ticket.status === 'stalled' ? 'stalled' : ''}`}><button className="ticket-card-main" onClick={onOpen}><div className="ticket-card-top"><span className="ticket-id">{ticket.ticket_id}</span><span className={`ticket-status ${ticket.status}`}><i />{ticket.status.replace('_', ' ')}</span></div><h3>{ticket.title}</h3><div className="ticket-card-meta"><span>{ticket.team}</span><span><Clock3 size={12} />{ageDays}d / {ticket.estimate_days}d SLA</span></div></button><TicketActions ticket={ticket} onAction={onAction} busy={busy} /></article>
}

function TicketActions({ ticket, onAction, busy }: { ticket: Ticket; onAction: (action: 'start' | 'complete' | 'block' | 'stall') => void; busy: boolean }) {
  if (ticket.status === 'done') return <span className="ticket-done-note"><Check size={14} />Completed</span>
  return <div className="ticket-actions">{ticket.status !== 'in_progress' && <button aria-label={`Start ${ticket.title}`} disabled={busy} onClick={() => onAction('start')}><Play size={13} />Start</button>}<button className="complete-ticket" disabled={busy} onClick={() => onAction('complete')}><Check size={13} />Complete</button>{ticket.status === 'stalled' ? <button disabled={busy} onClick={() => onAction('block')}><ShieldAlert size={13} />Blocked</button> : <button disabled={busy} onClick={() => onAction('block')}><AlertCircle size={13} />Block</button>}{ticket.status !== 'stalled' && <button disabled={busy} onClick={() => onAction('stall')}><Plus size={13} />Flag stalled</button>}</div>
}
