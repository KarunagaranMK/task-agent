import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bell, Check, CheckCheck, Clock3, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { approveTask, getHires, getHireTasks, getNotifications, markAllNotificationsRead, markNotificationRead, rejectTask, undoApproval, type Hire, type Notification, type Task } from '../api/client'

type ApprovalTask = Task & { hire_name: string }
type UndoInfo = { taskId: string; taskTitle: string; expires: number }

export default function ManagerPage() {
  const client = useQueryClient()
  const { data: notifications = [] } = useQuery<Notification[]>({ queryKey: ['notifications', 'MANAGER'], queryFn: () => getNotifications(), refetchInterval: 15_000 })
  const { data: hires = [], isLoading: hiresLoading } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires })
  const [pendingTasks, setPendingTasks] = useState<ApprovalTask[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [undoInfo, setUndoInfo] = useState<UndoInfo | null>(null)
  const [actionError, setActionError] = useState('')

  const refreshTasks = useCallback(async () => {
    if (hiresLoading) return
    setLoadingTasks(true); setLoadError(false)
    try {
      const taskLists = await Promise.all(hires.map(async hire => ({
        hire,
        tasks: await getHireTasks(hire.id),
      })))
      setPendingTasks(taskLists.flatMap(({ hire, tasks }) => tasks
        .filter(task => task.status === 'awaiting_approval')
        .map(task => ({ ...task, hire_name: hire.name }))))
    } catch { setLoadError(true) }
    finally { setLoadingTasks(false) }
  }, [hires, hiresLoading])

  useEffect(() => { void refreshTasks() }, [refreshTasks])
  useEffect(() => {
    if (!undoInfo) return
    const timer = window.setTimeout(() => setUndoInfo(null), Math.max(0, undoInfo.expires - Date.now()))
    return () => window.clearTimeout(timer)
  }, [undoInfo])

  const actionMutation = useMutation({
    mutationFn: ({ taskId, action }: { taskId: string; action: 'approve' | 'reject' }) => action === 'approve' ? approveTask(taskId) : rejectTask(taskId),
    onSuccess: (_result, variables) => {
      const task = pendingTasks.find(item => item.id === variables.taskId)
      setUndoInfo({ taskId: variables.taskId, taskTitle: task?.title ?? 'Approval', expires: Date.now() + 5000 })
      setActionError(''); void client.invalidateQueries({ queryKey: ['hires'] }); void refreshTasks()
    },
    onError: () => setActionError('That approval could not be updated. Refresh the inbox and try again.'),
  })
  const undoMutation = useMutation({
    mutationFn: undoApproval,
    onSuccess: () => { setUndoInfo(null); setActionError(''); void client.invalidateQueries({ queryKey: ['hires'] }); void refreshTasks() },
    onError: () => setActionError('The approval could not be undone. It may have moved forward already.'),
  })
  const readAllMutation = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }) })
  const unread = notifications.filter(item => !item.read)
  const approvedCount = notifications.filter(item => item.message.toLowerCase().includes('approval')).length

  return <div className="portal-page">
    <div className="page-heading-row"><div><span className="eyebrow">MANAGER WORKSPACE</span><h1>Approvals inbox</h1><p>Review the access requests that help your team be ready on Day 1.</p></div><span className="manager-inbox-count"><ShieldCheck size={17} />{pendingTasks.length} waiting</span></div>
    {actionError && <div className="action-error" role="alert"><AlertCircle size={16} />{actionError}<button aria-label="Dismiss" onClick={() => setActionError('')}><X size={14} /></button></div>}
    <section className="content-card manager-approval-card">
      <div className="section-heading"><div><h2>Needs your review</h2><p>Approval holds are keeping these tasks from moving forward.</p></div><span className="subtle-count">{pendingTasks.length} requests</span></div>
      {loadingTasks ? <div className="table-skeleton" aria-label="Loading approvals"><span /><span /></div> : loadError ? <div className="empty-state compact"><AlertCircle size={22} /><h3>Approvals could not be loaded</h3><p>Check your connection and try again.</p><button className="button-secondary" onClick={() => void refreshTasks()}>Retry</button></div> : pendingTasks.length === 0 ? <div className="empty-state compact"><CheckCheck size={24} /><h3>You’re all caught up</h3><p>New access requests for your hires will appear here.</p></div> : <div className="approval-list">{pendingTasks.map(task => <article className="approval-item" key={task.id}>
        <div className="approval-item-icon"><ShieldCheck size={18} /></div><div className="approval-item-main"><div className="approval-title-row"><strong>{task.title}</strong><span className="approval-badge">Approval required</span></div><p>{task.hire_name} <span>·</span> {task.team} <span>·</span> {task.duration_days} day{task.duration_days === 1 ? '' : 's'}</p><small>Required for this hire’s role-specific onboarding plan.</small></div>
        <div className="approval-actions"><button className="button-secondary reject-action" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ taskId: task.id, action: 'reject' })}><X size={15} />Reject</button><button className="button-primary" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ taskId: task.id, action: 'approve' })}><Check size={15} />Approve</button></div>
      </article>)}</div>}
    </section>

    {undoInfo && <div className="undo-toast" role="status"><span><Check size={15} />{undoInfo.taskTitle} updated</span><button disabled={undoMutation.isPending} onClick={() => undoMutation.mutate(undoInfo.taskId)}><RotateCcw size={14} />Undo</button><i aria-hidden="true" style={{ animationDuration: '5s' }} /></div>}

    <section className="content-card manager-notifications">
      <div className="section-heading"><div><h2><Bell size={17} /> Recent updates</h2><p>Escalations and onboarding changes for your team.</p></div>{unread.length > 0 && <button className="text-action" disabled={readAllMutation.isPending} onClick={() => readAllMutation.mutate()}>{readAllMutation.isPending ? 'Marking…' : 'Mark all read'}</button>}</div>
      {notifications.length ? <div className="manager-notification-list">{notifications.slice(0, 10).map(item => <button key={item.id} className={`manager-notification ${item.read ? 'read' : ''}`} onClick={() => { if (!item.read) { void markNotificationRead(item.id).then(() => client.invalidateQueries({ queryKey: ['notifications'] })) } }}><span className="notification-row-dot" /><span className="manager-notification-copy"><strong>{item.message}</strong><small><Clock3 size={12} />{new Date(item.created_at).toLocaleString()}</small></span><span className="sr-only">{item.read ? 'Read' : 'Unread'}</span></button>)}</div> : <div className="manager-no-updates"><Bell size={19} /><span>No team updates yet</span></div>}
    </section>
    <span className="sr-only">{approvedCount ? `${approvedCount} approval-related updates` : ''}</span>
  </div>
}
