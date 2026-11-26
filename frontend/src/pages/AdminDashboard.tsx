import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Clock3, RefreshCw, Users } from 'lucide-react'
import { getAlternativeRequests, getAudit, getHireTasks, getHires, getHRReviews, type AlternativeRequest, type AuditRecord, type Hire, type Task } from '../api/client'

type EmployeeProgress = { hire: Hire; tasks: Task[] }
const prettyStatus = (status: string) => status.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase())

export default function AdminDashboard() {
  const hires = useQuery({ queryKey: ['hires'], queryFn: getHires, refetchInterval: 15_000 })
  const reviews = useQuery({ queryKey: ['hr-reviews'], queryFn: getHRReviews, refetchInterval: 15_000 })
  const alternatives = useQuery({ queryKey: ['alternative-requests'], queryFn: getAlternativeRequests, refetchInterval: 15_000 })
  const audit = useQuery({ queryKey: ['audit', 'monitoring'], queryFn: () => getAudit(''), refetchInterval: 15_000 })
  const progress = useQuery<EmployeeProgress[]>({
    queryKey: ['admin-employee-progress', hires.data?.map(hire => hire.id)],
    queryFn: async () => Promise.all((hires.data ?? []).map(async hire => ({ hire, tasks: await getHireTasks(hire.id) }))),
    enabled: Boolean(hires.data), refetchInterval: 15_000,
  })
  const employees = progress.data ?? []
  const totalTasks = employees.reduce((count, item) => count + item.tasks.length, 0)
  const completedTasks = employees.reduce((count, item) => count + item.tasks.filter(task => task.status === 'done').length, 0)
  const completionReviews = (reviews.data ?? []).filter(item => item.status === 'pending_review').length
  const requests: AlternativeRequest[] = alternatives.data ?? []
  const pendingAlternatives = requests.filter(item => item.status === 'pending').length
  const recentActivity: AuditRecord[] = [...(audit.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10)
  const departments = [...new Set(employees.map(item => item.hire.department))].sort().map(department => {
    const people = employees.filter(item => item.hire.department === department)
    const average = people.length ? Math.round(people.reduce((sum, item) => sum + Number(item.hire.readiness), 0) / people.length) : 0
    const tasks = people.flatMap(item => item.tasks)
    const done = tasks.filter(task => task.status === 'done').length
    return { department, people: people.length, average, tasks: tasks.length, done }
  })

  if (hires.isLoading || progress.isLoading) return <div className="portal-page"><div className="page-skeleton" role="status" aria-label="Loading workforce monitoring"><span /></div></div>
  if (hires.isError || progress.isError) return <div className="portal-page"><div className="empty-state" role="alert"><Activity size={26} /><h1>Unable to load workforce data</h1><p>The overview could not retrieve employee and task records. Try again in a moment.</p><button className="button-secondary" onClick={() => { void Promise.all([hires.refetch(), progress.refetch()]) }}><RefreshCw size={15} /> Retry</button></div></div>

  return <div className="portal-page admin-monitor-dashboard">
    <div className="page-heading-row"><div><span className="eyebrow">WORKFORCE MONITORING</span><h1>Onboarding overview</h1><p>Review overall progress, department activity, HR decisions, and system history.</p></div><span className="monitor-live"><i />Updates automatically</span></div>
    <div className="metric-grid">
      <Metric label="Registered employees" value={employees.length} detail="Employee onboarding records" icon={Users} tone="navy" />
      <Metric label="Work completed" value={`${totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0}%`} detail={`${completedTasks} of ${totalTasks} tracked tasks`} icon={CheckCircle2} tone="green" />
      <Metric label="Waiting for HR" value={completionReviews + pendingAlternatives} detail={`${completionReviews} completions · ${pendingAlternatives} alternatives`} icon={Clock3} tone="amber" />
      <Metric label="At risk" value={employees.filter(item => item.hire.status === 'at_risk').length} detail={`${employees.filter(item => item.hire.status === 'ready').length} ready for Day 1`} icon={AlertTriangle} tone="teal" />
    </div>
    <section className="content-card"><div className="section-heading"><div><h2>Department activity</h2><p>Task progress and average employee readiness by department.</p></div><span className="subtle-count">{departments.length} departments</span></div>{departments.length ? <div className="monitor-department-list">{departments.map(item => <article key={item.department}><div className="monitor-department-head"><div><strong>{item.department}</strong><small>{item.people} {item.people === 1 ? 'employee' : 'employees'} · {item.done}/{item.tasks} tasks accepted</small></div><strong>{item.average}% readiness</strong></div><div className="readiness-track" role="progressbar" aria-label={`${item.department} average readiness`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.average}><i style={{ width: `${item.average}%` }} /></div></article>)}</div> : <p className="comment-empty">No department activity yet.</p>}</section>
    <section className="content-card"><div className="section-heading"><div><h2>Alternative requests</h2><p>Review each department recommendation and its HR decision.</p></div><span className="subtle-count">{requests.length} total</span></div>{alternatives.isError ? <p className="form-error">Alternative request data is unavailable. <button className="text-action" onClick={() => void alternatives.refetch()}>Retry</button></p> : requests.length ? <div className="monitor-alternative-list">{requests.slice(0, 8).map(item => <article key={item.id}><div><span className="eyebrow">{item.department.toUpperCase()} · {item.ticket_id}</span><strong>{item.employee_name} <small>{item.employee_id}</small></strong><p>{item.suggested_title}</p><small>Blocker: {item.issue}</small></div><span className={`monitor-status ${item.status}`}>{prettyStatus(item.status)}</span></article>)}</div> : <p className="comment-empty">No alternative requests have been recorded.</p>}</section>
    <section className="content-card"><div className="section-heading"><div><h2>Recent system activity</h2><p>Audited employee, department, alternative, escalation, and HR decision events.</p></div><span className="subtle-count">{recentActivity.length} recent</span></div>{audit.isError ? <p className="form-error">The activity feed is currently unavailable.</p> : recentActivity.length ? <div className="monitor-activity-list">{recentActivity.map(item => <article key={item.id}><span className={`audit-source ${item.source === 'security' ? 'security' : 'flow'}`}>{item.source === 'security' ? 'SEC' : 'FLOW'}</span><div><strong>{item.kind.replace(/_/g, ' ')}</strong><p>{item.detail || item.target}</p><small>{item.actor} · {new Date(item.created_at).toLocaleString()}</small></div></article>)}</div> : <p className="comment-empty">System activity will appear here as work progresses.</p>}</section>
  </div>
}

function Metric({ label, value, detail, icon: Icon, tone }: { label: string; value: number | string; detail: string; icon: typeof Users; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-card-top"><span>{label}</span><i><Icon size={17} /></i></div><strong>{value}</strong><small>{detail}</small></article>
}
