import { useMemo, useState } from 'react'
import { Clock3, Minus, Plus, X } from 'lucide-react'
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react'
import type { Task } from '../api/client'

type ScheduledTask = Task & {
  current_day: number
  dispatched_day: number | null
  remaining_days: number
  schedule_start_day: number | null
  schedule_finish_day: number | null
}

type Props = { tasks: ScheduledTask[]; dayOne: number; currentDay: number }

const isStalled = (task: ScheduledTask) => task.flag === 'watch' || task.flag === 'escalated'
const statusLabel = (status: string) => status.replace(/_/g, ' ')

function TaskInspector({ task, onClose }: { task: ScheduledTask | null; onClose: () => void }) {
  if (!task) return null
  return <div className="task-inspector-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <aside className="task-inspector" role="dialog" aria-modal="true" aria-labelledby="task-inspector-title">
      <header><div><span className="eyebrow">{task.team} WORKSTREAM</span><h2 id="task-inspector-title">Task details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close task details"><X size={18} /></button></header>
      <h3>{task.title}</h3>
      <div className="inspector-status"><span className={`status-pill ${task.status === 'done' ? 'ready' : task.status === 'blocked' ? 'at_risk' : 'on_track'}`}>{statusLabel(task.status)}</span>{task.critical && <span className="critical-chip">Critical path</span>}</div>
      <dl><div><dt>Estimated effort</dt><dd>{task.duration_days} business {task.duration_days === 1 ? 'day' : 'days'}</dd></div><div><dt>Remaining effort</dt><dd>{task.remaining_days} {task.remaining_days === 1 ? 'day' : 'days'}</dd></div><div><dt>Slack</dt><dd>{task.slack === null ? '—' : `${task.slack.toFixed(1)} days`}</dd></div><div><dt>Ticket</dt><dd>{task.ticket_id ?? 'Not dispatched yet'}</dd></div></dl>
      <section className="inspector-dependencies"><h4>Dependencies</h4>{task.depends_on.length ? <ul>{task.depends_on.map(dep => <li key={dep}>{dep.replace(/:/g, ' · ')}</li>)}</ul> : <p>This task can start immediately.</p>}</section>
    </aside>
  </div>
}

export function DependencyGraph({ tasks }: { tasks: ScheduledTask[] }) {
  const [selected, setSelected] = useState<ScheduledTask | null>(null)
  const flow = useMemo(() => {
    const taskByKey = new Map(tasks.map(task => [task.key, task]))
    const rank = new Map(tasks.map(task => [task.key, 0]))
    for (let pass = 0; pass < tasks.length; pass += 1) {
      for (const task of tasks) {
        const parents = task.depends_on.filter(key => taskByKey.has(key))
        if (parents.length) rank.set(task.key, Math.max(...parents.map(key => (rank.get(key) ?? 0) + 1)))
      }
    }
    const columns = new Map<number, ScheduledTask[]>()
    for (const task of tasks) {
      const column = rank.get(task.key) ?? 0
      columns.set(column, [...(columns.get(column) ?? []), task])
    }
    const positions = new Map<string, { x: number; y: number }>()
    for (const [column, rows] of columns) rows.forEach((task, row) => positions.set(task.key, { x: 40 + column * 280, y: 40 + row * 110 }))
    const nodes: Node[] = tasks.flatMap(task => {
      const position = positions.get(task.key)
      if (!position) return []
      const stalled = isStalled(task)
      return [{ id: task.key, position, data: { label: `${task.title}\n${task.team} · ${statusLabel(task.status)}${task.critical ? ' · CRITICAL PATH' : ''}` }, className: `task-flow-node${task.critical ? ' is-critical' : ''}${stalled ? ' is-stalled' : ''}${task.status === 'done' ? ' is-complete' : ''}`, style: { width: 220 } }]
    })
    const edges: Edge[] = tasks.flatMap(task => task.depends_on.filter(key => taskByKey.has(key)).map(dependency => ({
      id: `${dependency}-${task.key}`, source: dependency, target: task.key,
      animated: isStalled(task),
      style: { stroke: task.critical && taskByKeyCritical(tasks, dependency) ? '#0c1b3a' : '#94a3b8', strokeWidth: task.critical ? 2.5 : 1.5 },
      label: task.critical && taskByKeyCritical(tasks, dependency) ? 'critical' : undefined,
      labelStyle: { fill: '#596778', fontSize: 10 },
    })))
    return { nodes, edges }
  }, [tasks])

  const related = useMemo(() => {
    if (!selected) return new Set<string>()
    const keys = new Set([selected.key])
    let changed = true
    while (changed) {
      changed = false
      for (const task of tasks) {
        if (task.depends_on.some(key => keys.has(key)) && !keys.has(task.key)) { keys.add(task.key); changed = true }
        if (keys.has(task.key)) for (const dependency of task.depends_on) if (!keys.has(dependency)) { keys.add(dependency); changed = true }
      }
    }
    return keys
  }, [selected, tasks])

  return <section className="visual-card" aria-label="Task dependency graph">
    <div className="visual-heading"><div><span className="eyebrow">DEPENDENCY MAP</span><h2>How the work connects</h2><p>Select a task to trace its upstream and downstream work.</p></div><div className="visual-legend"><span><i className="legend-critical" />Critical path</span><span><i className="legend-standard" />Other work</span><span><i className="legend-stalled" />Needs attention</span></div></div>
    <div className="graph-canvas" role="region" aria-label="Interactive task dependency graph"><ReactFlow nodes={flow.nodes.map(node => ({ ...node, style: { ...node.style, opacity: selected && !related.has(node.id) ? .3 : 1 } }))} edges={flow.edges.map(edge => ({ ...edge, style: { ...edge.style, opacity: selected && !(related.has(edge.source) && related.has(edge.target)) ? .15 : 1 } }))} fitView fitViewOptions={{ padding: 0.22 }} minZoom={0.35} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => setSelected(tasks.find(task => task.key === node.id) ?? null)} aria-label="Task dependency graph">
      <Background color="#cbd5e1" gap={22} size={1} /><MiniMap pannable zoomable /><Controls showInteractive={false} />
    </ReactFlow></div>
    <div className="graph-controls"><span>{tasks.length} tasks · {tasks.reduce((sum, task) => sum + task.depends_on.length, 0)} dependencies <small className="graph-pan-hint">Drag to pan · scroll to zoom</small></span><div><span>Use controls on canvas to zoom and fit the graph</span></div></div>
    <TaskInspector task={selected} onClose={() => setSelected(null)} />
  </section>
}

