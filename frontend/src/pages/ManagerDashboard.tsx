import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, CircleAlert, ShieldCheck, Users } from 'lucide-react'
import { getHires, getHireTasks, type Hire, type Task } from '../api/client'
import { useEffect, useState } from 'react'

export default function ManagerDashboard() {
  const { data: hires = [], isLoading } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires })
  const [approvals, setApprovals] = useState(0)
  const [atRisk, setAtRisk] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all(hires.map(hire => getHireTasks(hire.id))).then((lists: Task[][]) => {
      if (active) setApprovals(lists.flat().filter(task => task.status === 'awaiting_approval').length)
    }).catch(() => { if (active) setApprovals(0) })
    setAtRisk(hires.filter(hire => hire.status === 'at_risk').length)
    return () => { active = false }
  }, [hires])
  const upcoming = hires.filter(hire => hire.start_day <= 7).length

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">MANAGER WORKSPACE</span><h1>Your team’s readiness</h1><p>See how your hires are progressing before their first day.</p></div><Link className="button-primary" to="/manager">Review approvals <ArrowRight size={15} /></Link></div>
    <div className="metric-grid"><article className="metric-card metric-navy"><div className="metric-card-top"><span>My new hires</span><i><Users size={17} /></i></div><strong>{hires.length}</strong><small>Plans assigned to you</small></article><article className="metric-card metric-teal"><div className="metric-card-top"><span>Approvals waiting</span><i><ShieldCheck size={17} /></i></div><strong>{approvals}</strong><small>Access requests to review</small></article><article className="metric-card metric-amber"><div className="metric-card-top"><span>At risk</span><i><CircleAlert size={17} /></i></div><strong>{atRisk}</strong><small>Need follow-up</small></article><article className="metric-card metric-green"><div className="metric-card-top"><span>Joining soon</span><i><CalendarDays size={17} /></i></div><strong>{upcoming}</strong><small>Day 1 within 7 days</small></article></div>
    <section className="content-card"><div className="section-heading"><div><h2>Hires on your team</h2><p>Only plans assigned to you are shown here.</p></div><Link className="text-action" to="/manager">Open approvals <ArrowRight size={13} /></Link></div>
      {isLoading ? <div className="table-skeleton"><span /><span /></div> : hires.length ? <div className="manager-hire-list">{hires.map(hire => <Link to={`/hire/${hire.id}`} className="manager-hire-row" key={hire.id}><span className="hire-avatar">{hire.name.split(' ').map(part => part[0]).join('').slice(0,2)}</span><span className="manager-hire-info"><strong>{hire.name}</strong><small>{hire.role} · {hire.department}</small></span><span className="manager-hire-day">Day {hire.start_day}</span><span className={`status-pill ${hire.status}`}>{hire.status.replace('_',' ')}</span><ArrowRight size={15} /></Link>)}</div> : <div className="empty-state compact"><Users size={24} /><h3>No hires assigned yet</h3><p>When HR assigns a new hire to you, their readiness will appear here.</p></div>}
    </section>
  </div>
}
