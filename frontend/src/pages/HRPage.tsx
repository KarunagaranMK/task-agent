import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getHires, createHire, type Hire } from '../api/client'

const ROLES = ['Data Analyst', 'Software Engineer', 'default']
const DEPTS = ['Analytics', 'Engineering', 'Marketing', 'HR', 'Finance', 'Operations']

const STATUS_STYLES: Record<string, string> = {
  on_track: 'text-green-700 bg-green-100 dark:bg-green-900/30 dark:text-green-400',
  at_risk: 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
  ready: 'text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
}
const BAR_COLORS: Record<string, string> = {
  on_track: 'bg-green-500', at_risk: 'bg-red-500', ready: 'bg-blue-500',
}

export default function HRPage() {
  const qc = useQueryClient()
  const { data: hires = [], isLoading } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires, refetchInterval: 5000 })
  const [form, setForm] = useState({ name: '', role: 'Data Analyst', department: 'Analytics', start_day: 8 })
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: createHire,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hires'] }); setForm(f => ({ ...f, name: '' })); setErr('') },
    onError: () => setErr('Failed to create hire. Is the backend running?'),
  })

  return (
    <div className="space-y-6">
      {/* Register form */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">Register New Hire</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Full Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="e.g. Priya Sharma" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Role</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700">
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Department</label>
            <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700">
              {DEPTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Start Day (days from now)</label>
            <input type="number" min={1} max={30} value={form.start_day}
              onChange={e => setForm({ ...form, start_day: Number(e.target.value) })}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700" />
          </div>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button onClick={() => form.name && mutation.mutate(form)}
          disabled={!form.name || mutation.isPending}
          className="mt-4 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Creating…' : '+ Onboard Hire'}
        </button>
      </div>

      {/* Hire list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Active Hires</h2>
          <span className="text-sm text-gray-500">{hires.length} total</span>
        </div>
        {isLoading ? <p className="text-gray-400 text-sm">Loading…</p> : (
          <div className="space-y-3">
            {hires.map(h => (
              <Link key={h.id} to={`/hire/${h.id}`}
                className="block p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors group">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{h.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{h.role} · {h.department}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[h.status] || ''}`}>
                      {h.status.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-400">Day {h.start_day}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${BAR_COLORS[h.status] || 'bg-gray-400'}`}
                      style={{ width: `${h.readiness}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-right">{h.readiness}%</span>
                </div>
              </Link>
            ))}
            {hires.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">
                No hires yet. Register one above, or run <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">python seed.py</code> for demo data.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
