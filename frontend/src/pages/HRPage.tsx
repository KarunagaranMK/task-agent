import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useSearchParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Archive, ArrowDownUp, ArrowRight, Bookmark, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Download, Pause, Play, Plus, Search, Users, X } from 'lucide-react'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { StatusPill } from '../components/StatusPill'
import {
  archiveHire, createHire, getHirePage, getManagers, getMetrics, pauseHire, planPreview, resumeHire,
  type Hire, type HireCreate, type HirePageResult,
} from '../api/client'

const ROLES = ['Data Analyst', 'Software Engineer', 'Product Manager', 'Customer Success Manager', 'default']
const DEPARTMENTS = ['Analytics', 'Engineering', 'Marketing', 'HR', 'Finance', 'Operations']
type PlanTask = { key: string; title: string; team: string; duration_days: number; depends_on: string[]; needs_approval: boolean }
const hireFormSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(120, 'Use 120 characters or fewer.'),
  role: z.string().min(1, 'Choose a role.'),
  department: z.string().trim().min(1, 'Choose a department.'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a joining date.'),
  manager_id: z.string(),
  work_email: z.union([z.string().trim().email('Enter a valid work email.'), z.literal('')]),
  work_location: z.string().max(120),
  employment_type: z.string().max(80),
  required_equipment: z.string().max(1000),
  required_software: z.string().max(1000),
  additional_notes: z.string().max(2000),
})
type HireForm = z.infer<typeof hireFormSchema>
type PortfolioState = { search: string; filter: string; sortNewest: boolean; page: number }
type SavedView = Omit<PortfolioState, 'page'> & { id: string; label: string }
const statusFilters = new Set(['all', 'on_track', 'at_risk', 'ready'])
const savedViewsKey = 'onboardiq.hire-portfolio.views'

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
const initialForm: HireForm = { name: '', role: ROLES[0], department: DEPARTMENTS[0], start_date: addBusinessDays(8), manager_id: '', work_email: '', work_location: '', employment_type: '', required_equipment: '', required_software: '', additional_notes: '' }
const statusLabel: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', ready: 'Ready' }

