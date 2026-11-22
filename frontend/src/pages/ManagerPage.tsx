import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { getNotifications, getHires, getHireTasks, approveTask, rejectTask, markNotificationRead, type Notification, type Task, type Hire } from '../api/client'

export default function ManagerPage() {
  const qc = useQueryClient()
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ['notifications', 'Manager'],
    queryFn: () => getNotifications('Manager'),
    refetchInterval: 3000,
  })
  const { data: hires = [] } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires })
  const [pendingTasks, setPendingTasks] = useState<(Task & { hire_name: string })[]>([])
  const [loading, setLoading] = useState(false)

  const approveMut = useMutation({ mutationFn: approveTask, onSuccess: () => { qc.invalidateQueries({ queryKey: ['hires'] }); fetchPending() } })
  const rejectMut = useMutation({ mutationFn: rejectTask, onSuccess: () => { qc.invalidateQueries({ queryKey: ['hires'] }); fetchPending() } })

  const fetchPending = async () => {
    setLoading(true)
    const all: (Task & { hire_name: string })[] = []
    for (const h of hires) {
      try {
        const tasks: Task[] = await getHireTasks(h.id)
        tasks.filter(t => t.status === 'awaiting_approval').forEach(t => all.push({ ...t, hire_name: h.name }))
      } catch {}
    }
    setPendingTasks(all)
    setLoading(false)
  }

  useEffect(() => { if (hires.length) fetchPending() }, [hires.length])

  const unread = notifications.filter(n => !n.read)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Manager Inbox</h1>

      {/* Pending approvals */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-yellow-300 dark:border-yellow-700 p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          ⏳ Pending Approvals
          {pendingTasks.length > 0 && <span className="bg-yellow-500 text-white text-xs px-2 py-0.5 rounded-full">{pendingTasks.length}</span>}
        </h2>
        {loading ? <p className="text-sm text-gray-400">Loading…</p> : pendingTasks.length === 0 ? (
          <p className="text-sm text-gray-400">No pending approvals. Run Monitor Tick to check for new tasks.</p>
        ) : (
          <div className="space-y-3">
            {pendingTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <div>
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t.hire_name} · Team: {t.team} · {t.duration_days}d</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approveMut.mutate(t.id)}
                    className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700 font-medium">
                    ✓ Approve
                  </button>
                  <button onClick={() => rejectMut.mutate(t.id)}
                    className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-red-700 font-medium">
                    ✗ Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Notifications
            {unread.length > 0 && <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{unread.length} new</span>}
          </h2>
          {unread.length > 0 && (
            <button onClick={() => unread.forEach(n => markNotificationRead(n.id))}
              className="text-xs text-blue-600 hover:underline">Mark all read</button>
          )}
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {notifications.map(n => (
            <div key={n.id}
              onClick={() => !n.read && markNotificationRead(n.id).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}
              className={`p-3 rounded-lg text-sm cursor-pointer transition-colors ${
                n.read ? 'opacity-50' : 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
              } ${n.message.includes('ESCALATION') ? 'border border-red-200 dark:border-red-800' : ''}`}>
              <p className={n.message.includes('ESCALATION') ? 'text-red-700 dark:text-red-400 font-medium' : ''}>{n.message}</p>
              <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
            </div>
          ))}
          {notifications.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No notifications yet.</p>}
        </div>
      </div>
    </div>
  )
}
