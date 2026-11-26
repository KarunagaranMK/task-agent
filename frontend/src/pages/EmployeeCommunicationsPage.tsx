import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Mail, RefreshCw, Send } from 'lucide-react'
import {
  getEmployeeCommunications,
  queueJoiningConfirmation,
  queueJoiningDelay,
  retryEmployeeEmail,
  type EmployeeCommunication,
} from '../api/client'

function formatDate(value: string | null) {
  if (!value) return 'Date not set'
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function EmployeeCommunicationsPage() {
  const queryClient = useQueryClient()
  const [revisedDates, setRevisedDates] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const communications = useQuery({
    queryKey: ['employee-communications'],
    queryFn: getEmployeeCommunications,
    refetchInterval: 15_000,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['employee-communications'] })
    void queryClient.invalidateQueries({ queryKey: ['hires'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  }
  const confirmation = useMutation({
    mutationFn: queueJoiningConfirmation,
    onSuccess: () => { setActionError(''); setNotice('Joining confirmation was added to the mail outbox.'); refresh() },
    onError: () => { setNotice(''); setActionError('Could not queue the confirmation. Check the employee record and try again.') },
  })
  const delay = useMutation({
    mutationFn: ({ hireId, revisedJoiningDate, reason }: { hireId: string; revisedJoiningDate: string; reason: string }) =>
      queueJoiningDelay(hireId, { revised_joining_date: revisedJoiningDate, reason }),
    onSuccess: () => { setActionError(''); setNotice('The revised joining date was saved and the delay notice was added to the mail outbox.'); refresh() },
    onError: () => { setNotice(''); setActionError('Could not save the revised date or queue the notice. Choose a future business day and try again.') },
  })
  const retry = useMutation({
    mutationFn: retryEmployeeEmail,
    onSuccess: result => { setActionError(''); setNotice(result.status === 'sent' ? 'The email was delivered.' : 'The email remains queued. Configure SMTP delivery, then retry.'); refresh() },
    onError: () => { setNotice(''); setActionError('The queued email could not be retried.') },
  })
  const people = communications.data ?? []
  const waiting = people.filter(person => person.confirmation_available || person.delay_required)

  const submitDelay = (person: EmployeeCommunication) => {
    const revisedJoiningDate = revisedDates[person.hire_id] ?? ''
    const reason = reasons[person.hire_id]?.trim() ?? ''
    if (!revisedJoiningDate || reason.length < 8) {
      setActionError('Choose a revised joining date and explain the delay in at least 8 characters.')
      return
    }
    setNotice('')
    setActionError('')
    delay.mutate({ hireId: person.hire_id, revisedJoiningDate, reason })
  }

  return <div className="portal-page employee-communications-page">
    <div className="page-heading-row">
      <div><span className="eyebrow">HR WORKSPACE</span><h1>Employee communications</h1><p>Review onboarding readiness and manage joining-date emails for employees.</p></div>
      <button className="button-secondary" onClick={() => void communications.refetch()} disabled={communications.isFetching}><RefreshCw size={15} />Refresh</button>
    </div>

    <div className="communication-policy content-card">
      <Mail size={18} />
      <p><strong>HR manages these messages.</strong> Confirmation is available after all tasks are accepted. If the joining date arrives before onboarding is ready, HR chooses a revised date and sends the delay notice. Without SMTP settings, messages stay queued in the local mail outbox.</p>
    </div>

    <div className="queue-stats communication-stats">
      <div><strong>{people.length}</strong><span>Active employees</span></div>
      <div><strong>{waiting.length}</strong><span>Need HR attention</span></div>
      <div><strong>{people.reduce((total, person) => total + person.messages.length, 0)}</strong><span>Messages in history</span></div>
    </div>

    {notice && <div className="inline-success" role="status"><CheckCircle2 size={16} />{notice}</div>}
    {actionError && <div className="action-error" role="alert"><AlertCircle size={16} />{actionError}</div>}
    {communications.isLoading ? <div className="table-skeleton" role="status" aria-label="Loading employee communications"><span /><span /></div> : communications.isError ?
      <div className="empty-state"><AlertCircle size={25} /><h2>Employee communication data is unavailable</h2><p>Check the service connection and try again.</p><button className="button-secondary" onClick={() => void communications.refetch()}>Retry</button></div> : people.length === 0 ?
        <div className="empty-state"><Mail size={25} /><h2>No employee records yet</h2><p>Employee messages will appear after HR creates an onboarding plan.</p></div> :
        <section className="employee-communication-list" aria-label="Employee email actions">
          {people.map(person => <CommunicationCard
            key={person.hire_id}
            person={person}
            revisedDate={revisedDates[person.hire_id] ?? ''}
            reason={reasons[person.hire_id] ?? ''}
            busy={confirmation.isPending || delay.isPending || retry.isPending}
            onDate={value => setRevisedDates(current => ({ ...current, [person.hire_id]: value }))}
            onReason={value => setReasons(current => ({ ...current, [person.hire_id]: value }))}
            onConfirmation={() => { setNotice(''); setActionError(''); confirmation.mutate(person.hire_id) }}
            onDelay={() => submitDelay(person)}
            onRetry={messageId => { setNotice(''); setActionError(''); retry.mutate(messageId) }}
          />)}
        </section>}
  </div>
}

function CommunicationCard({
  person, revisedDate, reason, busy, onDate, onReason, onConfirmation, onDelay, onRetry,
}: {
  person: EmployeeCommunication; revisedDate: string; reason: string; busy: boolean
  onDate: (value: string) => void; onReason: (value: string) => void; onConfirmation: () => void; onDelay: () => void; onRetry: (messageId: string) => void
}) {
  const ready = person.readiness >= 100
  const title = person.confirmation_status === 'sent' ? 'Confirmation sent'
    : person.confirmation_status === 'queued' ? 'Confirmation in mail outbox'
      : person.delay_required ? 'Joining date needs review'
        : ready ? 'Ready for HR confirmation' : 'Onboarding in progress'
  const statusClass = person.delay_required ? 'needs-action' : ready ? 'is-ready' : 'in-progress'

  return <article className="employee-communication-card content-card">
    <div className="employee-communication-head">
      <div><span className="eyebrow">{person.department}</span><h2>{person.name}</h2><p>{person.role} · Joining date {formatDate(person.joining_date)}</p></div>
      <span className={`communication-status ${statusClass}`}>{person.delay_required ? <CalendarClock size={14} /> : ready ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{title}</span>
    </div>
    <div className="communication-progress"><div><span>Onboarding completion</span><strong>{person.readiness}%</strong></div><span className="readiness-track"><i style={{ width: `${Math.max(0, Math.min(100, person.readiness))}%` }} /></span></div>
    <div className="communication-recipient"><Mail size={14} /><span>{person.work_email ?? 'Work email not added'}</span>{!person.work_email && <Link to={`/hire/${person.hire_id}`}>Update employee record</Link>}</div>

    {person.confirmation_available && <div className="communication-action-panel">
      <div><strong>All onboarding tasks are accepted.</strong><p>Review the joining date, then place the confirmation email in the outbox.</p></div>
      <button className="button-primary" disabled={busy || !person.work_email} onClick={onConfirmation}><Send size={15} />Queue confirmation</button>
    </div>}
    {ready && person.confirmation_status == null && !person.work_email && <p className="communication-waiting">The employee is ready, but HR must add a work email before sending the confirmation.</p>}

    {person.delay_required && <div className="communication-action-panel delay-action-panel">
      <div><strong>Onboarding is incomplete on the planned joining date.</strong><p>HR must choose a new date and explain the delay before queuing the employee notice.</p></div>
      <div className="delay-notice-form"><label>Revised joining date<input type="date" value={revisedDate} onChange={event => onDate(event.target.value)} disabled={busy || !person.work_email} /></label><label>Reason for delay<textarea value={reason} onChange={event => onReason(event.target.value)} minLength={8} maxLength={600} rows={2} placeholder="Explain the remaining onboarding work" disabled={busy || !person.work_email} /></label><button className="button-primary" disabled={busy || !person.work_email} onClick={onDelay}><Send size={15} />Save date & queue notice</button></div>
    </div>}

    {!person.confirmation_available && !person.delay_required && person.confirmation_status == null && !ready && <p className="communication-waiting">No email action is due yet. HR will be notified if the joining date arrives before onboarding is complete.</p>}
    {person.confirmation_status === 'queued' && <p className="communication-waiting">This message is queued in the app’s local demo outbox; it has not been delivered by an external email service.</p>}
    {person.messages.length > 0 && <details className="communication-history"><summary>Message history ({person.messages.length})</summary><div>{person.messages.map(message => <article key={message.id}><strong>{message.subject}</strong><span>{message.status === 'sent' ? 'Sent' : 'Queued in demo outbox'} · {new Date(message.created_at).toLocaleString()}</span>{message.status === 'queued' && <button className="text-action" disabled={busy} onClick={() => onRetry(message.id)}>Retry delivery</button>}</article>)}</div></details>}
  </article>
}
