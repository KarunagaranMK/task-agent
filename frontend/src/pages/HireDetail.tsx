import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Activity, ArrowLeft, CalendarDays, Check, CircleHelp, Clock3, GitBranch, LayoutDashboard, ListTodo, Pause, Pencil, Play, ShieldCheck, Sparkles, X } from 'lucide-react'
import { approveTask, cancelHire, explainRisk, getHire, getHireAudit, getHireTasks, getManagers, pauseHire, rejectTask, resumeHire, runWhatIf, updateHireDetails, type AuditEvent, type Hire, type HireUpdate, type Task, type WhatIfResult } from '../api/client'
import { useRole } from '../App'
import { DependencyGraph, ScheduleTimeline } from '../components/TaskVisualizations'

type Tab = 'overview' | 'schedule' | 'graph' | 'tasks' | 'what-if' | 'activity'
type ScheduledTask = Task & { dispatched_day: number | null; schedule_start_day: number | null; schedule_finish_day: number | null }
type HireEditForm = { name: string; department: string; managerId: string; startDate: string }
const statusText: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', ready: 'Ready', paused: 'Paused', cancelled: 'Cancelled' }
const statusClass: Record<string, string> = { on_track: 'on_track', at_risk: 'at_risk', ready: 'ready', paused: 'warning', cancelled: 'neutral' }
const taskStatusClass: Record<string, string> = { done: 'ready', dispatched: 'on_track', pending: 'neutral', awaiting_approval: 'warning', queued: 'warning', blocked: 'at_risk', paused: 'warning', cancelled: 'neutral' }
const displayDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : null
const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'graph', label: 'Graph', icon: GitBranch }, { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'what-if', label: 'What-if', icon: CircleHelp }, { id: 'activity', label: 'Activity', icon: Activity },
]

