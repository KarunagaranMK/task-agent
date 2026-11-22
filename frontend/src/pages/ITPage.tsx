import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTickets, completeTicket, stallTicket, type Ticket } from '../api/client'

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  done: 'bg-green-100 text-green-700', stalled: 'bg-red-100 text-red-700',
}
const TEAM_STYLE: Record<string, string> = {
  IT: 'bg-purple-100 text-purple-700', HR: 'bg-teal-100 text-teal-700', Facilities: 'bg-orange-100 text-orange-700',
}

export default function ITPage() {
  const qc = useQueryClient()
  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['tickets'], queryFn: getTickets, refetchInterval: 3000,
  })

  const completeMut = useMutation({ mutationFn: completeTicket, onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) })
  const stallMut = useMutation({ mutationFn: stallTicket, onSuccess: () => qc.invalidateQueries({ queryKey: ['tickets'] }) })

  const open = tickets.filter(t => t.status !== 'done')
  const done = tickets.filter(t => t.status === 'done')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">IT / Facilities Console</h1>
        <p className="text-sm text-gray-500 mt-1">
          Humans complete the real work here. Agents only coordinate and escalate.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Open Tickets</h2>
          <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${open.length > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
            {open.length}
          </span>
        </div>

        {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : open.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No open tickets. Advance a day and run monitor to generate tickets.</p>
        ) : (
          <div className="space-y-3">
            {open.map(t => (
              <div key={t.ticket_id} className={`p-4 border rounded-lg ${t.status === 'stalled' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">{t.ticket_id}</code>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TEAM_STYLE[t.team] || ''}`}>{t.team}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[t.status] || ''}`}>{t.status}</span>
                    </div>
                    <p className="font-medium text-sm">{t.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Est: {t.estimate_days} day{t.estimate_days !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => completeMut.mutate(t.ticket_id)}
                      disabled={completeMut.isPending}
                      className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 font-medium">
                      ✓ Complete
                    </button>
                    <button onClick={() => stallMut.mutate(t.ticket_id)}
                      disabled={stallMut.isPending}
                      className="bg-orange-500 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-orange-600 font-medium">
                      ⚠ Stall
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-3">Completed ({done.length})</h2>
          <div className="space-y-1.5">
            {done.map(t => (
              <div key={t.ticket_id} className="flex items-center gap-3 text-sm text-gray-500 py-1">
                <span className="text-green-500">✓</span>
                <code className="text-xs font-mono">{t.ticket_id}</code>
                <span className={`text-xs px-1.5 py-0.5 rounded ${TEAM_STYLE[t.team] || ''}`}>{t.team}</span>
                <span className="truncate">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
