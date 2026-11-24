import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Activity, ArrowLeft, CalendarDays, Check, CircleHelp, Clock3, GitBranch, LayoutDashboard, ListTodo, Pause, Play, ShieldCheck, Sparkles, X } from 'lucide-react'
import { approveTask, cancelHire, explainRisk, getHire, getHireAudit, getHireTasks, pauseHire, rejectTask, resumeHire, runWhatIf, type AuditEvent, type Hire, type Task, type WhatIfResult } from '../api/client'
import { useRole } from '../App'
import { DependencyGraph, ScheduleTimeline } from '../components/TaskVisualizations'

type Tab = 'overview' | 'schedule' | 'graph' | 'tasks' | 'what-if' | 'activity'
type ScheduledTask = Task & { dispatched_day: number | null; schedule_start_day: number | null; schedule_finish_day: number | null }
const statusText: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', ready: 'Ready', paused: 'Paused', cancelled: 'Cancelled' }
const statusClass: Record<string, string> = { on_track: 'on_track', at_risk: 'at_risk', ready: 'ready', paused: 'warning', cancelled: 'neutral' }
const taskStatusClass: Record<string, string> = { done: 'ready', dispatched: 'on_track', pending: 'neutral', awaiting_approval: 'warning', queued: 'warning', blocked: 'at_risk', paused: 'warning', cancelled: 'neutral' }
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
  const [actionError, setActionError] = useState('')
  const [retryAction, setRetryAction] = useState<'pause' | 'resume' | 'cancel'>('pause')
  const hireQuery = useQuery<Hire>({ queryKey: ['hire', hireId], queryFn: () => getHire(hireId), refetchInterval: 5000, enabled: Number.isInteger(hireId) && hireId > 0 })
  const tasksQuery = useQuery<Task[]>({ queryKey: ['hire-tasks', hireId], queryFn: () => getHireTasks(hireId), refetchInterval: 5000, enabled: Number.isInteger(hireId) && hireId > 0 })
  const auditQuery = useQuery<AuditEvent[]>({ queryKey: ['hire-audit', hireId], queryFn: () => getHireAudit(hireId), refetchInterval: 5000, enabled: Number.isInteger(hireId) && hireId > 0 })
  const hire = hireQuery.data
  const tasks = tasksQuery.data ?? []
  const scheduledTasks: ScheduledTask[] = tasks.map(task => ({ ...task, dispatched_day: task.dispatched_day ?? null, schedule_start_day: task.schedule_start_day ?? null, schedule_finish_day: task.schedule_finish_day ?? null }))
  const audit = auditQuery.data ?? []
  const currentDay = scheduledTasks[0]?.current_day ?? 0
  const criticalTasks = tasks.filter(task => task.critical && task.status !== 'done')
  const approveMutation = useMutation({ mutationFn: approveTask, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['hire-tasks', hireId] }); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) } })
  const rejectMutation = useMutation({ mutationFn: rejectTask, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['hire-tasks', hireId] }); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) } })
  const scenarioMutation = useMutation({ mutationFn: ({ key, days }: { key: string; days: number }) => runWhatIf(hireId, key, days), onSuccess: setScenario })
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
  return <main className="hire-detail-page">
    <div className="hire-breadcrumb"><Link to="/" aria-label="Back to hire portfolio"><ArrowLeft size={15} /> Hire portfolio</Link><span>/</span><span>{hire.name}</span></div>
    <header className="hire-hero"><div className="hire-hero-heading"><div><span className="eyebrow">ONBOARDING PLAN · #{hire.id}</span><h1>{hire.name}</h1><p>{hire.role} <span>·</span> {hire.department}</p></div><div className="hire-hero-actions"><span className={`status-pill ${statusClass[hire.status] ?? 'neutral'}`}><i />{statusText[hire.status] ?? hire.status}</span>{['ADMIN', 'HR'].includes(role) && !['ready', 'cancelled'].includes(hire.status) && <div className="lifecycle-actions">{hire.status === 'paused' ? <button className="button-secondary" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate('resume')}><Play size={14} /> Resume</button> : <button className="button-secondary" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate('pause')}><Pause size={14} /> Pause</button>}<button className="button-danger" disabled={lifecycleMutation.isPending} onClick={() => { setCancelConfirmation(''); setCancelDialog(true) }}><X size={14} /> Cancel plan</button></div>}</div></div>
      {actionError && !cancelDialog && <p className="form-error" role="alert">{actionError}<button className="text-action" onClick={() => { setActionError(''); lifecycleMutation.mutate(retryAction) }}>Retry</button></p>}
      <div className="hire-kpis"><article className="hire-readiness-kpi"><div className="readiness-donut" style={{ '--readiness': `${hire.readiness}%` } as CSSProperties}><span>{Math.round(hire.readiness)}<small>%</small></span></div><div><span>Day-1 readiness</span><strong>{hire.readiness >= 100 ? 'Plan complete' : `${tasks.filter(task => task.status === 'done').length} of ${tasks.length} tasks complete`}</strong></div></article>
        <article><span>Joining target</span><strong>Day {hire.start_day}</strong><small>Business day in this demo</small></article>
        <article><span>Projected ready</span><strong className={readyDay > hire.start_day ? 'text-risk' : ''}>Day {readyDay}</strong><small>{readyDay > hire.start_day ? `${readyDay - hire.start_day} days after Day 1` : 'On or before Day 1'}</small></article>
        <article><span>Critical tasks</span><strong>{criticalTasks.length}</strong><small>{criticalTasks.length ? 'Remaining on the critical path' : 'No remaining critical blockers'}</small></article>
      </div>
      <div className="hire-progress-track" role="progressbar" aria-label="Day-1 readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hire.readiness)}><i style={{ width: `${Math.max(0, Math.min(100, hire.readiness))}%` }} /></div>
    </header>
    <nav className="hire-tabs" aria-label="Hire detail sections">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon size={15} />{item.label}{item.id === 'tasks' && <span>{tasks.length}</span>}</button> })}</nav>

    {hire.status === 'paused' && <div className="hire-state-banner paused-banner" role="status"><Pause size={18} /><div><strong>Onboarding is paused</strong><p>Open work is held and the schedule monitor will resume when you restart this plan.</p></div></div>}{hire.status === 'cancelled' && <div className="hire-state-banner cancelled-banner" role="status"><X size={18} /><div><strong>Onboarding was cancelled</strong><p>This plan is closed. Completed work is retained in the activity history.</p></div></div>}
    {tab === 'overview' && <div className="hire-overview-grid"><section className="hire-panel hire-risk-panel"><div className="panel-title"><span className="panel-icon"><Sparkles size={17} /></span><div><h2>Readiness briefing</h2><p>A clear summary of what is affecting Day 1.</p></div></div><p className="risk-explanation">{explanation || (hire.status === 'ready' ? `${hire.name} has completed the onboarding plan and is ready for Day 1.` : hire.status === 'paused' ? `${hire.name}’s onboarding is paused. Resume it when teams are ready to continue.` : hire.status === 'cancelled' ? `${hire.name}’s onboarding plan has been cancelled.` : criticalTasks.length ? `${criticalTasks[0].title} is on the critical path. ${criticalTasks.length} key ${criticalTasks.length === 1 ? 'task is' : 'tasks are'} still open.` : 'Work is progressing across IT, HR, and Facilities. The forecast updates as each team completes its tasks.')}</p><button className="button-secondary" onClick={() => explainRisk(hireId).then(result => { setExplanation(result.explanation); setExplainSource(result.source ?? 'template') }).catch(() => { setExplanation('The explanation is temporarily unavailable. Please try again.'); setExplainSource('') })}><Sparkles size={15} />{explanation ? 'Refresh explanation' : 'Why is this at risk?'}</button>{explainSource && <small className="explanation-source">Explanation source: {explainSource === 'llm' ? 'AI suggestion' : 'onboarding template'}</small>}</section>
      <section className="hire-panel"><div className="panel-title"><span className="panel-icon"><ShieldCheck size={17} /></span><div><h2>Next actions</h2><p>Move the work with the biggest schedule impact.</p></div></div>{criticalTasks.length ? <div className="next-action-list">{criticalTasks.slice(0, 3).map(task => <article key={task.id}><span className="next-action-dot" /><div><strong>{task.title}</strong><small>{task.team} · {task.status.replace(/_/g, ' ')} · {task.remaining_days} days remaining</small></div><button className="text-action" onClick={() => setTab('tasks')}>View</button></article>)}</div> : <div className="success-callout"><Check size={17} />All remaining work is on track for the joining target.</div>}</section>
      <section className="hire-panel hire-overview-schedule"><div className="panel-title"><span className="panel-icon"><CalendarDays size={17} /></span><div><h2>Schedule snapshot</h2><p>{tasks.filter(task => task.status !== 'done').length} open tasks across {new Set(tasks.map(task => task.team)).size} teams.</p></div></div><ScheduleTimeline tasks={scheduledTasks} dayOne={hire.start_day} currentDay={currentDay} /></section>
    </div>}
    {tab === 'schedule' && <ScheduleTimeline tasks={scheduledTasks} dayOne={hire.start_day} currentDay={currentDay} />}
    {tab === 'graph' && <DependencyGraph tasks={scheduledTasks} />}
    {tab === 'tasks' && <section className="hire-panel"><div className="panel-title"><span className="panel-icon"><ListTodo size={17} /></span><div><h2>Task plan</h2><p>Dependencies, ownership, approval, and live schedule slack.</p></div></div>{tasksQuery.isError ? <p role="alert">Tasks could not be loaded. <button className="text-action" onClick={() => void tasksQuery.refetch()}>Retry</button></p> : <div className="hire-task-table-wrap"><table className="hire-task-table"><thead><tr><th>Task</th><th>Team</th><th>Status</th><th>Remaining</th><th>Slack</th><th>Actions</th></tr></thead><tbody>{tasks.map(task => <tr key={task.id} className={`${task.critical ? 'critical-row' : ''} ${task.flag === 'watch' || task.flag === 'escalated' ? 'stalled-row' : ''}`}><td><strong>{task.title}</strong>{task.depends_on.length > 0 && <small>After {task.depends_on.join(', ')}</small>}{task.ticket_id && <small className="ticket-id">{task.ticket_id}</small>}</td><td>{task.team}</td><td><span className={`status-pill ${taskStatusClass[task.status] ?? 'neutral'}`}><i />{task.status.replace(/_/g, ' ')}</span>{task.flag !== 'none' && <small className="task-flag">{task.flag}</small>}</td><td>{task.status === 'done' ? 'Complete' : `${task.remaining_days} days`}</td><td>{task.slack === null ? '—' : `${task.slack.toFixed(1)} days`}{task.critical && <small className="critical-label">Critical path</small>}</td><td>{task.status === 'awaiting_approval' && role === 'MANAGER' ? <div className="table-actions"><button className="button-approve" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(task.id)}>Approve</button><button className="button-reject" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate(task.id)}>Reject</button></div> : <button className="text-action" onClick={() => setTab('graph')}>Explore dependencies</button>}</td></tr>)}</tbody></table></div>}{(approveMutation.isError || rejectMutation.isError) && <p className="form-error" role="alert">That approval could not be saved. Refresh the plan and try again.</p>}</section>}
    {tab === 'what-if' && <section className="hire-panel what-if-panel"><div className="panel-title"><span className="panel-icon"><Clock3 size={17} /></span><div><h2>Schedule what-if</h2><p>Recalculate the critical path after adding a delay to one open task. Live work is unchanged.</p></div></div><div className="what-if-form"><label>Task to delay<select value={scenarioTask} onChange={event => { setScenarioTask(event.target.value); setScenario(null) }}><option value="">Choose an open task</option>{tasks.filter(task => !['done', 'blocked'].includes(task.status)).map(task => <option key={task.key} value={task.key}>{task.title}</option>)}</select></label><label className="what-if-range">Added delay <strong>{delay} business {delay === 1 ? 'day' : 'days'}</strong><input type="range" min={0} max={10} step={1} value={delay} onChange={event => { setDelay(Number(event.target.value)); setScenario(null) }} /></label></div>{scenarioMutation.isPending && <p className="schedule-computing" role="status">Recomputing schedule…</p>}{scenario && <div className="what-if-result"><article><span>Baseline finish</span><strong>Day {scenario.baseline_ready_day}</strong></article><article><span>Projected finish</span><strong>Day {scenario.projected_ready_day}</strong></article><article><span>Schedule change</span><strong className={scenario.delta_days > 0 ? 'text-risk' : 'text-positive'}>{scenario.delta_days > 0 ? '+' : ''}{scenario.delta_days} days</strong></article><div><span>Critical path</span><strong>{scenario.critical_path.join('  →  ') || 'No remaining tasks'}</strong></div></div>}{scenarioMutation.isError && <p className="form-error" role="alert">Select an open task and try again.</p>}</section>}
    {tab === 'activity' && <section className="hire-panel"><div className="panel-title"><span className="panel-icon"><Activity size={17} /></span><div><h2>Activity timeline</h2><p>Decisions and orchestration events for this hire.</p></div></div><div className="hire-activity-list" tabIndex={0} role="region" aria-label="Hire activity timeline">{audit.length ? [...audit].reverse().map(event => <article key={event.id}><span className={`activity-marker ${event.level}`} /><div><strong>{event.message}</strong><small>{event.actor} · simulation day {event.day}{event.created_at ? ` · ${new Date(event.created_at).toLocaleString()}` : ''}</small></div><span className="activity-level">{event.level}</span></article>) : <div className="empty-state"><Activity size={20} /><p>No activity yet. Start the monitor to coordinate this plan.</p></div>}</div></section>}
    {cancelDialog && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCancelDialog(false) }}><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-plan-title"><span className="dialog-icon danger"><X size={18} /></span><h2 id="cancel-plan-title">Cancel {hire.name}’s onboarding?</h2><p>Open tickets will be cancelled and remaining tasks will close. Completed work and the activity history will be kept.</p><label className="cancel-confirm-label">Type <strong>{hire.name}</strong> to confirm<input autoFocus value={cancelConfirmation} onChange={event => setCancelConfirmation(event.target.value)} /></label>{lifecycleMutation.isError && <p className="form-error" role="alert">{actionError}</p>}<div className="dialog-actions"><button className="button-secondary" onClick={() => { setCancelDialog(false); setCancelConfirmation('') }}>Keep plan</button><button className="button-danger" disabled={lifecycleMutation.isPending || cancelConfirmation.trim() !== hire.name} onClick={() => lifecycleMutation.mutate('cancel')}>{lifecycleMutation.isPending ? 'Cancelling…' : 'Cancel onboarding'}</button></div></section></div>}
  </main>
}
