import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { advanceDay, getHires, getMetrics, monitorTick, toggleITSM, resetAll } from '../api/client'

export default function DemoPanel() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [itsmOffline, setItsmOffline] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [day, setDay] = useState<number | null>(null)
  const [guidedStep, setGuidedStep] = useState<number | null>(null)
  const { data: metrics } = useQuery({ queryKey: ['metrics'], queryFn: getMetrics })
  const { data: hires = [], isLoading: hiresLoading } = useQuery({ queryKey: ['hires'], queryFn: getHires })
  const featuredHire = hires.find(hire => hire.name === 'Priya Sharma') ?? hires[0]
  useEffect(() => {
    if (metrics) {
      setItsmOffline(metrics.itsm_offline)
      setDay(metrics.current_day)
    }
  }, [metrics])
  const guide = [
    { title: 'Start with Priya’s plan', detail: 'Review the laptop critical path and the work shared across HR, IT, and Facilities.', route: '/' },
    { title: 'Review the access gate', detail: 'See how manager approval holds sensitive access until a person makes the decision.', route: featuredHire ? `/hire/${featuredHire.id}` : '/' },
    { title: 'Coordinate the team queue', detail: 'Open a ticket to see its owner, service timer, comments, and safe workflow actions.', route: '/it' },
    { title: 'Simulate a recovery', detail: 'Advance the business day and run the monitor to see deterministic stall handling.', route: '/it' },
    { title: 'Compare the outcome', detail: 'Run a reproducible experiment and compare Day-1 readiness policies.', route: '/insights' },
  ]

  const addLog = (msg: string) => setLog(l => [`${new Date().toLocaleTimeString()} ${msg}`, ...l.slice(0, 11)])

  const advMut = useMutation({
    mutationFn: advanceDay,
    onSuccess: (d) => { setDay(d.current_day); qc.invalidateQueries(); addLog(`Day → ${d.current_day}`) },
    onError: () => addLog('❌ Backend unreachable'),
  })
  const tickMut = useMutation({
    mutationFn: monitorTick,
    onSuccess: (d) => { qc.invalidateQueries(); addLog(`Monitor ✓ day ${d.current_day}`) },
  })
  const chaosMut = useMutation({
    mutationFn: (v: boolean) => toggleITSM(v),
    onSuccess: (d) => { setItsmOffline(d.itsm_offline); qc.invalidateQueries(); addLog(d.itsm_offline ? '🔴 ITSM offline' : '✅ ITSM online') },
  })
  const resetMut = useMutation({
    mutationFn: resetAll,
    onSuccess: () => { setDay(null); setItsmOffline(false); setLog([]); qc.invalidateQueries(); addLog('Reset complete') },
  })

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sticky top-20">
      <h3 className="font-semibold mb-4 flex items-center gap-2 text-sm">
        🎮 Demo Controls
        {day !== null && <span className="ml-auto text-xs text-gray-400 font-mono">Day {day}</span>}
      </h3>

      <div className="space-y-2">
        <button onClick={() => advMut.mutate()} disabled={advMut.isPending}
          className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
          {advMut.isPending ? <span className="animate-spin">⏳</span> : '⏭'} Advance 1 business day
        </button>

        <button onClick={() => tickMut.mutate()} disabled={tickMut.isPending}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {tickMut.isPending ? '…' : '🔄'} Run Monitor
        </button>

        <button
          onClick={() => chaosMut.mutate(!itsmOffline)}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
            itsmOffline
              ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}>
          {itsmOffline ? '🔴 ITSM OFFLINE' : '⚡ Toggle ITSM Offline'}
        </button>

        <button
          onClick={() => { if (window.confirm('Reset all demo data?')) resetMut.mutate() }}
          className="w-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
          🗑 Reset Demo
        </button>
      </div>

      <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
        {guidedStep === null ? <button className="w-full border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 py-2 rounded-lg text-xs font-semibold hover:bg-teal-50 dark:hover:bg-teal-900/20" onClick={() => { setGuidedStep(0); navigate(guide[0].route) }}>▶ Play guided demo</button> : <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/15 p-3" role="status" aria-live="polite"><div className="flex items-center justify-between text-[10px] font-bold text-teal-800 dark:text-teal-200"><span>GUIDED WALKTHROUGH · {guidedStep + 1} / {guide.length}</span><button onClick={() => setGuidedStep(null)} aria-label="End guided walkthrough">×</button></div><strong className="block mt-2 text-xs text-gray-800 dark:text-gray-100">{guide[guidedStep].title}</strong><p className="mt-1 text-[10px] leading-relaxed text-gray-600 dark:text-gray-300">{guide[guidedStep].detail}</p><button className="mt-3 w-full bg-teal-700 text-white py-2 rounded-md text-[10px] font-semibold" disabled={guidedStep === 0 && hiresLoading} onClick={() => { const next = guidedStep + 1; if (next >= guide.length) setGuidedStep(null); else { setGuidedStep(next); navigate(guide[next].route) } }}>{guidedStep === guide.length - 1 ? 'Finish walkthrough' : guidedStep === 0 && hiresLoading ? 'Loading Priya’s plan…' : 'Continue to next step'}</button></div>}
      </div>

      {log.length > 0 && (
        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <p className="text-xs text-gray-400 mb-2">Activity</p>
          <div className="space-y-0.5 max-h-36 overflow-y-auto">
            {log.map((l, i) => (
              <p key={i} className="text-xs font-mono text-gray-500 dark:text-gray-400">{l}</p>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3 text-xs text-gray-400 space-y-1">
        <p><strong>Demo flow:</strong></p>
        <p>1. Run Monitor → see tasks dispatch</p>
        <p>2. Manager approves access</p>
        <p>3. IT: Stall the laptop ticket</p>
        <p>4. Advance Day × 2 → escalation</p>
        <p>5. Toggle ITSM offline → outbox</p>
        <p>6. Toggle online → drain (no dupes)</p>
        <p>7. Complete tickets → Day-1 Ready 🎉</p>
      </div>
    </div>
  )
}
