import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getMetrics, runExperiment, type ExperimentParams } from '../api/client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface ExperimentResult {
  n_hires: number
  stall_probability: number
  seed: number
  static_checklist_readiness_pct: number
  orchestrator_readiness_pct: number
  improvement_pct: number
  method: string
}

interface Metrics {
  current_day: number
  itsm_offline: boolean
  total_hires: number
  ready_hires: number
  at_risk_hires: number
  on_track_hires: number
  day1_readiness_pct: number
  escalations: number
  stalls_rescued: number
  outbox_pending: number
}

export default function InsightsPage() {
  const { data: metrics } = useQuery<Metrics>({ queryKey: ['metrics'], queryFn: getMetrics, refetchInterval: 5000 })
  const [expResult, setExpResult] = useState<ExperimentResult | null>(null)
  const [params, setParams] = useState<ExperimentParams>({ n_hires: 200, stall_probability: 0.2, seed: 42 })

  const expMut = useMutation({ mutationFn: runExperiment, onSuccess: setExpResult })

  const chartData = expResult ? [
    { name: 'Static\nChecklist', readiness: expResult.static_checklist_readiness_pct, fill: '#94a3b8' },
    { name: 'Orchestrator', readiness: expResult.orchestrator_readiness_pct, fill: '#3b82f6' },
  ] : []

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Insights & Experiment</h1>

      {/* KPI cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: 'Day-1 Readiness', value: `${metrics.day1_readiness_pct}%`, sub: `${metrics.ready_hires}/${metrics.total_hires} hires`, color: 'text-blue-600' },
            { label: 'At Risk', value: metrics.at_risk_hires, sub: 'hires behind schedule', color: metrics.at_risk_hires > 0 ? 'text-red-600' : 'text-gray-600' },
            { label: 'Escalations', value: metrics.escalations, sub: 'critical stalls detected', color: metrics.escalations > 0 ? 'text-red-600' : 'text-gray-600' },
            { label: 'Stalls Rescued', value: metrics.stalls_rescued, sub: 'via fallback', color: 'text-green-600' },
            { label: 'Outbox Pending', value: metrics.outbox_pending, sub: 'queued (ITSM offline)', color: metrics.outbox_pending > 0 ? 'text-orange-600' : 'text-gray-600' },
            { label: 'Current Day', value: `Day ${metrics.current_day}`, sub: metrics.itsm_offline ? '🔴 ITSM OFFLINE' : '✅ ITSM online', color: metrics.itsm_offline ? 'text-red-600' : 'text-gray-600' },
          ].map(k => (
            <div key={k.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="text-xs text-gray-500 mb-1">{k.label}</div>
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-gray-400 mt-1">{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Experiment */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-1">Comparative Experiment</h2>
        <p className="text-sm text-gray-500 mb-5">
          Monte Carlo simulation: static checklist vs orchestrator with CPM + stall rescue.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-5">
          {[
            { label: 'N Hires', key: 'n_hires', type: 'number', min: 10, max: 1000, step: 10 },
            { label: 'Stall Probability', key: 'stall_probability', type: 'number', min: 0, max: 1, step: 0.05 },
            { label: 'Seed', key: 'seed', type: 'number', min: 1, max: 9999, step: 1 },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
              <input type={f.type} min={f.min} max={f.max} step={f.step}
                value={(params as any)[f.key]}
                onChange={e => setParams({ ...params, [f.key]: Number(e.target.value) })}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700" />
            </div>
          ))}
        </div>

        <button onClick={() => expMut.mutate(params)} disabled={expMut.isPending}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 mb-6 transition-colors">
          {expMut.isPending ? 'Running…' : '▶ Run Experiment'}
        </button>

        {expResult && (
          <div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 text-center">
                <div className="text-3xl font-bold text-gray-500">{expResult.static_checklist_readiness_pct}%</div>
                <div className="text-xs text-gray-400 mt-1">Static Checklist</div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center border-2 border-blue-200 dark:border-blue-800">
                <div className="text-3xl font-bold text-blue-600">{expResult.orchestrator_readiness_pct}%</div>
                <div className="text-xs text-gray-400 mt-1">Orchestrator</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
                <div className="text-3xl font-bold text-green-600">+{expResult.improvement_pct}pp</div>
                <div className="text-xs text-gray-400 mt-1">Improvement</div>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v}%`, 'Day-1 Readiness']} />
                <Bar dataKey="readiness" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <p className="text-xs text-gray-400 mt-4 bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
              ⚠️ {expResult.method}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
