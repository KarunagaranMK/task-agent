import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, CheckCircle2, Clock3, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getHireTasks, getHires, getHRReviews, type Hire, type Task } from '../api/client'

type EmployeeProgress = { hire: Hire; tasks: Task[] }
const prettyStatus = (status: string) => status.replace(/_/g, ' ').replace(/^\w/, letter => letter.toUpperCase())

export default function AdminDashboard() {
  const hires = useQuery({ queryKey: ['hires'], queryFn: getHires, refetchInterval: 20_000 })
  const reviews = useQuery({ queryKey: ['hr-reviews'], queryFn: getHRReviews, refetchInterval: 20_000 })
  const progress = useQuery<EmployeeProgress[]>({
    queryKey: ['admin-employee-progress', hires.data?.map(hire => hire.id)],
    queryFn: async () => Promise.all((hires.data ?? []).map(async hire => ({ hire, tasks: await getHireTasks(hire.id) }))),
    enabled: Boolean(hires.data), refetchInterval: 20_000,
  })
  const employees = progress.data ?? []
  const totalTasks = employees.reduce((count, item) => count + item.tasks.length, 0)
  const completedTasks = employees.reduce((count, item) => count + item.tasks.filter(task => task.status === 'done').length, 0)
  const waiting = (reviews.data ?? []).filter(item => item.status !== 'done').length
  const departments = [...new Set(employees.map(item => item.hire.department))].sort().map(department => {
    const people = employees.filter(item => item.hire.department === department)
    const average = people.length ? Math.round(people.reduce((sum, item) => sum + Number(item.hire.readiness), 0) / people.length) : 0
    return { department, people: people.length, average }
  })

  if (hires.isLoading || progress.isLoading) return <div className="portal-page"><div className="page-skeleton" role="status" aria-label="Loading workforce progress"><span /></div></div>
  if (hires.isError || progress.isError) return <div className="portal-page"><div className="empty-state"><Activity size={26} /><h1>Workforce data is unavailable</h1><p>Check the service connection and reload this page.</p></div></div>

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">ADMIN OVERVIEW</span><h1>Workforce progress</h1><p>Registered employees, onboarding progress, and team workload in one view.</p></div><Link className="button-secondary" to="/users">Manage access <ArrowRight size={15} /></Link></div>
    <div className="metric-grid"><article className="metric-card metric-navy"><div className="metric-card-top"><span>Registered employees</span><i><Users size={17} /></i></div><strong>{employees.length}</strong><small>Active onboarding records</small></article><article className="metric-card metric-green"><div className="metric-card-top"><span>Work completed</span><i><CheckCircle2 size={17} /></i></div><strong>{totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0}%</strong><small>{completedTasks} of {totalTasks} tracked tasks</small></article><article className="metric-card metric-amber"><div className="metric-card-top"><span>Waiting for HR review</span><i><Clock3 size={17} /></i></div><strong>{waiting}</strong><small>IT and Facilities handoffs</small></article><article className="metric-card metric-teal"><div className="metric-card-top"><span>Ready for Day 1</span><i><Activity size={17} /></i></div><strong>{employees.filter(item => item.hire.status === 'ready').length}</strong><small>Employees with plans complete</small></article></div>
    <section className="content-card"><div className="section-heading"><div><h2>Progress by department</h2><p>Average onboarding readiness for each employee’s department.</p></div><span className="subtle-count">{departments.length} departments</span></div>{departments.length ? <div style={{ display: 'grid', gap: 16 }}>{departments.map(item => <div key={item.department} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 160px) 1fr 52px', alignItems: 'center', gap: 14 }}><div><strong>{item.department}</strong><small style={{ display: 'block', color: 'var(--muted)' }}>{item.people} {item.people === 1 ? 'employee' : 'employees'}</small></div><div className="readiness-track" role="progressbar" aria-label={`${item.department} readiness`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.average}><i style={{ width: `${item.average}%` }} /></div><strong>{item.average}%</strong></div>)}</div> : <p>No employee records yet.</p>}</section>
    <section className="content-card"><div className="section-heading"><div><h2>Employee work tracker</h2><p>Open a profile to inspect its plan, blockers, and timeline.</p></div><span className="subtle-count">{employees.length} people</span></div>{employees.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Employee</th><th>Department</th><th>Joining</th><th>Work progress</th><th>Readiness</th></tr></thead><tbody>{employees.map(({ hire, tasks }) => { const done = tasks.filter(task => task.status === 'done').length; const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0; return <tr key={hire.id}><td><Link to={`/hire/${hire.id}`}><strong>{hire.name}</strong></Link><small>{hire.role}</small></td><td>{hire.department}</td><td>{hire.start_date ?? `Day ${hire.start_day}`}</td><td>{done}/{tasks.length} tasks · {prettyStatus(hire.status)}</td><td><div className="readiness-track"><i style={{ width: `${Number(hire.readiness)}%` }} /></div><small>{Number(hire.readiness)}%</small></td></tr> })}</tbody></table></div> : <div className="empty-state compact"><Users size={22} /><h3>No employees registered yet</h3><p>HR can add an employee from the HR workspace.</p></div>}</section>
  </div>
}
