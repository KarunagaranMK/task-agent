import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { advanceDay, monitorTick, toggleITSM, resetAll } from '../api/client'

export default function DemoPanel() {
  const qc = useQueryClient()
  const [itsmOffline, setItsmOffline] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [day, setDay] = useState<number | null>(null)

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
          {advMut.isPending ? <span className="animate-spin">⏳</span> : '⏭'} Advance Day
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
