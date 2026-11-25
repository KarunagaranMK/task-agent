import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Archive, Check, Download, Mail, Plus, Save, Shield, Users, Workflow, Link2, MousePointer2, Trash2, TriangleAlert } from 'lucide-react'
import { getAudit, getDevMail, getMetrics, getSettings, getTemplates, inviteUser, listUsers, publishTemplate, saveSettings, setDemoClock, updateUser, type AuditRecord, type OnboardingTemplate, type TemplateTask } from '../api/client'

const routeLabels: Record<string, string> = { '/templates': 'Role templates', '/users': 'People & access', '/audit': 'Audit trail', '/settings': 'Workspace settings', '/app/dev/mail': 'Mail outbox' }
const emptyTask = (): TemplateTask => ({ key: `task:${Date.now()}`, title: '', team: 'IT', duration_days: 1, depends_on: [], needs_approval: false })
const holidayLines = (value: string | undefined) => { try { return (JSON.parse(value || '[]') as string[]).join('\n') } catch { return '' } }
function templateGraphIssues(tasks: TemplateTask[]) {
  const keys = new Set(tasks.map(task => task.key))
  const issues: string[] = []
  if (tasks.some(task => !task.key.trim()) || keys.size !== tasks.length) issues.push('Use a unique key for every task.')
  if (tasks.some(task => task.depends_on.some(dep => !keys.has(dep) || dep === task.key))) issues.push('Dependencies must point to a different task in this template.')
  const indegree = new Map(tasks.map(task => [task.key, 0]))
  const children = new Map(tasks.map(task => [task.key, [] as string[]]))
  tasks.forEach(task => task.depends_on.forEach(dep => { if (keys.has(dep) && dep !== task.key) { indegree.set(task.key, (indegree.get(task.key) ?? 0) + 1); children.get(dep)?.push(task.key) } }))
  const queue = tasks.filter(task => indegree.get(task.key) === 0).map(task => task.key)
  for (let cursor = 0; cursor < queue.length; cursor += 1) for (const child of children.get(queue[cursor]) ?? []) { const next = (indegree.get(child) ?? 0) - 1; indegree.set(child, next); if (next === 0) queue.push(child) }
  if (queue.length !== tasks.length) issues.push('A dependency cycle is present. Remove a connection before publishing.')
  return issues
}