function taskByKeyCritical(tasks: ScheduledTask[], key: string) { return tasks.find(task => task.key === key)?.critical ?? false }

export function GanttCriticalPath({ tasks, dayOne, currentDay }: Props) {
  const [selected, setSelected] = useState<ScheduledTask | null>(null)
  const [scale, setScale] = useState(58)
  const lastDay = Math.max(dayOne + 1, currentDay + 1, ...tasks.map(task => task.schedule_finish_day ?? currentDay))
  const width = Math.max(780, 210 + lastDay * scale)
  const rowHeight = 53
  return <section className="visual-card" aria-label="Onboarding schedule">
    <div className="visual-heading"><div><span className="eyebrow">PROJECT SCHEDULE</span><h2>Estimated work by day</h2><p>Live remaining effort, dependencies, and the Day 1 deadline.</p></div><div className="schedule-controls"><button aria-label="Zoom out schedule" className="icon-button" onClick={() => setScale(value => Math.max(30, value - 8))}><Minus size={15} /></button><span>{scale < 48 ? 'Weeks' : 'Days'}</span><button aria-label="Zoom in schedule" className="icon-button" onClick={() => setScale(value => Math.min(90, value + 8))}><Plus size={15} /></button></div></div>
    <div className="schedule-scroll" tabIndex={0} role="region" aria-label="Scrollable onboarding schedule"><svg className="schedule-svg" role="img" aria-label={`Task schedule from day 0 to day ${lastDay}, Day 1 deadline at day ${dayOne}`} width={width} height={72 + tasks.length * rowHeight}>
      <defs><pattern id="schedule-stripes" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="3" height="7" fill="#b91c1c" opacity=".22" /></pattern></defs>
      {Array.from({ length: lastDay + 1 }, (_, day) => <g key={day}><line x1={210 + day * scale} x2={210 + day * scale} y1={48} y2={66 + tasks.length * rowHeight} stroke={day === currentDay ? '#0f766e' : '#e2e8f0'} strokeWidth={day === currentDay ? 2 : 1} strokeDasharray={day === currentDay ? '4 4' : undefined} /><text x={210 + day * scale + 4} y={34} className="schedule-day-label">{day === 0 ? 'Today' : `Day ${day}`}</text></g>)}
      <line x1={210 + dayOne * scale} x2={210 + dayOne * scale} y1={43} y2={66 + tasks.length * rowHeight} stroke="#b45309" strokeWidth="2" /><text x={210 + dayOne * scale + 5} y={52} className="schedule-deadline-label">DAY 1</text>
      {tasks.map((task, index) => {
        const y = 68 + index * rowHeight
        const done = task.status === 'done'
        const start = done ? null : task.schedule_start_day
        const finish = done ? null : task.schedule_finish_day
        const left = start === null ? null : 210 + start * scale
        const barWidth = left === null || finish === null ? 0 : Math.max(9, (finish - (start ?? finish)) * scale)
        const visibleTitle = task.title.length > 26 ? `${task.title.slice(0, 25)}…` : task.title
        return <g key={task.key} className="schedule-row" onClick={() => setSelected(task)}>
          <rect x="0" y={y - 8} width={width} height={rowHeight} className="schedule-row-bg" />
          <text x="8" y={y + 9} className="schedule-task-title">{visibleTitle}</text>
          <text x="8" y={y + 25} className="schedule-task-team">{task.team} · {done ? 'Complete' : `${task.remaining_days}d remaining`}</text>
          {done ? <g><rect x={210 + Math.max(0, currentDay - 1) * scale} y={y} width={Math.max(18, scale)} height="20" rx="6" className="schedule-done-bar" /><text x={218 + Math.max(0, currentDay - 1) * scale} y={y + 14} className="schedule-bar-label">Done</text></g> : left !== null && <g><rect x={left} y={y} width={barWidth} height="20" rx="6" className={`schedule-bar${task.critical ? ' is-critical' : ''}${isStalled(task) ? ' is-stalled' : ''}`} fill={isStalled(task) ? 'url(#schedule-stripes)' : undefined} /><text x={left + 8} y={y + 14} className="schedule-bar-label">{task.critical ? 'Critical · ' : ''}{Math.max(1, Math.round(finish! - start!))}d</text></g>}
        </g>
      })}
    </svg></div>
    <div className="sr-only" aria-label="Schedule task details">{tasks.map(task => <button key={task.key} onClick={() => setSelected(task)}>Inspect {task.title} schedule details</button>)}</div>
    <div className="schedule-legend"><span><i className="legend-critical" />Critical path</span><span><i className="legend-standard" />Other tasks</span><span><i className="legend-stalled" />Stalled or watch</span><span><i className="legend-deadline" />Day 1 deadline</span><span><Clock3 size={12} /> Today: day {currentDay}</span></div>
    <TaskInspector task={selected} onClose={() => setSelected(null)} />
  </section>
}
