import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Mail, RefreshCw, Send } from 'lucide-react'
import {
  getEmployeeCommunications,
  markEmployeeEmailSent,
  queueJoiningConfirmation,
  queueJoiningDelay,
  retryEmployeeEmail,
  updateHireDetails,
  type EmployeeCommunication,
  type EmployeeMailActionResult,
} from '../api/client'

function formatDate(value: string | null) {
  if (!value) return 'Date not set'
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function mailtoHref(message: Pick<EmployeeMailActionResult, 'recipient' | 'subject' | 'body'>) {
  return `mailto:${encodeURIComponent(message.recipient)}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`
}

export default function EmployeeCommunicationsPage() {
  const queryClient = useQueryClient()
  const [revisedDates, setRevisedDates] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [emailValues, setEmailValues] = useState<Record<string, string>>({})
  const [draftToOpen, setDraftToOpen] = useState<EmployeeMailActionResult | null>(null)
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
    onSuccess: result => {
      setActionError('')
      setDraftToOpen(result.status === 'queued' ? result : null)
      setNotice(result.status === 'sent' ? 'Joining confirmation was delivered by the configured mail service.' : 'Email draft is ready. Open it, send it from your mail app, then mark it sent here.')
      refresh()
    },
    onError: () => { setNotice(''); setActionError('Could not queue the confirmation. Check the employee record and try again.') },
  })
  const delay = useMutation({
    mutationFn: ({ hireId, revisedJoiningDate, reason }: { hireId: string; revisedJoiningDate: string; reason: string }) =>
      queueJoiningDelay(hireId, { revised_joining_date: revisedJoiningDate, reason }),
    onSuccess: result => {
      setActionError('')
      setDraftToOpen(result.status === 'queued' ? result : null)
      setNotice(result.status === 'sent' ? 'The delay notice was delivered by the configured mail service.' : 'Delay email draft is ready. Send it from your mail app, then mark it sent here.')
      refresh()
    },
    onError: () => { setNotice(''); setActionError('Could not save the revised date or queue the notice. Choose a future business day and try again.') },
  })
  const retry = useMutation({
    mutationFn: retryEmployeeEmail,
    onSuccess: result => { setActionError(''); setNotice(result.status === 'sent' ? 'The email was delivered.' : 'The email remains queued. Configure SMTP delivery, then retry.'); refresh() },
    onError: () => { setNotice(''); setActionError('The queued email could not be retried.') },
  })
  const markSent = useMutation({
    mutationFn: markEmployeeEmailSent,
    onSuccess: () => { setActionError(''); setNotice('Email marked as sent.'); refresh() },
    onError: () => { setNotice(''); setActionError('Could not update the email status.') },
  })
  const saveEmail = useMutation({
    mutationFn: ({ hireId, email }: { hireId: string; email: string }) => updateHireDetails(hireId, { work_email: email.trim() }),
    onSuccess: () => { setActionError(''); setNotice('Employee email address saved.'); refresh() },
    onError: () => { setNotice(''); setActionError('Could not save the email. Check that it is a valid address.') },
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
      <p><strong>HR manages these messages.</strong> Add the employee’s email here. Confirmation is available after all tasks are accepted. If the joining date arrives before onboarding is ready, HR chooses a revised date and sends the delay notice. If SMTP is unavailable, open the prepared email in your mail app and mark it sent here.</p>
    </div>

    <div className="queue-stats communication-stats">
      <div><strong>{people.length}</strong><span>Active employees</span></div>
      <div><strong>{waiting.length}</strong><span>Need HR attention</span></div>
      <div><strong>{people.reduce((total, person) => total + person.messages.length, 0)}</strong><span>Messages in history</span></div>
    </div>

    {notice && <div className="inline-success" role="status"><CheckCircle2 size={16} />{notice}{draftToOpen && <><a className="text-action" href={mailtoHref(draftToOpen)}>Open email draft</a><button className="text-action" disabled={markSent.isPending} onClick={() => markSent.mutate(draftToOpen.message_id)}>I sent it</button></>}</div>}
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
            emailValue={emailValues[person.hire_id] ?? person.work_email ?? ''}
            busy={confirmation.isPending || delay.isPending || retry.isPending || markSent.isPending || saveEmail.isPending}
            onDate={value => setRevisedDates(current => ({ ...current, [person.hire_id]: value }))}
            onReason={value => setReasons(current => ({ ...current, [person.hire_id]: value }))}
            onEmail={value => setEmailValues(current => ({ ...current, [person.hire_id]: value }))}
            onSaveEmail={() => {
              const email = (emailValues[person.hire_id] ?? '').trim()
              if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setActionError('Enter a valid employee email address first.')
                return
              }
              setNotice(''); setActionError(''); saveEmail.mutate({ hireId: person.hire_id, email })
            }}
            onConfirmation={() => { setNotice(''); setActionError(''); confirmation.mutate(person.hire_id) }}
            onDelay={() => submitDelay(person)}
            onRetry={messageId => { setNotice(''); setActionError(''); retry.mutate(messageId) }}
            onMarkSent={messageId => { setNotice(''); setActionError(''); markSent.mutate(messageId) }}
          />)}
        </section>}
  </div>
}