function TemplateGraph({ tasks, selectedKey, onSelect, onConnect, onDisconnect, connecting, sourceKey }: {
  tasks: TemplateTask[]; selectedKey: string; onSelect: (key: string) => void
  onConnect: (source: string, target: string) => void; onDisconnect: (source: string, target: string) => void
  connecting: boolean; sourceKey: string
}) {
  const keys = new Set(tasks.map(task => task.key))
  const invalid = tasks.some(task => !task.key.trim() || tasks.filter(other => other.key === task.key).length > 1 || task.depends_on.some(dep => !keys.has(dep) || dep === task.key))
  const indegree = new Map(tasks.map(task => [task.key, 0]))
  const children = new Map(tasks.map(task => [task.key, [] as string[]]))
  tasks.forEach(task => task.depends_on.forEach(dep => {
    if (keys.has(dep) && dep !== task.key && children.has(dep)) {
      indegree.set(task.key, (indegree.get(task.key) ?? 0) + 1)
      children.get(dep)?.push(task.key)
    }
  }))
  const queue = tasks.filter(task => indegree.get(task.key) === 0).map(task => task.key)
  const depth = new Map(tasks.map(task => [task.key, 0]))
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor]
    for (const child of children.get(key) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(key) ?? 0) + 1))
      const next = (indegree.get(child) ?? 0) - 1
      indegree.set(child, next)
      if (next === 0) queue.push(child)
    }
  }
  const cyclic = queue.length !== tasks.length
  const groups = new Map<number, TemplateTask[]>()
  tasks.forEach(task => {
    const column = cyclic ? 0 : depth.get(task.key) ?? 0
    groups.set(column, [...(groups.get(column) ?? []), task])
  })
  const nodeWidth = 190, nodeHeight = 92, columnGap = 255, rowGap = 132, left = 34, top = 30
  const positions = new Map<string, { x: number; y: number }>()
  ;[...groups.entries()].sort(([a], [b]) => a - b).forEach(([column, members]) => members.forEach((task, row) => {
    positions.set(task.key, { x: left + column * columnGap, y: top + row * rowGap })
  }))
  const width = Math.max(720, left * 2 + Math.max(0, ...groups.keys()) * columnGap + nodeWidth)
  const height = Math.max(250, top * 2 + Math.max(0, ...[...groups.values()].map(items => items.length - 1)) * rowGap + nodeHeight)
  const taskByKey = new Map(tasks.map(task => [task.key, task]))
  const edges = tasks.flatMap(task => task.depends_on.filter(dep => positions.has(dep) && positions.has(task.key)).map(dep => ({ source: dep, target: task.key })))
  const invalidKeys = new Set(tasks.filter(task => task.depends_on.some(dep => !keys.has(dep) || dep === task.key)).flatMap(task => [task.key, ...task.depends_on]))
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragSource, setDragSource] = useState('')
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null)
  const pointFromEvent = (event: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return null
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const matrix = svg.getScreenCTM()
    return matrix ? point.matrixTransform(matrix.inverse()) : null
  }
  const finishConnectionDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (!dragSource) return
    const point = pointFromEvent(event)
    if (point) {
      const target = [...positions.entries()]
        .filter(([key]) => key !== dragSource)
        .map(([key, position]) => ({ key, x: position.x, y: position.y + nodeHeight / 2 }))
        .find(candidate => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 30)
      if (target) onConnect(dragSource, target.key)
    }
    setDragSource('')
    setDragCursor(null)
  }
  return <div className="template-graph-shell">
    <div className="template-graph-scroll" role="region" aria-label="Interactive task dependency graph" tabIndex={0}>
      <svg ref={svgRef} className="template-graph" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} aria-label="Task dependency graph" onPointerMove={event => { if (dragSource) setDragCursor(pointFromEvent(event)) }} onPointerUp={finishConnectionDrag} onPointerCancel={() => { setDragSource(''); setDragCursor(null) }}>
        <defs><marker id="template-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="currentColor" /></marker></defs>
        {[...groups.keys()].sort((a, b) => a - b).map(column => <text key={column} className="template-lane-label" x={left + column * columnGap} y="18">{column === 0 ? 'START' : `AFTER ${column === 1 ? 'PREREQUISITES' : `${column} STEPS`}`}</text>)}
        {edges.map(({ source, target }) => {
          const from = positions.get(source)!, to = positions.get(target)!
          const x1 = from.x + nodeWidth, y1 = from.y + nodeHeight / 2, x2 = to.x, y2 = to.y + nodeHeight / 2
          const bend = Math.max(34, (x2 - x1) * .48)
          return <path key={`${source}-${target}`} className={`template-edge ${invalidKeys.has(source) || invalidKeys.has(target) ? 'invalid' : ''}`} d={`M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}`} markerEnd="url(#template-arrow)" onClick={() => onDisconnect(source, target)} role="button" tabIndex={0} aria-label={`Remove dependency ${source} to ${target}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onDisconnect(source, target) }} />
        })}
        {dragSource && dragCursor && positions.has(dragSource) && (() => { const from = positions.get(dragSource)!; const x1 = from.x + nodeWidth, y1 = from.y + nodeHeight / 2, bend = Math.max(34, (dragCursor.x - x1) * .48); return <path className="template-edge template-edge-preview" d={`M${x1} ${y1} C${x1 + bend} ${y1},${dragCursor.x - bend} ${dragCursor.y},${dragCursor.x} ${dragCursor.y}`} /> })()}
        {connecting && sourceKey && positions.has(sourceKey) && <text className="template-connect-hint" x="18" y={height - 15}>Choose a downstream task to depend on {taskByKey.get(sourceKey)?.title || sourceKey}</text>}
        {tasks.map(task => {
          const point = positions.get(task.key)!
          const active = selectedKey === task.key
          const duration = `${task.duration_days} DAY${task.duration_days === 1 ? '' : 'S'}`
          return <g key={`${task.key}-${point.x}-${point.y}`}><foreignObject x={point.x} y={point.y} width={nodeWidth} height={nodeHeight}><button type="button" className={`template-node-card ${active ? 'selected' : ''} ${invalidKeys.has(task.key) ? 'invalid' : ''} ${connecting && task.key === sourceKey ? 'connect-source' : ''}`} aria-pressed={active} onClick={() => connecting ? (sourceKey && sourceKey !== task.key ? onConnect(sourceKey, task.key) : onSelect(task.key)) : onSelect(task.key)}><span className={`template-node-team team-${task.team.toLowerCase()}`}><i />{task.team.toUpperCase()} · {duration}</span><strong className="template-node-title">{task.title || 'Untitled task'}</strong><small className="template-node-key">{task.key}</small>{task.needs_approval && <span className="template-node-approval">APPROVAL</span>}</button></foreignObject><circle className={`template-port template-port-in ${dragSource && dragSource !== task.key ? 'drop-target' : ''}`} cx={point.x} cy={point.y + nodeHeight / 2} r="7" aria-hidden="true" /><circle className={`template-port template-port-out ${dragSource === task.key ? 'dragging' : ''}`} cx={point.x + nodeWidth} cy={point.y + nodeHeight / 2} r="7" aria-hidden="true" onPointerDown={event => { if (connecting) return; event.preventDefault(); event.stopPropagation(); const svg = svgRef.current; if (svg) svg.setPointerCapture(event.pointerId); setDragSource(task.key); setDragCursor({ x: point.x + nodeWidth, y: point.y + nodeHeight / 2 }) }} /></g>
        })}
      </svg>
    </div>
    <div className="template-graph-legend"><span><i className="team-dot it" /> IT</span><span><i className="team-dot hr" /> HR</span><span><i className="team-dot facilities" /> Facilities</span><span><Link2 size={13} /> Drag right handle to a left handle · click arrow to remove</span></div>
    {cyclic && <div className="template-graph-warning" role="alert"><TriangleAlert size={15} /> A dependency cycle is present. Remove a connection before publishing.</div>}
    {invalid && <div className="template-graph-warning" role="alert"><TriangleAlert size={15} /> Task keys must be unique and dependencies must point to another task.</div>}
  </div>
}

export default function AdminPage() {
  const path = useLocation().pathname
  const section = routeLabels[path] ?? 'Workspace administration'
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['admin-users'], queryFn: listUsers, enabled: path === '/users' })
  const { data: templates = [] } = useQuery({ queryKey: ['templates'], queryFn: getTemplates, enabled: path === '/templates' })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: path === '/settings' })
  const { data: metrics } = useQuery({ queryKey: ['metrics'], queryFn: getMetrics, enabled: path === '/settings' })
  const { data: audit = [] } = useQuery({ queryKey: ['audit'], queryFn: () => getAudit(), enabled: path === '/audit' })
  const { data: mail = [] } = useQuery({ queryKey: ['mail-outbox'], queryFn: getDevMail, enabled: path === '/app/dev/mail' })
  const [roleKey, setRoleKey] = useState('Data Analyst')
  const [draft, setDraft] = useState<TemplateTask[]>([])
  const [selectedTaskKey, setSelectedTaskKey] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [sourceKey, setSourceKey] = useState('')
  const [auditQuery, setAuditQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [settingsDraft, setSettingsDraft] = useState({ stall_after_days: 2, near_critical_margin: 1, monitor_interval_minutes: 15, auto_worker_enabled: false, timezone: 'Asia/Kolkata', holidays: '' })
  const [clockDay, setClockDay] = useState(0)
  const [invite, setInvite] = useState({ name: '', email: '', role: 'MANAGER', team: '' })
  const selected = templates.find(item => item.role_key === roleKey && item.active) ?? templates.find(item => item.role_key === roleKey)
  const selectedTask = draft.find(task => task.key === selectedTaskKey) ?? draft[0]
  const graphIssues = templateGraphIssues(draft)

  useEffect(() => { if (selected) { const next = selected.tasks.map(task => ({ ...task, depends_on: [...task.depends_on] })); setDraft(next); setSelectedTaskKey(next[0]?.key ?? ''); setConnecting(false); setSourceKey('') } }, [selected?.id, selected?.version, templates.length])
  useEffect(() => { if (settings) setSettingsDraft({ stall_after_days: Number(settings.stall_after_days), near_critical_margin: Number(settings.near_critical_margin), monitor_interval_minutes: Number(settings.monitor_interval_minutes), auto_worker_enabled: settings.auto_worker_enabled === 'true', timezone: settings.timezone, holidays: holidayLines(settings.holidays) }) }, [settings])
  useEffect(() => { if (metrics) setClockDay(metrics.current_day) }, [metrics?.current_day])

  const publish = useMutation({ mutationFn: publishTemplate, onSuccess: item => { setNotice(`${item.role_key} template published as version ${item.version}.`); void qc.invalidateQueries({ queryKey: ['templates'] }) }, onError: error => setNotice(error instanceof Error ? error.message : 'Template could not be published.') })
  const save = useMutation({ mutationFn: saveSettings, onSuccess: () => { setNotice('Workspace settings saved.'); void qc.invalidateQueries({ queryKey: ['settings'] }) }, onError: () => setNotice('Settings could not be saved.') })
  const inviteUserMutation = useMutation({ mutationFn: inviteUser, onSuccess: user => { setNotice(`Invitation created for ${user.email}. Check the demo mail outbox for the setup link.`); setInvite({ name: '', email: '', role: 'MANAGER', team: '' }); void qc.invalidateQueries({ queryKey: ['admin-users'] }) }, onError: () => setNotice('Invitation could not be created. Check that the email is not already in use.') })
  const filteredAudit = useMemo(() => audit.filter(row => `${row.kind} ${row.actor} ${row.target} ${row.detail}`.toLowerCase().includes(auditQuery.toLowerCase())), [audit, auditQuery])
  const updateTask = (key: string, update: Partial<TemplateTask>) => setDraft(rows => rows.map(task => task.key === key ? { ...task, ...update } : task))
  const connectTasks = (source: string, target: string) => { if (!source || source === target) return; setDraft(rows => rows.map(task => task.key === target && !task.depends_on.includes(source) ? { ...task, depends_on: [...task.depends_on, source] } : task)); setSourceKey(''); setConnecting(false) }
  const disconnectTasks = (source: string, target: string) => setDraft(rows => rows.map(task => task.key === target ? { ...task, depends_on: task.depends_on.filter(dep => dep !== source) } : task))
  const changeRole = (id: number, name: string, role: string) => { if (window.confirm(`Change ${name}’s access role to ${role}? Their workspace permissions will update immediately.`)) void updateUser(id, { role }).then(() => qc.invalidateQueries({ queryKey: ['admin-users'] })); else void qc.invalidateQueries({ queryKey: ['admin-users'] }) }
  const changeAccess = (id: number, name: string, active: boolean) => { const action = active ? 'deactivate' : 'restore access for'; if (window.confirm(`Are you sure you want to ${action} ${name}?`)) void updateUser(id, { is_active: !active }).then(() => qc.invalidateQueries({ queryKey: ['admin-users'] })); else void qc.invalidateQueries({ queryKey: ['admin-users'] }) }
  const exportAudit = () => { const rows = [['Timestamp', 'Type', 'Actor', 'Target', 'Detail'], ...filteredAudit.map(row => [row.created_at, row.kind, row.actor, row.target, row.detail])]; const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'onboardiq-audit.csv'; a.click(); URL.revokeObjectURL(a.href) }

  return <main className="admin-page">
    <header className="page-heading"><div><span className="eyebrow">WORKSPACE ADMINISTRATION</span><h1>{section}</h1><p>Manage the operating rules and people behind your onboarding workflows.</p></div><span className="admin-live"><i /> Local workspace</span></header>
    {notice && <div className="admin-notice" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    {path === '/templates' && <section className="admin-card template-editor"><div className="admin-card-head"><div><h2><Workflow size={18} /> Template editor</h2><p>Shape the work once. New hires inherit a versioned, validated plan.</p></div><label className="admin-select-label">Role template<select value={roleKey} onChange={event => setRoleKey(event.target.value)}>{[...new Set(templates.map(item => item.role_key))].map(key => <option key={key}>{key}</option>)}</select></label></div>
      <div className="template-version"><span><b>Version {selected?.version ?? 1}</b> · {draft.length} tasks · {draft.reduce((total, task) => total + task.duration_days, 0)} estimated work days</span><span className="pill-ready">{selected?.active ? 'Published' : 'Draft'}</span></div>
      <div className="template-builder-heading"><div><span className="eyebrow">PLAN CANVAS</span><p>Select a task to edit it. Turn on connect mode, then choose the prerequisite and the task it unlocks.</p></div><button className={`button-secondary ${connecting ? 'connect-mode-active' : ''}`} aria-pressed={connecting} onClick={() => { setConnecting(active => !active); setSourceKey('') }}><MousePointer2 size={15} /> {connecting ? 'Exit connect mode' : 'Connect tasks'}</button></div>
      <TemplateGraph tasks={draft} selectedKey={selectedTask?.key ?? ''} onSelect={key => { setSelectedTaskKey(key); if (connecting) setSourceKey(key) }} onConnect={connectTasks} onDisconnect={disconnectTasks} connecting={connecting} sourceKey={sourceKey} />
      {selectedTask && <section className="template-task-inspector" aria-label="Selected task settings"><div className="template-inspector-heading"><div><span className="eyebrow">TASK SETTINGS</span><h3>{selectedTask.title || 'Untitled task'}</h3></div><button className="admin-icon-danger" onClick={() => { const remaining = draft.filter(task => task.key !== selectedTask.key).map(task => ({ ...task, depends_on: task.depends_on.filter(dep => dep !== selectedTask.key) })); setDraft(remaining); setSelectedTaskKey(remaining[0]?.key ?? '') }} aria-label={`Remove ${selectedTask.title || 'task'}`}><Trash2 size={15} /></button></div>
        <div className="template-inspector-fields"><label>Task title<input value={selectedTask.title} placeholder="e.g. Configure laptop" onChange={event => updateTask(selectedTask.key, { title: event.target.value })} /></label><label>Task key<input value={selectedTask.key} onChange={event => { const oldKey = selectedTask.key, nextKey = event.target.value; setDraft(rows => rows.map(task => ({ ...task, key: task.key === oldKey ? nextKey : task.key, depends_on: task.depends_on.map(dep => dep === oldKey ? nextKey : dep) }))); setSelectedTaskKey(nextKey) }} /></label><label>Owning team<select value={selectedTask.team} onChange={event => updateTask(selectedTask.key, { team: event.target.value })}><option>IT</option><option>HR</option><option>Facilities</option></select></label><label>Estimated days<input type="number" min={1} max={60} value={selectedTask.duration_days} onChange={event => updateTask(selectedTask.key, { duration_days: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })} /></label></div>
        <div className="template-dependencies"><div><strong>Prerequisites</strong><small>Work that must finish before this task begins.</small></div><div className="template-dependency-options">{draft.filter(task => task.key !== selectedTask.key).map(task => <label key={task.key}><input type="checkbox" checked={selectedTask.depends_on.includes(task.key)} onChange={event => updateTask(selectedTask.key, { depends_on: event.target.checked ? [...selectedTask.depends_on, task.key] : selectedTask.depends_on.filter(dep => dep !== task.key) })} /><span><b>{task.title || task.key}</b><small>{task.team} · {task.key}</small></span></label>)}{draft.length < 2 && <small>Add another task to create dependencies.</small>}</div></div>
        <label className="template-approval"><input type="checkbox" checked={selectedTask.needs_approval} onChange={event => updateTask(selectedTask.key, { needs_approval: event.target.checked })} /> Requires manager approval</label>
        <label className="template-approval"><input type="checkbox" checked={Boolean(selectedTask.fallback_title)} onChange={event => updateTask(selectedTask.key, event.target.checked ? { fallback_title: selectedTask.fallback_title || `Fallback: ${selectedTask.title || 'Alternate task'}`, fallback_days: selectedTask.fallback_days || 1 } : { fallback_title: null, fallback_days: null })} /> Add a recovery fallback</label>
        {selectedTask.fallback_title && <div className="template-fallback-fields"><label>Fallback task<input value={selectedTask.fallback_title} onChange={event => updateTask(selectedTask.key, { fallback_title: event.target.value })} /></label><label>Fallback days<input type="number" min={1} max={60} value={selectedTask.fallback_days ?? 1} onChange={event => updateTask(selectedTask.key, { fallback_days: Math.max(1, Math.min(60, Number(event.target.value) || 1)) })} /></label></div>}
      </section>}
      <div className="admin-actions"><button className="button-secondary" onClick={() => { const task = emptyTask(); setDraft(rows => [...rows, task]); setSelectedTaskKey(task.key) }}><Plus size={15} /> Add task</button><span className="template-validation-note">{graphIssues.length ? graphIssues[0] : 'Plan structure is valid and ready to publish.'}</span><button className="button-primary" disabled={publish.isPending || draft.length === 0 || graphIssues.length > 0} onClick={() => publish.mutate({ role_key: roleKey, tasks: draft })}><Save size={15} /> {publish.isPending ? 'Validating…' : 'Validate & publish'}</button></div>
    </section>}

    {path === '/users' && <div className="admin-grid"><section className="admin-card"><div className="admin-card-head"><div><h2><Users size={18} /> Team directory</h2><p>Active identities and assigned access roles.</p></div><span className="admin-count">{users.length} people</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Person</th><th>Role</th><th>Team</th><th>Access</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td><select aria-label={`Role for ${user.name}`} value={user.role} onChange={event => changeRole(user.id, user.name, event.target.value)}><option>ADMIN</option><option>HR</option><option>MANAGER</option><option>IT_STAFF</option><option>NEW_HIRE</option></select></td><td>{user.team || '—'}</td><td><button className={`access-toggle ${user.is_active ? 'active' : ''}`} onClick={() => changeAccess(user.id, user.name, user.is_active ?? true)}>{user.is_active ? 'Active' : 'Deactivated'}</button></td></tr>)}</tbody></table></div></section>
      <section className="admin-card invite-card"><h2><Plus size={18} /> Invite a teammate</h2><p>They’ll receive a one-time setup link through the local mail outbox.</p><form onSubmit={event => { event.preventDefault(); inviteUserMutation.mutate(invite) }}><label>Full name<input required value={invite.name} onChange={event => setInvite({ ...invite, name: event.target.value })} /></label><label>Work email<input type="email" required value={invite.email} onChange={event => setInvite({ ...invite, email: event.target.value })} /></label><label>Role<select value={invite.role} onChange={event => setInvite({ ...invite, role: event.target.value })}><option>HR</option><option>MANAGER</option><option>IT_STAFF</option><option>NEW_HIRE</option><option>ADMIN</option></select></label>{invite.role === 'IT_STAFF' && <label>Team<select value={invite.team} onChange={event => setInvite({ ...invite, team: event.target.value })}><option value="">Select team</option><option>IT</option><option>Facilities</option><option>HR</option></select></label>}<button className="button-primary" disabled={inviteUserMutation.isPending}><Mail size={15} /> Create invitation</button></form></section></div>}

    {path === '/settings' && <><section className="admin-card settings-card"><div className="admin-card-head"><div><h2><Shield size={18} /> Service guardrails</h2><p>Configure the local monitor thresholds and organization clock.</p></div><span className="settings-note">Changes are audited</span></div><div className="settings-grid"><label>Stall after business days<input type="number" min={1} max={30} value={settingsDraft.stall_after_days} onChange={event => setSettingsDraft({ ...settingsDraft, stall_after_days: Number(event.target.value) })} /><small>Tasks with no activity past this window enter stall review.</small></label><label>Near-critical slack margin<input type="number" min={0} max={10} value={settingsDraft.near_critical_margin} onChange={event => setSettingsDraft({ ...settingsDraft, near_critical_margin: Number(event.target.value) })} /><small>Only tasks inside this margin are eligible for intervention.</small></label><label>Monitor interval (minutes)<input type="number" min={1} max={1440} value={settingsDraft.monitor_interval_minutes} onChange={event => setSettingsDraft({ ...settingsDraft, monitor_interval_minutes: Number(event.target.value) })} /><small>The running scheduler adopts this interval immediately.</small></label><label>Organization timezone<select value={settingsDraft.timezone} onChange={event => setSettingsDraft({ ...settingsDraft, timezone: event.target.value })}><option>Asia/Kolkata</option><option>UTC</option><option>America/New_York</option><option>Europe/London</option></select><small>Used when displaying organization dates.</small></label><label>Organization holidays<textarea aria-label="Organization holidays" rows={4} placeholder="2026-12-25&#10;2027-01-01" value={settingsDraft.holidays} onChange={event => setSettingsDraft({ ...settingsDraft, holidays: event.target.value })} /><small>One ISO date per line; excluded from business-day calculations.</small></label></div><label className="setting-switch"><input type="checkbox" checked={settingsDraft.auto_worker_enabled} onChange={event => setSettingsDraft({ ...settingsDraft, auto_worker_enabled: event.target.checked })} /><span><b>Demo auto-worker</b><small>Advance mock tickets during walkthroughs.</small></span><span className="pill-muted">Experimental</span></label><button className="button-primary" onClick={() => save.mutate({ ...settingsDraft, holidays: [...new Set(settingsDraft.holidays.split(/[\s,]+/).filter(Boolean))] })} disabled={save.isPending}><Save size={15} /> Save settings</button></section><section className="admin-card clock-card"><div><span className="eyebrow">DEMO CLOCK</span><h2>Move the simulation</h2><p>Set the current business day for this demo workspace.</p></div><div className="clock-controls"><label>Current day<input type="number" min={0} max={365} value={clockDay} onChange={event => setClockDay(Number(event.target.value))} /></label><button className="button-secondary" onClick={() => setDemoClock(clockDay).then(() => { setNotice(`Demo clock moved to day ${clockDay}.`); void qc.invalidateQueries() })}>Set demo day</button></div></section></>}

    {path === '/audit' && <section className="admin-card"><div className="admin-card-head"><div><h2><Activity size={18} /> Audit trail</h2><p>Human decisions and system actions from the local workspace.</p></div><button className="button-secondary" onClick={exportAudit}><Download size={15} /> Export CSV</button></div><div className="audit-toolbar"><input aria-label="Filter audit records" placeholder="Filter by action, actor, or target…" value={auditQuery} onChange={event => setAuditQuery(event.target.value)} /><span>{filteredAudit.length} events</span></div><div className="audit-list" tabIndex={0} aria-label="Audit records">{filteredAudit.map((row: AuditRecord) => <article key={row.id} className="audit-row"><span className={`audit-source ${row.source}`}>{row.source === 'security' ? 'SEC' : 'FLOW'}</span><div><strong>{row.kind.replace(/_/g, ' ')}</strong><p>{row.detail || row.target}</p><small>{row.actor} · {row.target} · {new Date(row.created_at).toLocaleString()}</small></div></article>)}{filteredAudit.length === 0 && <div className="admin-empty">No audit records match this filter.</div>}</div></section>}

    {path === '/app/dev/mail' && <section className="admin-card"><div className="admin-card-head"><div><h2><Archive size={18} /> Development mail outbox</h2><p>Invitation and password recovery messages are captured here; no email is sent externally.</p></div><span className="admin-count">{mail.length} messages</span></div><div className="mail-list">{mail.map(item => <article key={item.id}><span className="mail-icon"><Mail size={16} /></span><div><strong>{item.subject}</strong><small>To {item.recipient} · {new Date(item.created_at).toLocaleString()}</small><p>{item.body}</p></div></article>)}{mail.length === 0 && <div className="admin-empty">No messages in the outbox yet.</div>}</div></section>}
  </main>
}