export default function HRPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const requestedFilter = searchParams.get('status') ?? 'all'
  const filter = statusFilters.has(requestedFilter) ? requestedFilter : 'all'
  const sortNewest = searchParams.get('sort') !== 'name'
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const updatePortfolio = (next: Partial<PortfolioState>) => setSearchParams(current => {
    const params = new URLSearchParams(current)
    const values = { search, filter, sortNewest, page, ...next }
    if (values.search) params.set('q', values.search); else params.delete('q')
    if (values.filter !== 'all') params.set('status', values.filter); else params.delete('status')
    if (!values.sortNewest) params.set('sort', 'name'); else params.delete('sort')
    if (values.page > 1) params.set('page', String(values.page)); else params.delete('page')
    return params
  }, { replace: true })
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
  const { register, watch, setValue, getValues, trigger, reset, formState: { errors: fieldErrors } } = useForm<HireForm>({
    resolver: zodResolver(hireFormSchema),
    defaultValues: initialForm,
    mode: 'onBlur',
  })
  const form = watch()
  const [step, setStep] = useState(0)
  const [preview, setPreview] = useState<PlanTask[]>([])
  const [previewBusy, setPreviewBusy] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Hire | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [portfolioError, setPortfolioError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(savedViewsKey) ?? '[]')
      return Array.isArray(stored) ? stored.filter((item): item is SavedView => item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.search === 'string' && typeof item.filter === 'string' && typeof item.sortNewest === 'boolean') : []
    } catch { return [] }
  })

  useEffect(() => { localStorage.setItem(savedViewsKey, JSON.stringify(savedViews)) }, [savedViews])
  useEffect(() => { setSelectedIds([]) }, [search, filter, sortNewest, page])

  const saveCurrentView = () => {
    const label = [filter === 'all' ? 'All hires' : filter === 'at_risk' ? 'At risk' : filter === 'on_track' ? 'On track' : 'Ready', search.trim()].filter(Boolean).join(' · ')
    const signature = `${search.trim().toLowerCase()}|${filter}|${sortNewest}`
    if (savedViews.some(view => `${view.search.trim().toLowerCase()}|${view.filter}|${view.sortNewest}` === signature)) {
      setPortfolioError('That portfolio view is already saved.')
      return
    }
    setSavedViews(current => [...current, { id: crypto.randomUUID(), label, search, filter, sortNewest }])
    setPortfolioError('')
    setNotice(`Saved “${label}” for your next visit.`)
  }

  const exportPortfolio = async () => {
    setExporting(true)
    setPortfolioError('')
    try {
      const rows: Hire[] = []
      let currentPage = 1
      let totalPages = 1
      do {
        const result = await getHirePage({ page: currentPage, page_size: 100, search, status: filter === 'all' ? undefined : filter, sort_by: sortNewest ? 'created_at' : 'name', sort_order: sortNewest ? 'desc' : 'asc' })
        rows.push(...result.items)
        totalPages = result.total_pages
        currentPage += 1
      } while (currentPage <= totalPages)
      const cell = (value: unknown) => {
        const safe = String(value ?? '').replace(/^[=+\-@]/, "'$&")
        return `"${safe.replace(/"/g, '""')}"`
      }
      const lines = [['Name', 'Role', 'Department', 'Manager', 'Joining date', 'Status', 'Readiness'], ...rows.map(hire => [hire.name, hire.role, hire.department, managers.find(manager => manager.id === hire.manager_id)?.name ?? '', hire.start_date ?? `Day ${hire.start_day}`, hire.status, `${hire.readiness}%`])]
      const blob = new Blob([`\uFEFF${lines.map(line => line.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = 'onboardiq-hire-portfolio.csv'; link.click()
      URL.revokeObjectURL(url)
      setNotice(`Exported ${rows.length} matching ${rows.length === 1 ? 'hire' : 'hires'}.`)
    } catch {
      setPortfolioError('The portfolio export failed. Check your connection and try again.')
    } finally { setExporting(false) }
  }

  const bulkLifecycle = useMutation({
    mutationFn: async ({ action, ids }: { action: 'pause' | 'resume'; ids: string[] }) => {
      const results = await Promise.allSettled(ids.map(id => action === 'pause' ? pauseHire(id) : resumeHire(id)))
      return { action, succeeded: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length }
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['hires'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      setSelectedIds([])
      setNotice(`${result.action === 'pause' ? 'Paused' : 'Resumed'} ${result.succeeded} ${result.succeeded === 1 ? 'hire' : 'hires'}${result.failed ? `; ${result.failed} could not be updated` : ''}.`)
    },
  })

  useEffect(() => {
    if (metrics?.default_joining_date && !form.name && !showWizard) {
      setValue('start_date', metrics.default_joining_date)
    }
  }, [metrics?.default_joining_date])

  const createMutation = useMutation({
    mutationFn: (data: HireCreate) => createHire(data),
    onSuccess: hire => {
      void queryClient.invalidateQueries({ queryKey: ['hires'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      setNotice(`${hire.name}’s onboarding plan is ready to coordinate.`)
      setShowWizard(false); reset(initialForm); setStep(0); setPreview([]); setError('')
    },
    onError: error => {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setError(message || 'We couldn’t create the plan. Check the details and try again.')
    },
  })
  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveHire(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hires'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      setNotice(`${archiveTarget?.name ?? 'Employee'} was archived. Their workflow history is retained.`)
      setArchiveTarget(null)
    },
  })

  const visibleHires = hires
  const selectedHires = visibleHires.filter(hire => selectedIds.includes(hire.id))
  const pausableHires = selectedHires.filter(hire => !['paused', 'cancelled', 'ready'].includes(hire.status))
  const resumableHires = selectedHires.filter(hire => hire.status === 'paused')

  const closeWizard = () => { setShowWizard(false); setStep(0); setError('') }
  const nextStep = async () => {
    setError('')
    if (step === 0) {
      if (!await trigger()) { setError('Review the highlighted hire details before continuing.'); return }
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
    const values = getValues()
    const payload: HireCreate = { name: values.name.trim(), role: values.role, department: values.department, start_date: values.start_date, work_email: values.work_email.trim() || null, work_location: values.work_location.trim() || null, employment_type: values.employment_type.trim() || null, required_equipment: values.required_equipment.trim() || null, required_software: values.required_software.trim() || null, additional_notes: values.additional_notes.trim() || null, ...(values.manager_id ? { manager_id: values.manager_id } : {}) }
    createMutation.mutate(payload)
  }

  const onTrack = metrics?.on_track_hires ?? 0
  const atRisk = metrics?.at_risk_hires ?? 0
  const readySoon = metrics?.ready_starting_soon ?? 0
  const hireColumns: DataTableColumn<Hire>[] = [
    { key: 'select', header: <input type="checkbox" aria-label="Select all hires on this page" checked={visibleHires.length > 0 && selectedHires.length === visibleHires.length} onChange={event => setSelectedIds(event.target.checked ? visibleHires.map(hire => hire.id) : [])} />, headerClassName: 'hire-select-cell', className: 'hire-select-cell', render: hire => <input type="checkbox" aria-label={`Select ${hire.name}`} checked={selectedIds.includes(hire.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, hire.id] : current.filter(id => id !== hire.id))} /> },
    { key: 'hire', header: 'New hire', render: hire => <Link className="hire-name-link" to={`/hire/${hire.id}`}><span className="hire-avatar">{hire.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><span><strong>{hire.name}</strong><small>{hire.role} · {hire.department}</small></span></Link> },
    { key: 'manager', header: 'Manager', render: hire => managers.find(manager => manager.id === hire.manager_id)?.name ?? <span className="table-muted">Unassigned</span> },
    { key: 'day-one', header: 'Day 1', render: hire => hire.start_date ? <><strong>{formatDate(hire.start_date)}</strong><small>Day {hire.start_day} in demo</small></> : `Day ${hire.start_day}` },
    { key: 'readiness', header: 'Readiness', render: hire => <div className="readiness-cell"><span className="readiness-track"><i className={hire.status === 'at_risk' ? 'risk' : hire.status === 'ready' ? 'ready' : ''} style={{ width: `${Math.max(0, Math.min(100, hire.readiness))}%` }} /></span><span>{hire.readiness}%</span></div> },
    { key: 'status', header: 'Status', render: hire => <StatusPill status={hire.status} label={statusLabel[hire.status] ?? hire.status} /> },
    { key: 'open', header: <span className="sr-only">Hire actions</span>, render: hire => <div className="flex items-center justify-end gap-2"><Link className="table-open" aria-label={`Open ${hire.name}`} to={`/hire/${hire.id}`}><ArrowRight size={16} /></Link><button className="text-action inline-flex items-center gap-1" aria-label={`Archive ${hire.name}`} onClick={() => setArchiveTarget(hire)}><Archive size={13} />Archive</button></div> },
  ]

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
        <label className="table-search"><Search size={16} /><input aria-label="Search hires" placeholder="Search by name, role, department" value={search} onChange={event => updatePortfolio({ search: event.target.value, page: 1 })} /></label>
        <div className="filter-chips" aria-label="Filter hires by status">
          {[['all', 'All hires'], ['on_track', 'On track'], ['at_risk', 'At risk'], ['ready', 'Ready']].map(([value, label]) =>
            <button key={value} className={`filter-chip ${filter === value ? 'selected' : ''}`} aria-pressed={filter === value} onClick={() => updatePortfolio({ filter: value, page: 1 })}>{label}</button>)}
        </div>
        <div className="hire-toolbar-actions"><button className="button-secondary sort-button" onClick={() => updatePortfolio({ sortNewest: !sortNewest, page: 1 })}><ArrowDownUp size={15} />{sortNewest ? 'Newest' : 'Name A–Z'}</button><button className="button-secondary sort-button" onClick={saveCurrentView}><Bookmark size={14} />Save view</button><button className="button-secondary sort-button" onClick={() => void exportPortfolio()} disabled={exporting}><Download size={14} />{exporting ? 'Exporting…' : 'Export CSV'}</button></div>
      </div>
      {savedViews.length > 0 && <div className="saved-views" aria-label="Saved portfolio views"><span>Saved views</span>{savedViews.map(view => <span className="saved-view-item" key={view.id}><button className="filter-chip" onClick={() => updatePortfolio({ search: view.search, filter: view.filter, sortNewest: view.sortNewest, page: 1 })}>{view.label}</button><button className="saved-view-remove" aria-label={`Remove saved view ${view.label}`} onClick={() => setSavedViews(current => current.filter(item => item.id !== view.id))}><X size={12} /></button></span>)}</div>}
      {portfolioError && <p className="form-error portfolio-error" role="alert">{portfolioError}</p>}
      {selectedHires.length > 0 && <div className="bulk-toolbar" role="region" aria-label="Bulk hire actions"><span><strong>{selectedHires.length}</strong> selected on this page</span><div>{pausableHires.length > 0 && <button className="button-secondary" disabled={bulkLifecycle.isPending} onClick={() => bulkLifecycle.mutate({ action: 'pause', ids: pausableHires.map(hire => hire.id) })}><Pause size={14} />Pause {pausableHires.length} selected</button>}{resumableHires.length > 0 && <button className="button-secondary" disabled={bulkLifecycle.isPending} onClick={() => bulkLifecycle.mutate({ action: 'resume', ids: resumableHires.map(hire => hire.id) })}><Play size={14} />Resume {resumableHires.length} selected</button>}<button className="bulk-clear" onClick={() => setSelectedIds([])}>Clear selection</button></div>{bulkLifecycle.isError && <span className="form-error" role="alert">Some hires could not be updated. Refresh the list to see the current state.</span>}</div>}

      {isLoading ? <div className="table-skeleton" aria-label="Loading hires"><span /><span /><span /></div> : isError ?
        <div className="empty-state compact"><CircleAlert size={23} /><h3>We couldn’t load hires</h3><p>Check the connection and refresh this page.</p></div> : visibleHires.length === 0 ?
          <div className="empty-state compact"><Users size={25} /><h3>{search || filter !== 'all' ? 'No matching hires' : 'Your portfolio is ready to begin'}</h3><p>{search || filter !== 'all' ? 'Try another search or status filter.' : 'Create a hire to build a team-ready onboarding plan.'}</p>{!search && filter === 'all' && <button className="button-secondary" onClick={() => setShowWizard(true)}>Create first hire</button>}</div> :
          <div className="hire-table-wrap"><DataTable ariaLabel="Hire portfolio" className="hire-table" rows={visibleHires} columns={hireColumns} rowKey={hire => hire.id} /><div className="hire-pagination"><span>Showing {Math.min((page - 1) * pageSize + 1, totalHires)}–{Math.min(page * pageSize, totalHires)} of {totalHires} hires</span><div><button className="button-secondary" aria-label="Previous hire page" disabled={page <= 1 || hiresQuery.isFetching} onClick={() => updatePortfolio({ page: page - 1 })}><ChevronLeft size={15} /> Previous</button><span>Page {page} of {Math.max(1, totalPages)}</span><button className="button-secondary" aria-label="Next hire page" disabled={page >= totalPages || hiresQuery.isFetching} onClick={() => updatePortfolio({ page: page + 1 })}><span>Next</span><ChevronRight size={15} /></button></div></div></div>}
    </section>

    {showWizard && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeWizard() }}>
      <section className="hire-wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <div className="wizard-top"><div><span className="eyebrow">NEW ONBOARDING PLAN</span><h2 id="wizard-title">{step === 0 ? 'Hire details' : step === 1 ? 'Plan preview' : 'Review and create'}</h2></div><button className="icon-button wizard-close" onClick={closeWizard} aria-label="Close create hire"><X size={18} /></button></div>
        <div className="wizard-progress" aria-label={`Step ${step + 1} of 3`}><i style={{ width: `${((step + 1) / 3) * 100}%` }} /></div>
        <p className="wizard-step-label">STEP {step + 1} OF 3 <span>·</span> {['Set up the new hire', 'Review role-specific work', 'Confirm the plan'][step]}</p>
        {step === 0 && <div className="wizard-fields">
          <label>Full name<input autoFocus {...register('name')} placeholder="e.g. Priya Sharma" maxLength={120} aria-invalid={!!fieldErrors.name} />{fieldErrors.name && <small className="form-error">{fieldErrors.name.message}</small>}</label>
          <div className="wizard-field-grid"><label>Role<select {...register('role')}>{ROLES.map(role => <option key={role}>{role}</option>)}</select></label><label>Department<select {...register('department')}>{DEPARTMENTS.map(department => <option key={department}>{department}</option>)}</select></label></div>
          <div className="wizard-field-grid"><label>Manager<select {...register('manager_id')}><option value="">Choose later</option>{managers.map(manager => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label><label>Joining date<input type="date" min={metrics?.earliest_joining_date ?? addBusinessDays(1, metrics?.current_date)} {...register('start_date')} aria-invalid={!!fieldErrors.start_date} /><small>{fieldErrors.start_date?.message ?? 'Choose a future organization business day'}</small></label></div>
          <details className="wizard-additional-details"><summary>Additional employee information <span>Optional</span></summary><p>Add details that help teams prepare before Day 1.</p><div className="wizard-field-grid"><label>Work email<input type="email" maxLength={254} placeholder="name@company.com" {...register('work_email')} aria-invalid={!!fieldErrors.work_email} />{fieldErrors.work_email && <small className="form-error">{fieldErrors.work_email.message}</small>}</label><label>Work location<input maxLength={120} placeholder="Office or remote" {...register('work_location')} /></label></div><div className="wizard-field-grid"><label>Employment type<input maxLength={80} placeholder="Full-time, contract…" {...register('employment_type')} /></label><label>Equipment needed<input maxLength={1000} placeholder="Laptop, access card…" {...register('required_equipment')} /></label></div><label>Software and access needed<textarea rows={2} maxLength={1000} placeholder="Tools, accounts, or permissions" {...register('required_software')} /></label><label>Additional notes<textarea rows={3} maxLength={2000} placeholder="Anything the onboarding teams should know" {...register('additional_notes')} /></label></details>
        </div>}
        {step === 1 && <div className="plan-preview"><div className="preview-summary"><span>{preview.length} planned tasks</span><span>Day 1 protected</span></div>{preview.map((task, index) => <div className="preview-task" key={task.key}><span className="preview-step">{String(index + 1).padStart(2, '0')}</span><span className="preview-task-copy"><strong>{task.title}</strong><small>{task.team} · {task.duration_days} day{task.duration_days === 1 ? '' : 's'}{task.needs_approval ? ' · approval required' : ''}</small></span>{task.depends_on.length > 0 && <span className="dependency-label">After {task.depends_on.length}</span>}</div>)}<p className="preview-note">Teams complete the work in their own systems. OnboardFlow AI coordinates dependencies and readiness.</p></div>}
        {step === 2 && <div className="review-summary"><div className="review-person"><span className="hire-avatar large">{form.name.split(' ').map(part => part[0]).join('').slice(0, 2) || 'NH'}</span><span><strong>{form.name}</strong><small>{form.role} · {form.department}</small></span></div><div className="review-lines"><p><span>Manager</span><strong>{managers.find(manager => manager.id === form.manager_id)?.name ?? 'Assign later'}</strong></p><p><span>Joining date</span><strong>{formatDate(form.start_date)}</strong></p><p><span>Task plan</span><strong>{preview.length} coordinated tasks</strong></p>{[form.work_email, form.work_location, form.employment_type, form.required_equipment, form.required_software, form.additional_notes].filter(Boolean).length > 0 && <p><span>Additional details</span><strong>{[form.work_email, form.work_location, form.employment_type, form.required_equipment, form.required_software, form.additional_notes].filter(Boolean).length} provided</strong></p>}</div><div className="amber-callout">The hire’s task plan and critical path will be created together.</div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="wizard-actions"><button className="button-secondary" onClick={() => step === 0 ? closeWizard() : setStep(step - 1)}>{step === 0 ? 'Cancel' : <><ChevronLeft size={16} /> Back</>}</button><button className="button-primary" onClick={() => void nextStep()} disabled={previewBusy || createMutation.isPending}>{previewBusy ? 'Building preview…' : createMutation.isPending ? 'Creating plan…' : step === 2 ? 'Create onboarding plan' : <>Continue <ChevronRight size={16} /></>}</button></div>
      </section>
    </div>}
    {archiveTarget && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setArchiveTarget(null) }}><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-hire-title"><span className="dialog-icon"><Archive size={18} /></span><h2 id="archive-hire-title">Archive {archiveTarget.name}?</h2><p>This removes the employee from the active portfolio. Their onboarding tasks and audit history remain available.</p>{archiveMutation.isError && <p className="form-error" role="alert">The employee could not be archived. Refresh and try again.</p>}<div className="dialog-actions"><button className="button-secondary" onClick={() => setArchiveTarget(null)}>Keep employee active</button><button className="button-primary" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate(archiveTarget.id)}>{archiveMutation.isPending ? 'Archiving…' : 'Archive employee'}</button></div></section></div>}
  </div>
}

function Metric({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: LucideIcon; tone: string }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-card-top"><span>{label}</span><i><Icon size={17} /></i></div><strong>{value}</strong><small>{detail}</small></article>
}
