import axios from 'axios'
import type { components } from './generated'

const BASE = import.meta.env.VITE_API_URL || '/api/v1'
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

export type AuthUser = components['schemas']['UserOut']
export type HireCreate = components['schemas']['HireCreate']
export type HireUpdate = components['schemas']['HireUpdate']
export type Hire = components['schemas']['HireOut']
export type Task = components['schemas']['TaskOut']
export async function login(email: string, password: string) {
  const response = await api.post<components['schemas']['LoginOut']>('/auth/login', { email, password })
  accessToken = response.data.access_token
  return response.data.user as AuthUser
}
export async function refreshAccessToken(): Promise<string> {
  if (!refreshFlight) {
    refreshFlight = api.post('/auth/refresh', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
      .then((response: { data: { access_token: string } }) => {
        const token = response.data.access_token as string
        accessToken = token
        return token
      })
      .finally(() => { refreshFlight = null })
  }
  return refreshFlight
}
export const getMe = () => api.get('/auth/me').then(response => response.data as AuthUser)
export const updateProfile = (name: string) => api.put<AuthUser>('/auth/profile', { name }).then(response => response.data)
export const getPreferences = () => api.get<{ in_app: boolean; email: boolean }>('/auth/preferences').then(response => response.data)
export const savePreferences = (data: { in_app: boolean; email: boolean }) => api.put('/auth/preferences', data).then(response => response.data)
export const changePassword = (current_password: string, new_password: string) => api.post('/auth/password/change', { current_password, new_password }).then(response => response.data)
export const createStreamTicket = () => api.post('/events/ticket').then(response => response.data as { ticket: string; expires_in: number })
export function eventStreamUrl(ticket: string) { return `${BASE}/events/stream?ticket=${encodeURIComponent(ticket)}` }
export const requestPasswordReset = (email: string) => api.post('/auth/password/forgot', { email }).then(response => response.data)
export const resetPassword = (token: string, password: string) => api.post('/auth/password/reset', { token, password }).then(response => response.data)
export const acceptInvite = (token: string, password: string) => api.post('/auth/accept-invite', { token, password }).then(response => response.data)
export async function logout() {
  await api.post('/auth/logout', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
  accessToken = null
}

export interface HirePageResult { items: Hire[]; total: number; page: number; page_size: number; total_pages: number }
export const getHires = () => api.get<Hire[]>('/hires').then(r => r.data)
export const getHirePage = (params: { page: number; page_size: number; search?: string; status?: string; sort_by: string; sort_order: 'asc' | 'desc' }): Promise<HirePageResult> =>
  api.get<Hire[]>('/hires', { params }).then(r => ({
    items: r.data,
    total: Number(r.headers['x-total-count'] ?? r.data.length),
    page: Number(r.headers['x-page'] ?? params.page),
    page_size: Number(r.headers['x-page-size'] ?? params.page_size),
    total_pages: Number(r.headers['x-total-pages'] ?? 1),
  }))
export const createHire = (data: HireCreate) => api.post<Hire>('/hires', data).then(r => r.data)
export const planPreview = (role: string) => api.post('/hires/plan-preview', { role }).then(r => r.data)
export const getHire = (id: string) => api.get<Hire>(`/hires/${id}`).then(r => r.data)
export const updateHireDetails = (id: string, data: HireUpdate) => api.patch<Hire>(`/hires/${id}`, data).then(r => r.data)
export const getHireTasks = (id: string) => api.get<Task[]>(`/hires/${id}/tasks`).then(r => r.data)
export const getHireAudit = (id: string) => api.get(`/hires/${id}/audit`).then(r => r.data)
export const pauseHire = (id: string) => api.post(`/hires/${id}/pause`).then(r => r.data)
export const resumeHire = (id: string) => api.post(`/hires/${id}/resume`).then(r => r.data)
export const cancelHire = (id: string) => api.post(`/hires/${id}/cancel`).then(r => r.data)
export const explainRisk = (id: string) => api.get(`/hires/${id}/explain`).then(r => r.data)
export const approveTask = (id: string) => api.post(`/tasks/${id}/approve`).then(r => r.data)
export const rejectTask = (id: string) => api.post(`/tasks/${id}/reject`).then(r => r.data)
export const undoApproval = (id: string) => api.post(`/tasks/${id}/undo-approval`).then(r => r.data)
export const getTickets = () => api.get('/tickets').then(r => r.data)
export const startTicket = (id: string) => api.post(`/tickets/${id}/start`).then(r => r.data)
export const completeTicket = (id: string) => api.post(`/tickets/${id}/complete`).then(r => r.data)
export const blockTicket = (id: string) => api.post(`/tickets/${id}/block`).then(r => r.data)
export const stallTicket = (id: string) => api.post(`/tickets/${id}/stall`).then(r => r.data)
export const getTicketComments = (id: string) => api.get(`/tickets/${id}/comments`).then(r => r.data as TicketComment[])
export const addTicketComment = (id: string, body: string) => api.post(`/tickets/${id}/comments`, { body }).then(r => r.data as TicketComment)
export const advanceDay = () => api.post('/sim/advance').then(r => r.data)
export const monitorTick = () => api.post('/monitor/tick').then(r => r.data)
export const toggleITSM = (offline: boolean) => api.post(`/chaos/itsm?offline=${offline}`).then(r => r.data)
export const runExperiment = (params: ExperimentParams) => api.post('/experiments/run', params).then(r => r.data)
export const getMetrics = () => api.get('/metrics').then(r => r.data)
export const getNotifications = (role?: string) =>
  api.get(`/notifications${role ? `?role=${role}` : ''}`).then(r => r.data)
export const markNotificationRead = (id: string) => api.post(`/notifications/${id}/read`).then(r => r.data)
export const markAllNotificationsRead = () => api.post('/notifications/read-all').then(r => r.data)
export const resetAll = () => api.post('/reset').then(r => r.data)
export const getManagers = () => api.get<AuthUser[]>('/users/managers').then(r => r.data)
export const getMyOnboarding = () => api.get<MyOnboarding>('/me/onboarding').then(r => r.data)
export const reportOnboardingIssue = (message: string) => api.post('/me/issues', { message }).then(r => r.data)
export const runWhatIf = (hireId: string, task_key: string, delay_days: number) => api.post(`/hires/${hireId}/what-if`, { task_key, delay_days }).then(r => r.data as WhatIfResult)
export const listUsers = () => api.get<AuthUser[]>('/users').then(r => r.data)
export const inviteUser = (data: { email: string; name: string; role: string; team?: string }) => api.post<AuthUser>('/users/invite', data).then(r => r.data)
export const updateUser = (id: string, data: Partial<Pick<AuthUser, 'role' | 'team' | 'is_active'>>) => api.patch<AuthUser>(`/users/${id}`, data).then(r => r.data)
export const getTemplates = () => api.get<OnboardingTemplate[]>('/templates').then(r => r.data)
export const publishTemplate = (data: { role_key: string; tasks: TemplateTask[] }) => api.post<OnboardingTemplate>('/templates', data).then(r => r.data)
export const getSettings = () => api.get<Record<string, string>>('/settings').then(r => r.data)
export const saveSettings = (data: { stall_after_days: number; near_critical_margin: number; monitor_interval_minutes: number; auto_worker_enabled: boolean; timezone: string; holidays: string[] }) => api.put('/settings', data).then(r => r.data)
export const getAudit = (search = '') => api.get<AuditRecord[]>('/audit', { params: { search } }).then(r => r.data)
export const getExperimentHistory = () => api.get<ExperimentRecord[]>('/experiments').then(r => r.data)
export const getDevMail = () => api.get<MailRecord[]>('/dev/mail').then(r => r.data)
export const setDemoClock = (day: number) => api.post(`/admin/clock?day=${day}`).then(r => r.data)

export interface ExperimentParams { n_hires: number; stall_probability: number; seed: number }
export interface Ticket {
  id: string; ticket_id: string; title: string; team: string;
  status: string; hire_id: string | null; task_id: string | null; estimate_days: number; created_at: string
}
export interface AuditEvent { id: string; day: number; level: string; message: string; actor: string; created_at: string }
export interface Notification { id: string; for_role: string; message: string; hire_id: string | null; task_id: string | null; read: boolean; created_at: string }
export interface TicketComment { id: string; author: string; body: string; created_at: string }
export interface MyOnboarding {
  hire: { name: string; role: string; department: string; start_day: number; start_date: string | null; status: string; readiness: number; projected_day: number | null; projected_ready_date: string | null } | null
  tasks: Array<{ title: string; status: string; eta_day: number | null }>
}
export interface TemplateTask { key: string; title: string; team: string; duration_days: number; depends_on: string[]; needs_approval: boolean; fallback_title?: string | null; fallback_days?: number | null }
export interface OnboardingTemplate { id: string | null; role_key: string; version: number; tasks: TemplateTask[]; active: boolean; created_at: string | null }
export interface AuditRecord { id: string; kind: string; actor: string; target: string; detail: string; created_at: string; source: string }
export interface ExperimentRecord { id: string; parameters: ExperimentParams; result: { static_checklist_readiness_pct: number; orchestrator_readiness_pct: number; improvement_pct: number }; created_at: string }
export interface MailRecord { id: string; recipient: string; subject: string; body: string; created_at: string }
export interface WhatIfResult { baseline_ready_day: number; projected_ready_day: number; delta_days: number; critical_path: string[]; tasks: Array<{ key: string; es: number; ef: number; slack: number; critical: boolean }> }
