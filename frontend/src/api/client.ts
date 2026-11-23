import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || '/api'
const api = axios.create({ baseURL: BASE, withCredentials: true })
let accessToken: string | null = null
let refreshFlight: Promise<string> | null = null

function csrfToken() {
  return document.cookie.split('; ').find(item => item.startsWith('csrf_token='))?.split('=').slice(1).join('=') ?? ''
}

export function setAccessToken(token: string | null) { accessToken = token }
export function clearAccessToken() { accessToken = null }

api.interceptors.request.use(config => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

api.interceptors.response.use(response => response, async error => {
  const config = error.config
  if (error.response?.status === 401 && config && !config._retried && !String(config.url).includes('/auth/')) {
    config._retried = true
    try {
      const token = await refreshAccessToken()
      config.headers.Authorization = `Bearer ${token}`
      return api(config)
    } catch {
      clearAccessToken()
    }
  }
  return Promise.reject(error)
})

export interface AuthUser { id: number; email: string; name: string; role: string; team?: string | null; must_change_password: boolean }
export async function login(email: string, password: string) {
  const response = await api.post('/auth/login', { email, password })
  accessToken = response.data.access_token
  return response.data.user as AuthUser
}
export async function refreshAccessToken() {
  if (!refreshFlight) {
    refreshFlight = api.post('/auth/refresh', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
      .then(response => { accessToken = response.data.access_token; return accessToken })
      .finally(() => { refreshFlight = null })
  }
  return refreshFlight
}
export const getMe = () => api.get('/auth/me').then(response => response.data as AuthUser)
export const requestPasswordReset = (email: string) => api.post('/auth/password/forgot', { email }).then(response => response.data)
export const resetPassword = (token: string, password: string) => api.post('/auth/password/reset', { token, password }).then(response => response.data)
export const acceptInvite = (token: string, password: string) => api.post('/auth/accept-invite', { token, password }).then(response => response.data)
export async function logout() {
  await api.post('/auth/logout', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
  accessToken = null
}

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