export default function HireDetail() {
  const { id } = useParams<{ id: string }>()
  const hireId = Number(id)
  const { role } = useRole()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [explanation, setExplanation] = useState('')
  const [explainSource, setExplainSource] = useState('')
  const [scenarioTask, setScenarioTask] = useState('')
  const [delay, setDelay] = useState(0)
  const [scenario, setScenario] = useState<WhatIfResult | null>(null)
  const [cancelDialog, setCancelDialog] = useState(false)
  const [cancelConfirmation, setCancelConfirmation] = useState('')
  const [editDialog, setEditDialog] = useState(false)
  const [editForm, setEditForm] = useState<HireEditForm>({ name: '', department: '', managerId: '', startDate: '' })
  const [editError, setEditError] = useState('')
  const [actionError, setActionError] = useState('')
  const [retryAction, setRetryAction] = useState<'pause' | 'resume' | 'cancel'>('pause')
  const hireQuery = useQuery<Hire>({ queryKey: ['hire', hireId], queryFn: () => getHire(hireId), refetchInterval: 5000, enabled: Number.isInteger(hireId) && hireId > 0 })
  const tasksQuery = useQuery<Task[]>({ queryKey: ['hire-tasks', hireId], queryFn: () => getHireTasks(hireId), refetchInterval: 5000, enabled: Number.isInteger(hireId) && hireId > 0 })
  const auditQuery = useQuery<AuditEvent[]>({ queryKey: ['hire-audit', hireId], queryFn: () => getHireAudit(hireId), refetchInterval: 5000, enabled: Number.isInteger(hireId) && hireId > 0 })
  const { data: managers = [] } = useQuery({ queryKey: ['managers'], queryFn: getManagers, enabled: ['ADMIN', 'HR'].includes(role) })
  const hire = hireQuery.data
  const tasks = tasksQuery.data ?? []
  const scheduledTasks: ScheduledTask[] = tasks.map(task => ({ ...task, dispatched_day: task.dispatched_day ?? null, schedule_start_day: task.schedule_start_day ?? null, schedule_finish_day: task.schedule_finish_day ?? null }))
  const audit = auditQuery.data ?? []
  const currentDay = scheduledTasks[0]?.current_day ?? 0
  const criticalTasks = tasks.filter(task => task.critical && !['done', 'paused', 'cancelled'].includes(task.status))
  const approveMutation = useMutation({ mutationFn: approveTask, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['hire-tasks', hireId] }); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) } })
  const rejectMutation = useMutation({ mutationFn: rejectTask, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['hire-tasks', hireId] }); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) } })
  const scenarioMutation = useMutation({ mutationFn: ({ key, days }: { key: string; days: number }) => runWhatIf(hireId, key, days), onSuccess: setScenario })
  const editMutation = useMutation({
    mutationFn: (data: HireUpdate) => updateHireDetails(hireId, data),
    onSuccess: updated => {
      setEditDialog(false); setEditError('')
      void queryClient.setQueryData(['hire', hireId], updated)
      void queryClient.invalidateQueries({ queryKey: ['hire-tasks', hireId] })
      void queryClient.invalidateQueries({ queryKey: ['hire-audit', hireId] })
      void queryClient.invalidateQueries({ queryKey: ['hires'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
    },
    onError: () => setEditError('We couldn’t save these changes. Check the joining date and manager, then try again.'),
  })
  const lifecycleMutation = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel') => action === 'pause' ? pauseHire(hireId) : action === 'resume' ? resumeHire(hireId) : cancelHire(hireId),
    onSuccess: () => {
      setCancelDialog(false)
      setCancelConfirmation('')
      setActionError('')
      void queryClient.invalidateQueries({ queryKey: ['hire', hireId] })
      void queryClient.invalidateQueries({ queryKey: ['hire-tasks', hireId] })
      void queryClient.invalidateQueries({ queryKey: ['hire-audit', hireId] })
      void queryClient.invalidateQueries({ queryKey: ['hires'] })
    },
    onError: (_, action) => {
      setRetryAction(action)
      setActionError('The onboarding status could not be updated. Check the connection and retry; any successfully cancelled tickets have been recorded.')
    }
  })

  useEffect(() => {
    if (!scenarioTask || tab !== 'what-if') return
    const timer = window.setTimeout(() => scenarioMutation.mutate({ key: scenarioTask, days: delay }), 300)
    return () => window.clearTimeout(timer)
  }, [scenarioTask, delay, hireId, tab])

  if (hireQuery.isLoading) return <main className="hire-detail-page"><div className="page-skeleton" aria-label="Loading hire details"><span /></div></main>
  if (hireQuery.isError || !hire) return <main className="hire-detail-page"><section className="empty-state"><h1>Hire details unavailable</h1><p>We couldn’t load this onboarding plan. Check your access or try again.</p><button className="button-secondary" onClick={() => void hireQuery.refetch()}>Retry</button><Link to="/" className="text-action">Return to overview</Link></section></main>

  const readyDay = hire.projected_day ?? hire.start_day
  const joiningDate = displayDate(hire.start_date)
  const projectedDate = displayDate(hire.projected_ready_date ?? hire.start_date)
  return <main className="hire-detail-page">
    <div className="hire-breadcrumb"><Link to="/" aria-label="Back to hire portfolio"><ArrowLeft size={15} /> Hire portfolio</Link><span>/</span><span>{hire.name}</span></div>
    <header className="hire-hero"><div className="hire-hero-heading"><div><span className="eyebrow">ONBOARDING PLAN · #{hire.id}</span><h1>{hire.name}</h1><p>{hire.role} <span>·</span> {hire.department}</p></div><div className="hire-hero-actions"><span className={`status-pill ${statusClass[hire.status] ?? 'neutral'}`}><i />{statusText[hire.status] ?? hire.status}</span>{['ADMIN', 'HR'].includes(role) && <div className="lifecycle-actions"> <button className="button-secondary" onClick={() => { setEditForm({ name: hire.name, department: hire.department, managerId: hire.manager_id ? String(hire.manager_id) : '', startDate: hire.start_date ?? '' }); setEditError(''); setEditDialog(true) }}><Pencil size={14} />Edit details</button>{!['ready', 'cancelled'].includes(hire.status) && <>{hire.status === 'paused' ? <button className="button-secondary" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate('resume')}><Play size={14} /> Resume</button> : <button className="button-secondary" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate('pause')}><Pause size={14} /> Pause</button>}<button className="button-danger" disabled={lifecycleMutation.isPending} onClick={() => { setCancelConfirmation(''); setCancelDialog(true) }}><X size={14} /> Cancel plan</button></>}</div>}</div></div>
      {actionError && !cancelDialog && <p className="form-error" role="alert">{actionError}<button className="text-action" onClick={() => { setActionError(''); lifecycleMutation.mutate(retryAction) }}>Retry</button></p>}
      <div className="hire-kpis"><article className="hire-readiness-kpi"><div className="readiness-donut" style={{ '--readiness': `${hire.readiness}%` } as CSSProperties}><span>{Math.round(hire.readiness)}<small>%</small></span></div><div><span>Day-1 readiness</span><strong>{hire.readiness >= 100 ? 'Plan complete' : `${tasks.filter(task => task.status === 'done').length} of ${tasks.length} tasks complete`}</strong></div></article>
        <article><span>Joining target</span><strong>{joiningDate ?? `Day ${hire.start_day}`}</strong><small>Day {hire.start_day} in the demo calendar</small></article>
        <article><span>Projected ready</span><strong className={readyDay > hire.start_day ? 'text-risk' : ''}>{projectedDate ?? `Day ${readyDay}`}</strong><small>{readyDay > hire.start_day ? `${readyDay - hire.start_day} business days after joining` : 'On or before the joining date'}</small></article>
        <article><span>Critical tasks</span><strong>{criticalTasks.length}</strong><small>{criticalTasks.length ? 'Remaining on the critical path' : 'No remaining critical blockers'}</small></article>
      </div>
      <div className="hire-progress-track" role="progressbar" aria-label="Day-1 readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hire.readiness)}><i style={{ width: `${Math.max(0, Math.min(100, hire.readiness))}%` }} /></div>
    </header>
    <nav className="hire-tabs" aria-label="Hire detail sections">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={15} />{item.label}{item.id === 'tasks' && <span>{tasks.length}</span>}</button> })}</nav>

    {hire.status === 'paused' && <div className="hire-state-banner paused-banner" role="status"><Pause size={18} /><div><strong>Onboarding is paused</strong><p>Open work is held and the schedule monitor will resume when you restart this plan.</p></div></div>}{hire.status === 'cancelled' && <div className="hire-state-banner cancelled-banner" role="status"><X size={18} /><div><strong>Onboarding was cancelled</strong><p>This plan is closed. Completed work is retained in the activity history.</p></div></div>}
    {tab === 'overview' && <div className="hire-overview-grid"><section className="hire-panel hire-risk-panel"><div className="panel-title"><span className="panel-icon"><Sparkles size={17} /></span><div><h2>Readiness briefing</h2><p>A clear summary of what is affecting Day 1.</p></div></div><p className="risk-explanation">{explanation || (hire.status === 'ready' ? `${hire.name} has completed the onboarding plan and is ready for Day 1.` : hire.status === 'paused' ? `${hire.name}’s onboarding is paused. Resume it when teams are ready to continue.` : hire.status === 'cancelled' ? `${hire.name}’s onboarding plan has been cancelled.` : criticalTasks.length ? `${criticalTasks[0].title} is on the critical path. ${criticalTasks.length} key ${criticalTasks.length === 1 ? 'task is' : 'tasks are'} still open.` : 'Work is progressing across IT, HR, and Facilities. The forecast updates as each team completes its tasks.')}</p><button className="button-secondary" onClick={() => explainRisk(hireId).then(result => { setExplanation(result.explanation); setExplainSource(result.source ?? 'template') }).catch(() => { setExplanation('The explanation is temporarily unavailable. Please try again.'); setExplainSource('') })}><Sparkles size={15} />{explanation ? 'Refresh explanation' : 'Why is this at risk?'}</button>{explainSource && <small className="explanation-source">Explanation source: {explainSource === 'llm' ? 'AI suggestion' : 'onboarding template'}</small>}</section>
      <section className="hire-panel"><div className="panel-title"><span className="panel-icon"><ShieldCheck size={17} /></span><div><h2>Next actions</h2><p>Move the work with the biggest schedule impact.</p></div></div>{criticalTasks.length ? <div className="next-action-list">{criticalTasks.slice(0, 3).map(task => <article key={task.id}><span className="next-action-dot" /><div><strong>{task.title}</strong><small>{task.team} · {task.status.replace(/_/g, ' ')} · {task.remaining_days} days remaining</small></div><button className="text-action" onClick={() => setTab('tasks')}>View</button></article>)}</div> : hire.status === 'paused' ? <div className="success-callout"><Pause size={17} />Work is paused. Resume the plan when teams are ready.</div> : hire.status === 'cancelled' ? <div className="success-callout"><X size={17} />This onboarding plan is closed.</div> : <div className="success-callout"><Check size={17} />All remaining work is on track for the joining target.</div>}</section>
      <section className="hire-panel hire-overview-schedule"><div className="panel-title"><span className="panel-icon"><CalendarDays size={17} /></span><div><h2>Schedule snapshot</h2><p>{tasks.filter(task => task.status !== 'done').length} open tasks across {new Set(tasks.map(task => task.team)).size} teams.</p></div></div><ScheduleTimeline tasks={scheduledTasks} dayOne={hire.start_day} currentDay={currentDay} /></section>
    </div>}
    {tab === 'schedule' && <ScheduleTimeline tasks={scheduledTasks} dayOne={hire.start_day} currentDay={currentDay} />}
    {tab === 'graph' && <DependencyGraph tasks={scheduledTasks} />}
    {tab === 'tasks' && <section className="hire-panel"><div className="panel-title"><span className="panel-icon"><ListTodo size={17} /></span><div><h2>Task plan</h2><p>Dependencies, ownership, approval, and live schedule slack.</p></div></div>{tasksQuery.isError ? <p role="alert">Tasks could not be loaded. <button className="text-action" onClick={() => void tasksQuery.refetch()}>Retry</button></p> : <div className="hire-task-table-wrap"><table className="hire-task-table"><thead><tr><th>Task</th><th>Team</th><th>Status</th><th>Remaining</th><th>Slack</th><th>Actions</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id} className={`${task.critical ? 'critical-row' : ''} ${task.flag === 'watch' || task.flag === 'escalated' ? 'stalled-row' : ''}`}><td><strong>{task.title}</strong>{task.depends_on.length > 0 && <small>After {task.depends_on.join(', ')}</small>}{task.ticket_id && <small className="ticket-id">{task.ticket_id}</small>}</td><td>{task.team}</td><td><span className={`status-pill ${taskStatusClass[task.status] ?? 'neutral'}`}><i />{task.status.replace(/_/g, ' ')}</span>{task.flag !== 'none' && <small className="task-flag">{task.flag}</small>}</td><td>{task.status === 'done' ? 'Complete' : `${task.remaining_days} days`}</td><td>{task.slack === null ? '—' : `${task.slack.toFixed(1)} days`}{task.critical && <small className="critical-label">Critical path</small>}</td><td>{task.status === 'awaiting_approval' && role === 'MANAGER' ? <div className="table-actions"><button className="button-approve" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(task.id)}>Approve</button><button className="button-reject" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate(task.id)}>Reject</button></div> : <button className="text-action" onClick={() => setTab('graph')}>Explore dependencies</button>}</td></tr>)}</tbody></table></div>}{(approveMutation.isError || rejectMutation.isError) && <p className="form-error" role="alert">That approval could not be saved. Refresh the plan and try again.</p>}</section>}
    {tab === 'what-if' && <section className="hire-panel what-if-panel"><div className="panel-title"><span className="panel-icon"><Clock3 size={17} /></span><div><h2>Schedule what-if</h2><p>Recalculate the critical path after adding a delay to one open task. Live work is unchanged.</p></div></div><div className="what-if-form"><label>Task to delay<select value={scenarioTask} onChange={event => { setScenarioTask(event.target.value); setScenario(null) }}><option value="">Choose an open task</option>{tasks.filter(task => !['done', 'blocked', 'paused', 'cancelled'].includes(task.status)).map(task => <option key={task.key} value={task.key}>{task.title}</option>)}</select></label><label className="what-if-range">Added delay <strong>{delay} business {delay === 1 ? 'day' : 'days'}</strong><input type="range" min={0} max={10} step={1} value={delay} onChange={event => { setDelay(Number(event.target.value)); setScenario(null) }} /></label></div>{scenarioMutation.isPending && <p className="schedule-computing" role="status">Recomputing schedule…</p>}{scenario && <div className="what-if-result"><article><span>Baseline finish</span><strong>Day {scenario.baseline_ready_day}</strong></article><article><span>Projected finish</span><strong>Day {scenario.projected_ready_day}</strong></article><article><span>Schedule change</span><strong className={scenario.delta_days > 0 ? 'text-risk' : 'text-positive'}>{scenario.delta_days > 0 ? '+' : ''}{scenario.delta_days} days</strong></article><div><span>Critical path</span><strong>{scenario.critical_path.join('  →  ') || 'No remaining tasks'}</strong></div></div>}{scenarioMutation.isError && <p className="form-error" role="alert">Select an open task and try again.</p>}</section>}
    {tab === 'activity' && <section className="hire-panel"><div className="panel-title"><span className="panel-icon"><Activity size={17} /></span><div><h2>Activity timeline</h2><p>Decisions and orchestration events for this hire.</p></div></div><div className="hire-activity-list" tabIndex={0} role="region" aria-label="Hire activity timeline">{audit.length ? [...audit].reverse().map(event => <article key={event.id}><span className={`activity-marker ${event.level}`} /><div><strong>{event.message}</strong><small>{event.actor} · simulation day {event.day}{event.created_at ? ` · ${new Date(event.created_at).toLocaleString()}` : ''}</small></div><span className="activity-level">{event.level}</span></article>) : <div className="empty-state"><Activity size={20} /><p>No activity yet. Start the monitor to coordinate this plan.</p></div>}</div></section>}
    {editDialog && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditDialog(false) }}><form className="hire-wizard hire-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-hire-title" onSubmit={event => { event.preventDefault(); const data: HireUpdate = { name: editForm.name.trim(), department: editForm.department.trim(), manager_id: editForm.managerId ? Number(editForm.managerId) : null }; if (editForm.startDate && editForm.startDate !== hire.start_date && !['ready', 'cancelled', 'paused'].includes(hire.status)) data.start_date = editForm.startDate; editMutation.mutate(data) }}><div className="wizard-top"><div><span className="eyebrow">HIRE DETAILS</span><h2 id="edit-hire-title">Edit {hire.name}</h2></div><button type="button" className="icon-button wizard-close" onClick={() => setEditDialog(false)} aria-label="Close edit hire"><X size={18} /></button></div><div className="wizard-fields hire-edit-fields"><label>Full name<input required minLength={2} maxLength={120} value={editForm.name} onChange={event => setEditForm(current => ({ ...current, name: event.target.value }))} /></label><label>Role<input value={hire.role} readOnly /><small>The role stays linked to this plan’s generated tasks.</small></label><label>Department<input required maxLength={120} value={editForm.department} onChange={event => setEditForm(current => ({ ...current, department: event.target.value }))} /></label><label>Manager<select value={editForm.managerId} onChange={event => setEditForm(current => ({ ...current, managerId: event.target.value }))}><option value="">Unassigned</option>{hire.manager_id && !managers.some(manager => manager.id === hire.manager_id) && <option value={hire.manager_id}>Current manager unavailable</option>}{managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label><label>Joining date<input type="date" required value={editForm.startDate} disabled={['ready', 'cancelled', 'paused'].includes(hire.status)} onChange={event => setEditForm(current => ({ ...current, startDate: event.target.value }))} /><small>{['ready', 'cancelled', 'paused'].includes(hire.status) ? 'Resume this plan before changing its joining date.' : 'Must be a future business day in the organization calendar.'}</small></label></div>{editError && <p className="form-error" role="alert">{editError}</p>}<div className="wizard-actions"><button type="button" className="button-secondary" onClick={() => setEditDialog(false)}>Cancel</button><button className="button-primary" disabled={editMutation.isPending}>{editMutation.isPending ? 'Saving details…' : 'Save details'}</button></div></form></div>}
    {cancelDialog && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCancelDialog(false) }}><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-plan-title"><span className="dialog-icon danger"><X size={18} /></span><h2 id="cancel-plan-title">Cancel {hire.name}’s onboarding?</h2><p>Open tickets will be cancelled and remaining tasks will close. Completed work and the activity history will be kept.</p><label className="cancel-confirm-label">Type <strong>{hire.name}</strong> to confirm<input autoFocus value={cancelConfirmation} onChange={event => setCancelConfirmation(event.target.value)} /></label>{lifecycleMutation.isError && <p className="form-error" role="alert">{actionError}</p>}<div className="dialog-actions"><button className="button-secondary" onClick={() => { setCancelDialog(false); setCancelConfirmation('') }}>Keep plan</button><button className="button-danger" disabled={lifecycleMutation.isPending || cancelConfirmation.trim() !== hire.name} onClick={() => lifecycleMutation.mutate('cancel')}>{lifecycleMutation.isPending ? 'Cancelling…' : 'Cancel onboarding'}</button></div></section></div>}
  </main>
}
