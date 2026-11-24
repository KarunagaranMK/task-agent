import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  getHire, getHireTasks, getHireAudit, explainRisk, approveTask, rejectTask,
  runWhatIf, type Hire, type Task, type AuditEvent, type WhatIfResult,
} from '../api/client'

const STATUS_STYLE: Record<string, string> = {
  done: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  dispatched: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  awaiting_approval: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  queued: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const TEAM_STYLE: Record<string, string> = {
  IT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  HR: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  Facilities: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}
const HIRE_STYLE: Record<string, string> = {
  on_track: 'bg-green-100 text-green-700', at_risk: 'bg-red-100 text-red-700', ready: 'bg-blue-100 text-blue-700',
}

export default function HireDetail() {
  const { id } = useParams<{ id: string }>()
  const hid = Number(id)
  const qc = useQueryClient()
  const { data: hire } = useQuery<Hire>({ queryKey: ['hire', hid], queryFn: () => getHire(hid), refetchInterval: 5000 })
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ['hire-tasks', hid], queryFn: () => getHireTasks(hid), refetchInterval: 5000 })
  const { data: audit = [] } = useQuery<AuditEvent[]>({ queryKey: ['hire-audit', hid], queryFn: () => getHireAudit(hid), refetchInterval: 5000 })
  const [explanation, setExplanation] = useState('')
  const [explainLoading, setExplainLoading] = useState(false)
  const [scenarioTask, setScenarioTask] = useState('')
  const [delay, setDelay] = useState(0)
  const [scenario, setScenario] = useState<WhatIfResult | null>(null)

  const approveMut = useMutation({ mutationFn: approveTask, onSuccess: () => qc.invalidateQueries({ queryKey: ['hire-tasks', hid] }) })
  const rejectMut = useMutation({ mutationFn: rejectTask, onSuccess: () => qc.invalidateQueries({ queryKey: ['hire-tasks', hid] }) })
  const scenarioMut = useMutation({ mutationFn: ({ key, days }: { key: string; days: number }) => runWhatIf(hid, key, days), onSuccess: setScenario })
  useEffect(() => {
    if (!scenarioTask) return
    const timer = window.setTimeout(() => scenarioMut.mutate({ key: scenarioTask, days: delay }), 250)
    return () => window.clearTimeout(timer)
  }, [scenarioTask, delay, hid])

  if (!hire) return <div className="text-center py-16 text-gray-600">Loading…</div>

  const criticalTasks = tasks.filter(t => t.critical && t.status !== 'done')

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-gray-600 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-200">← All Hires</Link>
        <span className="text-gray-300">/</span>
        <span className="font-medium">{hire.name}</span>
      </div>

      {/* Hero */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">{hire.name}</h1>
            <p className="text-sm text-gray-500 mt-1">{hire.role} · {hire.department}</p>
          </div>
          <span className={`text-sm px-3 py-1 rounded-full font-semibold ${HIRE_STYLE[hire.status] || ''}`}>
            {hire.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Start Day', value: `Day ${hire.start_day}` },
            { label: 'Projected', value: `Day ${hire.projected_day ?? hire.start_day}`, warn: (hire.projected_day ?? 0) > hire.start_day },
            { label: 'Readiness', value: `${hire.readiness}%` },
            { label: 'Critical Tasks', value: criticalTasks.length, warn: criticalTasks.length > 0 },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">{s.label}</div>
              <div className={`text-xl font-bold ${s.warn ? 'text-red-700' : ''}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500">Readiness</span>
          <span className="text-xs font-medium">{hire.readiness}%</span>
        </div>
        <div className="bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div className={`h-3 rounded-full transition-all ${hire.status === 'at_risk' ? 'bg-red-500' : hire.status === 'ready' ? 'bg-blue-500' : 'bg-green-500'}`}
            style={{ width: `${hire.readiness}%` }} />
        </div>
      </div>

      {/* AI explain */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">🤖 AI Risk Analysis</h3>
          <button onClick={async () => {
            setExplainLoading(true)
            try { const r = await explainRisk(hid); setExplanation(r.explanation) } catch { setExplanation('Could not fetch explanation.') }
            setExplainLoading(false)
          }} className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors">
            {explainLoading ? 'Analyzing…' : 'Why is this at risk?'}
          </button>
        </div>
        {explanation && (
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-100 dark:border-purple-800">
            {explanation}
          </p>
        )}
      </div>

      {/* Tasks */}
      <section className="whatif-card">
        <div className="section-heading"><div><span className="eyebrow">SCENARIO PLANNER</span><h2>What if a task slips?</h2><p>Explore the impact on the critical path without changing live work.</p></div><span className="pill-muted">No data is changed</span></div>
        <div className="whatif-controls"><label>Open task<select value={scenarioTask} onChange={event => { setScenarioTask(event.target.value); setScenario(null) }}><option value="">Choose a task</option>{tasks.filter(task => !['done', 'blocked'].includes(task.status)).map(task => <option key={task.key} value={task.key}>{task.title}</option>)}</select></label><label className="delay-range">Added delay <strong>{delay} business {delay === 1 ? 'day' : 'days'}</strong><input type="range" min={0} max={10} step={1} value={delay} onChange={event => { setDelay(Number(event.target.value)); setScenario(null) }} /></label><button className="button-primary" disabled={!scenarioTask || scenarioMut.isPending} onClick={() => scenarioTask && scenarioMut.mutate({ key: scenarioTask, days: delay })}>{scenarioMut.isPending ? 'Recalculating…' : 'Calculate impact'}</button></div>
        {scenario && <div className="whatif-result"><div><small>Projected ready day</small><strong>Day {scenario.projected_ready_day}</strong></div><div><small>Change from baseline</small><strong className={scenario.delta_days > 0 ? 'delta-warn' : 'delta-good'}>{scenario.delta_days > 0 ? '+' : ''}{scenario.delta_days} days</strong></div><div className="whatif-path"><small>Updated critical path</small><span>{scenario.critical_path.join('  →  ') || 'No remaining tasks'}</span></div></div>}
        {scenarioMut.isError && <p className="whatif-error">Choose an open task and try the scenario again.</p>}
      </section>

      {/* Tasks */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold mb-4">Tasks ({tasks.length})</h3>
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.id}
              className={`p-3 rounded-lg border-2 transition-colors ${t.critical ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10' : 'border-gray-100 dark:border-gray-700'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {t.critical && <span className="text-red-700 dark:text-red-400 text-xs font-bold shrink-0">★ CRIT</span>}
                  <span className="font-medium text-sm truncate">{t.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TEAM_STYLE[t.team] || ''}`}>{t.team}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status] || ''}`}>{t.status.replace('_', ' ')}</span>
                  {t.slack !== null && (
                    <span className={`text-xs font-mono ${t.slack < 0 ? 'text-red-700 font-bold' : 'text-gray-600'}`}>
                      slack:{t.slack.toFixed(1)}d
                    </span>
                  )}
                  {t.flag && t.flag !== 'none' && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                      {t.flag}
                    </span>
                  )}
                </div>
              </div>
              {t.depends_on.length > 0 && (
                <p className="text-xs text-gray-600 mt-1 ml-1">↳ after: {t.depends_on.join(', ')}</p>
              )}
              {t.ticket_id && <p className="text-xs text-gray-600 mt-1 font-mono ml-1">{t.ticket_id}</p>}
              {t.status === 'awaiting_approval' && (
                <div className="mt-2 flex gap-2">
                  <button onClick={() => approveMut.mutate(t.id)} className="text-xs bg-green-700 text-white px-3 py-1 rounded-lg hover:bg-green-800">✓ Approve</button>
                  <button onClick={() => rejectMut.mutate(t.id)} className="text-xs bg-red-700 text-white px-3 py-1 rounded-lg hover:bg-red-800">✗ Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Audit */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold mb-4">Audit Timeline ({audit.length} events)</h3>
        <div className="space-y-2 max-h-80 overflow-y-auto" tabIndex={0} role="region" aria-label="Audit timeline">
          {[...audit].reverse().map(e => (
            <div key={e.id} className="flex gap-3 text-sm items-start">
              <span className={`shrink-0 text-xs font-mono pt-0.5 w-14 ${e.level === 'critical' ? 'text-red-700' : e.level === 'warning' ? 'text-yellow-700' : 'text-gray-600'}`}>
                Day {e.day}
              </span>
              <span className="shrink-0 mt-0.5">{e.level === 'critical' ? '🔴' : e.level === 'warning' ? '🟡' : '🟢'}</span>
              <span className="text-gray-600 dark:text-gray-300 text-xs">{e.message}</span>
            </div>
          ))}
          {audit.length === 0 && <p className="text-gray-600 text-xs">No events yet. Run Monitor Tick.</p>}
        </div>
      </div>
    </div>
  )
}
