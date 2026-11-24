import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ArrowDownUp, ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Plus, Search, Users, X } from 'lucide-react'
import {
  createHire, getHirePage, getManagers, getMetrics, planPreview,
  type Hire, type HireCreate, type HirePageResult,
} from '../api/client'

const ROLES = ['Data Analyst', 'Software Engineer', 'Product Manager', 'Customer Success Manager', 'default']
const DEPARTMENTS = ['Analytics', 'Engineering', 'Marketing', 'HR', 'Finance', 'Operations']
type PlanTask = { key: string; title: string; team: string; duration_days: number; depends_on: string[]; needs_approval: boolean }
type HireForm = { name: string; role: string; department: string; start_date: string; manager_id: number | null }

function addBusinessDays(count: number, from?: string) {
  const date = from ? new Date(`${from}T12:00:00`) : new Date()
  date.setHours(12, 0, 0, 0)
  let remaining = count
  while (remaining > 0) {
    date.setDate(date.getDate() + 1)
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining -= 1
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
const initialForm: HireForm = { name: '', role: ROLES[0], department: DEPARTMENTS[0], start_date: addBusinessDays(8), manager_id: null }
const statusLabel: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', ready: 'Ready' }

export default function HRPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sortNewest, setSortNewest] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const hiresQuery = useQuery<HirePageResult>({
    queryKey: ['hires', { page, pageSize, search, filter, sortNewest }],
    queryFn: () => getHirePage({ page, page_size: pageSize, search, status: filter === 'all' ? undefined : filter, sort_by: sortNewest ? 'created_at' : 'name', sort_order: sortNewest ? 'desc' : 'asc' }),
  })
  const hires = hiresQuery.data?.items ?? []
  const totalHires = hiresQuery.data?.total ?? 0
  const totalPages = hiresQuery.data?.total_pages ?? 0
  const isLoading = hiresQuery.isLoading
  const isError = hiresQuery.isError
  const { data: metrics } = useQuery({ queryKey: ['metrics'], queryFn: getMetrics, refetchInterval: 15_000 })
  const { data: managers = [] } = useQuery({ queryKey: ['managers'], queryFn: getManagers })
  const [form, setForm] = useState<HireForm>(initialForm)
  const [step, setStep] = useState(0)
  const [preview, setPreview] = useState<PlanTask[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (metrics?.default_joining_date && !form.name && !showWizard) {
      setForm(current => ({ ...current, start_date: metrics.default_joining_date }))
    }
  }, [metrics?.default_joining_date])

  const createMutation = useMutation({
    mutationFn: (data: HireCreate) => createHire(data),
    onSuccess: hire => {
      void queryClient.invalidateQueries({ queryKey: ['hires'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      setNotice(`${hire.name}’s onboarding plan is ready to coordinate.`)
      setShowWizard(false); setForm(initialForm); setStep(0); setPreview([]); setError('')
    },
    onError: error => {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setError(message || 'We couldn’t create the plan. Check the details and try again.')
    },
  })

  const visibleHires = hires

  const closeWizard = () => { setShowWizard(false); setStep(0); setError('') }
  const nextStep = async () => {
    setError('')
    if (step === 0) {
      if (form.name.trim().length < 2) { setError('Enter the new hire’s full name to continue.'); return }
      setPreviewBusy(true)
      try {
        const result = await planPreview(form.role) as { tasks?: PlanTask[] }
        setPreview(result.tasks ?? [])
        setStep(1)
      } catch { setError('The plan preview is unavailable. Try again in a moment.') }
      finally { setPreviewBusy(false) }
      return
    }
    if (step === 1) { setStep(2); return }
    const payload: HireCreate = { name: form.name.trim(), role: form.role, department: form.department, start_date: form.start_date, ...(form.manager_id ? { manager_id: form.manager_id } : {}) }
    createMutation.mutate(payload)
  }

  const onTrack = metrics?.on_track_hires ?? 0
  const atRisk = metrics?.at_risk_hires ?? 0
  const readySoon = metrics?.ready_starting_soon ?? 0

  return <div className="portal-page">
    <div className="page-heading-row">
      <div><span className="eyebrow">PEOPLE OPERATIONS</span><h1>Onboarding overview</h1><p>Keep every team moving toward a ready first day.</p></div>
      <button className="button-primary" onClick={() => { setShowWizard(true); setNotice('') }}><Plus size={17} /> Create hire</button>
    </div>

    {notice && <div className="inline-success" role="status"><Check size={16} />{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={15} /></button></div>}

    <div className="metric-grid">
      <Metric label="Active hires" value={metrics?.total_hires ?? totalHires} detail="Across all teams" icon={Users} tone="navy" />
      <Metric label="On track" value={onTrack} detail="Moving to Day 1" icon={Check} tone="green" />
      <Metric label="Need attention" value={atRisk} detail="Critical-path risk" icon={CircleAlert} tone="amber" />
      <Metric label="Ready this week" value={readySoon} detail={`${metrics?.escalations ?? 0} open escalations`} icon={Clock3} tone="teal" />
    </div>

    <section className="content-card hires-card">
      <div className="section-heading">
        <div><h2>Hire portfolio</h2><p>Search and open a hire to review their plan.</p></div>
        <span className="subtle-count">{totalHires === 0 ? 0 : Math.min((page - 1) * pageSize + 1, totalHires)}–{Math.min(page * pageSize, totalHires)} of {totalHires}</span>
      </div>
      <div className="table-toolbar">
        <label className="table-search"><Search size={16} /><input aria-label="Search hires" placeholder="Search by name, role, department" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>
        <div className="filter-chips" aria-label="Filter hires by status">
          {[['all', 'All hires'], ['on_track', 'On track'], ['at_risk', 'At risk'], ['ready', 'Ready']].map(([value, label]) =>
            <button key={value} className={`filter-chip ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1) }}>{label}</button>)}
        </div>
        <button className="button-secondary sort-button" onClick={() => { setSortNewest(value => !value); setPage(1) }}><ArrowDownUp size={15} />{sortNewest ? 'Newest' : 'Name A–Z'}</button>
      </div>

      {isLoading ? <div className="table-skeleton" aria-label="Loading hires"><span /><span /><span /></div> : isError ?
        <div className="empty-state compact"><CircleAlert size={23} /><h3>We couldn’t load hires</h3><p>Check the connection and refresh this page.</p></div> : visibleHires.length === 0 ?
          <div className="empty-state compact"><Users size={25} /><h3>{search || filter !== 'all' ? 'No matching hires' : 'Your portfolio is ready to begin'}</h3><p>{search || filter !== 'all' ? 'Try another search or status filter.' : 'Create a hire to build a team-ready onboarding plan.'}</p>{!search && filter === 'all' && <button className="button-secondary" onClick={() => setShowWizard(true)}>Create first hire</button>}</div> :
          <div className="hire-table-wrap"><table className="hire-table"><thead><tr><th>New hire</th><th>Manager</th><th>Day 1</th><th>Readiness</th><th>Status</th><th><span className="sr-only">Open hire</span></th></tr></thead>
            <tbody>{visibleHires.map(hire => <tr key={hire.id}>
              <td><Link className="hire-name-link" to={`/hire/${hire.id}`}><span className="hire-avatar">{hire.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><span><strong>{hire.name}</strong><small>{hire.role} · {hire.department}</small></span></Link></td>
              <td>{managers.find(manager => manager.id === hire.manager_id)?.name ?? <span className="table-muted">Unassigned</span>}</td>
              <td>{hire.start_date ? <><strong>{formatDate(hire.start_date)}</strong><small>Day {hire.start_day} in demo</small></> : `Day ${hire.start_day}`}</td>
              <td><div className="readiness-cell"><span className="readiness-track"><i className={hire.status === 'at_risk' ? 'risk' : hire.status === 'ready' ? 'ready' : ''} style={{ width: `${Math.max(0, Math.min(100, hire.readiness))}%` }} /></span><span>{hire.readiness}%</span></div></td>
              <td><span className={`status-pill ${hire.status}`}>{statusLabel[hire.status] ?? hire.status}</span></td>
              <td><Link className="table-open" aria-label={`Open ${hire.name}`} to={`/hire/${hire.id}`}><ArrowRight size={16} /></Link></td>
            </tr>)}</tbody></table><div className="hire-pagination"><span>Showing {Math.min((page - 1) * pageSize + 1, totalHires)}–{Math.min(page * pageSize, totalHires)} of {totalHires} hires</span><div><button className="button-secondary" aria-label="Previous hire page" disabled={page <= 1 || hiresQuery.isFetching} onClick={() => setPage(current => current - 1)}><ChevronLeft size={15} /> Previous</button><span>Page {page} of {Math.max(1, totalPages)}</span><button className="button-secondary" aria-label="Next hire page" disabled={page >= totalPages || hiresQuery.isFetching} onClick={() => setPage(current => current + 1)}><span>Next</span><ChevronRight size={15} /></button></div></div></div>}
    </section>

    {showWizard && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeWizard() }}>
      <section className="hire-wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <div className="wizard-top"><div><span className="eyebrow">NEW ONBOARDING PLAN</span><h2 id="wizard-title">{step === 0 ? 'Hire details' : step === 1 ? 'Plan preview' : 'Review and create'}</h2></div><button className="icon-button wizard-close" onClick={closeWizard} aria-label="Close create hire"><X size={18} /></button></div>
        <div className="wizard-progress" aria-label={`Step ${step + 1} of 3`}><i style={{ width: `${((step + 1) / 3) * 100}%` }} /></div>
        <p className="wizard-step-label">STEP {step + 1} OF 3 <span>·</span> {['Set up the new hire', 'Review role-specific work', 'Confirm the plan'][step]}</p>
        {step === 0 && <div className="wizard-fields">
          <label>Full name<input autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Priya Sharma" maxLength={120} /></label>
          <div className="wizard-field-grid"><label>Role<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value })}>{ROLES.map(role => <option key={role}>{role}</option>)}</select></label><label>Department<select value={form.department} onChange={event => setForm({ ...form, department: event.target.value })}>{DEPARTMENTS.map(department => <option key={department}>{department}</option>)}</select></label></div>
          <div className="wizard-field-grid"><label>Manager<select value={form.manager_id ?? ''} onChange={event => setForm({ ...form, manager_id: event.target.value ? Number(event.target.value) : null })}><option value="">Choose later</option>{managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label><label>Joining date<input type="date" min={metrics?.earliest_joining_date ?? addBusinessDays(1, metrics?.current_date)} value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} /><small>Choose a future organization business day</small></label></div>
        </div>}
        {step === 1 && <div className="plan-preview"><div className="preview-summary"><span>{preview.length} planned tasks</span><span>Day 1 protected</span></div>{preview.map((task, index) => <div className="preview-task" key={task.key}><span className="preview-step">{String(index + 1).padStart(2, '0')}</span><span className="preview-task-copy"><strong>{task.title}</strong><small>{task.team} · {task.duration_days} day{task.duration_days === 1 ? '' : 's'}{task.needs_approval ? ' · approval required' : ''}</small></span>{task.depends_on.length > 0 && <span className="dependency-label">After {task.depends_on.length}</span>}</div>)}<p className="preview-note">Teams complete the work in their own systems. OnboardIQ coordinates dependencies and readiness.</p></div>}
        {step === 2 && <div className="review-summary"><div className="review-person"><span className="hire-avatar large">{form.name.split(' ').map(part => part[0]).join('').slice(0, 2) || 'NH'}</span><span><strong>{form.name}</strong><small>{form.role} · {form.department}</small></span></div><div className="review-lines"><p><span>Manager</span><strong>{managers.find(manager => manager.id === form.manager_id)?.name ?? 'Assign later'}</strong></p><p><span>Joining date</span><strong>{formatDate(form.start_date)}</strong></p><p><span>Task plan</span><strong>{preview.length} coordinated tasks</strong></p></div><div className="amber-callout">The hire’s task plan and critical path will be created together.</div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="wizard-actions"><button className="button-secondary" onClick={() => step === 0 ? closeWizard() : setStep(step - 1)}>{step === 0 ? 'Cancel' : <><ChevronLeft size={16} /> Back</>}</button><button className="button-primary" onClick={() => void nextStep()} disabled={previewBusy || createMutation.isPending}>{previewBusy ? 'Building preview…' : createMutation.isPending ? 'Creating plan…' : step === 2 ? 'Create onboarding plan' : <>Continue <ChevronRight size={16} /></>}</button></div>
      </section>
    </div>}
  </div>
}

function Metric({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: LucideIcon; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-card-top"><span>{label}</span><i><Icon size={17} /></i></div><strong>{value}</strong><small>{detail}</small></article>
}
