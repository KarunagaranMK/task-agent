import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, CheckCircle2, Clock3, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { getMyOnboarding, reportOnboardingIssue } from '../api/client'

const statusText: Record<string, string> = {
  done: 'Complete', dispatched: 'In progress', in_progress: 'In progress', awaiting_approval: 'Waiting for approval',
  pending: 'Coming up', queued: 'Being scheduled', blocked: 'Needs attention', paused: 'On hold', cancelled: 'Cancelled',
}
const displayDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(`${value}T12:00:00`)) : null

export default function MyOnboardingPage() {
  const client = useQueryClient()
  const [message, setMessage] = useState('')
  const [issueOpen, setIssueOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const { data, isLoading, isError } = useQuery({ queryKey: ['my-onboarding'], queryFn: getMyOnboarding, refetchInterval: 15_000 })
  const issueMutation = useMutation({
    mutationFn: reportOnboardingIssue,
    onSuccess: () => { setMessage(''); setSent(true); setIssueOpen(false); void client.invalidateQueries({ queryKey: ['my-onboarding'] }) },
  })

  if (isLoading) return <div className="portal-page"><div className="page-skeleton" aria-label="Loading your onboarding plan"><span /></div></div>
  if (isError) return <div className="portal-page"><div className="empty-state"><AlertCircle size={28} /><h1>We couldn’t load your plan</h1><p>Check your connection and try again.</p></div></div>
  if (!data?.hire) return <div className="portal-page"><div className="empty-state"><Sparkles size={30} /><h1>Your onboarding is being set up</h1><p>HR will connect your personal plan here. You can return to this page later.</p></div></div>

  const { hire, tasks } = data
  const complete = tasks.filter(task => task.status === 'done').length
  const readyDay = hire.projected_day ?? hire.start_day
  const readyDate = displayDate(hire.projected_ready_date ?? hire.start_date)
  const grouped = [
    { title: 'Completed', tasks: tasks.filter(task => task.status === 'done') },
    { title: 'In progress', tasks: tasks.filter(task => ['dispatched', 'in_progress'].includes(task.status)) },
    { title: 'Coming up', tasks: tasks.filter(task => !['done', 'dispatched', 'in_progress'].includes(task.status)) },
  ].filter(group => group.tasks.length)

  return <div className="portal-page newhire-page">
    <div className="newhire-welcome"><div><span className="eyebrow">YOUR FIRST DAY, IN SYNC</span><h1>Welcome, {hire.name.split(' ')[0]}</h1><p>Your teams are coordinating the details. Here’s what’s happening before Day 1.</p></div><div className="newhire-welcome-mark"><Sparkles size={23} /></div></div>
    <section className="newhire-summary">
      <div className="newhire-ready-icon"><ShieldCheck size={22} /></div>
      <div className="newhire-summary-copy"><span className="eyebrow">{hire.status === 'ready' ? 'ALL SET FOR DAY 1' : hire.status === 'paused' ? 'PLAN ON HOLD' : 'DAY 1 READINESS'}</span><h2>{hire.status === 'ready' ? 'You’re ready to go' : `Your plan is ${hire.readiness}% complete`}</h2><p>{hire.role} · {hire.department} <span>·</span> Joining {displayDate(hire.start_date) ?? `in ${hire.start_day} business days`}</p></div>
      <div className="newhire-progress"><strong>{complete}<span>/{tasks.length}</span></strong><small>tasks complete</small><div className="readiness-track"><i style={{ width: `${tasks.length ? (complete / tasks.length) * 100 : 0}%` }} /></div></div>
    </section>

    <section className="newhire-timeline-card">
      <div className="section-heading"><div><h2>Your onboarding plan</h2><p>We’ll keep this timeline updated as teams finish their work.</p></div><span className="eta-chip"><Clock3 size={14} /> Target ready: {readyDate ?? `Day ${readyDay}`}</span></div>
      {grouped.length === 0 ? <div className="empty-state compact"><Clock3 size={24} /><h3>Your plan is being prepared</h3><p>Tasks will appear here when they’re ready.</p></div> : <div className="newhire-timeline">{grouped.map(group => <div className="timeline-group" key={group.title}><h3>{group.title}<span>{group.tasks.length}</span></h3><div className="timeline-items">{group.tasks.map((task, index) => {
        const done = task.status === 'done'
        const blocked = task.status === 'blocked'
        return <article className={`timeline-task ${done ? 'completed' : blocked ? 'attention' : ''}`} key={`${task.title}-${index}`}>
          <i className="timeline-task-marker">{done ? <Check size={14} /> : blocked ? <AlertCircle size={14} /> : <span />}</i>
          <div className="timeline-task-body"><div className="timeline-task-heading"><strong>{task.title}</strong><span className={`status-pill ${done ? 'ready' : blocked ? 'at_risk' : 'on_track'}`}>{statusText[task.status] ?? 'In progress'}</span></div><p>{done ? 'Your team has completed this step.' : task.eta_day === null ? 'We’ll share an update when this step is scheduled.' : `Expected by Day ${task.eta_day}`}</p></div>
        </article>
      })}</div></div>)}</div>}
    </section>

    <div className="newhire-help-row"><div><div className="newhire-help-icon"><CheckCircle2 size={18} /></div><div><strong>Need a hand?</strong><p>Send a note to your onboarding team and HR will follow up.</p></div></div><button className="button-secondary" onClick={() => { setSent(false); setIssueOpen(true) }}>Report an issue</button></div>
    {sent && <div className="inline-success" role="status"><Check size={16} />Your note was sent to the onboarding team.</div>}
    {issueOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setIssueOpen(false) }}><section className="hire-wizard issue-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-title"><div className="wizard-top"><div><span className="eyebrow">CONTACT YOUR TEAM</span><h2 id="issue-title">What do you need help with?</h2></div></div><p className="issue-intro">Your message will be shared with HR so they can help you.</p><label className="issue-message-label" htmlFor="issue-message">Message</label><textarea id="issue-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={500} rows={5} placeholder="Tell us what’s getting in the way…" /><div className="issue-dialog-foot"><span>{message.length}/500</span><div><button className="button-secondary" onClick={() => setIssueOpen(false)}>Cancel</button><button className="button-primary" disabled={message.trim().length < 8 || issueMutation.isPending} onClick={() => issueMutation.mutate(message.trim())}><Send size={15} />{issueMutation.isPending ? 'Sending…' : 'Send to HR'}</button></div></div>{issueMutation.isError && <p className="form-error" role="alert">Your message couldn’t be sent. Please try again.</p>}</section></div>}
  </div>
}