function CommunicationCard({
  person, revisedDate, reason, emailValue, busy, onDate, onReason, onEmail, onSaveEmail, onConfirmation, onDelay, onRetry, onMarkSent,
}: {
  person: EmployeeCommunication; revisedDate: string; reason: string; emailValue: string; busy: boolean
  onDate: (value: string) => void; onReason: (value: string) => void; onEmail: (value: string) => void; onSaveEmail: () => void
  onConfirmation: () => void; onDelay: () => void; onRetry: (messageId: string) => void; onMarkSent: (messageId: string) => void
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
    <div className="communication-recipient"><Mail size={14} /><span>{person.work_email ?? 'Work email not added'}</span></div>
    {!person.work_email && <div className="communication-email-editor"><label>Employee work email<input type="email" value={emailValue} onChange={event => onEmail(event.target.value)} placeholder="name@company.com" disabled={busy} /></label><button className="button-secondary" disabled={busy} onClick={onSaveEmail}>Save email</button></div>}

    {person.confirmation_available && <div className="communication-action-panel">
      <div><strong>All onboarding tasks are accepted.</strong><p>Send the joining confirmation to the employee’s work email.</p></div>
      <button className="button-primary" disabled={busy || !person.work_email} onClick={onConfirmation}><Send size={15} />Send confirmation</button>
    </div>}
    {ready && person.confirmation_status == null && !person.work_email && <p className="communication-waiting">The employee is ready, but HR must add a work email before sending the confirmation.</p>}

    {person.delay_required && <div className="communication-action-panel delay-action-panel">
      <div><strong>Onboarding is incomplete on the planned joining date.</strong><p>HR chooses a new date and sends the employee a delay notice.</p></div>
      <div className="delay-notice-form"><label>Revised joining date<input type="date" value={revisedDate} onChange={event => onDate(event.target.value)} disabled={busy || !person.work_email} /></label><label>Reason for delay<textarea value={reason} onChange={event => onReason(event.target.value)} minLength={8} maxLength={600} rows={2} placeholder="Explain the remaining onboarding work" disabled={busy || !person.work_email} /></label><button className="button-primary" disabled={busy || !person.work_email} onClick={onDelay}><Send size={15} />Save date & send notice</button></div>
    </div>}

    {!person.confirmation_available && !person.delay_required && person.confirmation_status == null && !ready && <p className="communication-waiting">No email action is due yet. HR will be notified if the joining date arrives before onboarding is complete.</p>}
    {person.confirmation_status === 'queued' && <p className="communication-waiting">Confirmation is waiting in the outbox. Open its draft below, send it from your mail app, then mark it sent.</p>}
    {person.messages.length > 0 && <details className="communication-history"><summary>Message history ({person.messages.length})</summary><div>{person.messages.map(message => <article key={message.id}><strong>{message.subject}</strong><span>{message.status === 'sent' ? 'Sent' : 'Queued in outbox'} · {new Date(message.created_at).toLocaleString()}</span>{message.status === 'queued' && <><a className="text-action" href={mailtoHref(message)}>Open draft</a><button className="text-action" disabled={busy} onClick={() => onMarkSent(message.id)}>I sent it</button><button className="text-action" disabled={busy} onClick={() => onRetry(message.id)}>Retry SMTP</button></>}</article>)}</div></details>}
  </article>
}
