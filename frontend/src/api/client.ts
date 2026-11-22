import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const api = axios.create({ baseURL: BASE })

export const getHires = () => api.get('/hires').then(r => r.data)
export const createHire = (data: HireCreate) => api.post('/hires', data).then(r => r.data)
export const getHire = (id: number) => api.get(`/hires/${id}`).then(r => r.data)
export const getHireTasks = (id: number) => api.get(`/hires/${id}/tasks`).then(r => r.data)
export const getHireAudit = (id: number) => api.get(`/hires/${id}/audit`).then(r => r.data)
export const explainRisk = (id: number) => api.get(`/hires/${id}/explain`).then(r => r.data)
export const approveTask = (id: number) => api.post(`/tasks/${id}/approve`).then(r => r.data)
export const rejectTask = (id: number) => api.post(`/tasks/${id}/reject`).then(r => r.data)
export const getTickets = () => api.get('/tickets').then(r => r.data)
export const completeTicket = (id: string) => api.post(`/tickets/${id}/complete`).then(r => r.data)
export const stallTicket = (id: string) => api.post(`/tickets/${id}/stall`).then(r => r.data)
export const advanceDay = () => api.post('/sim/advance').then(r => r.data)
export const monitorTick = () => api.post('/monitor/tick').then(r => r.data)
export const toggleITSM = (offline: boolean) => api.post(`/chaos/itsm?offline=${offline}`).then(r => r.data)
export const runExperiment = (params: ExperimentParams) => api.post('/experiments/run', params).then(r => r.data)
export const getMetrics = () => api.get('/metrics').then(r => r.data)
export const getNotifications = (role?: string) =>
  api.get(`/notifications${role ? `?role=${role}` : ''}`).then(r => r.data)
export const markNotificationRead = (id: number) => api.post(`/notifications/${id}/read`).then(r => r.data)
export const resetAll = () => api.post('/reset').then(r => r.data)

export interface HireCreate { name: string; role: string; department: string; start_day: number }
export interface ExperimentParams { n_hires: number; stall_probability: number; seed: number }
export interface Hire {
  id: number; name: string; role: string; department: string;
  start_day: number; status: string; readiness: number; projected_day: number | null
}
export interface Task {
  id: number; key: string; title: string; team: string; duration_days: number;
  depends_on: string[]; needs_approval: boolean; approval_state: string;
  status: string; ticket_id: string | null; slack: number | null; critical: boolean; flag: string
}
export interface Ticket {
  id: number; ticket_id: string; title: string; team: string;
  status: string; hire_id: number | null; task_id: number | null; estimate_days: number; created_at: string
}
export interface AuditEvent { id: number; day: number; level: string; message: string; actor: string; created_at: string }
export interface Notification { id: number; for_role: string; message: string; hire_id: number | null; task_id: number | null; read: boolean; created_at: string }
