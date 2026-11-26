import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowUpRight, Bell, BookOpen, Check, ChevronDown, Command, Compass, LogOut, PlugZap,
  Gauge, HelpCircle, LayoutDashboard, Menu, Moon, PanelLeftClose, Search,
  Sun, Workflow, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { clearAccessToken, getHires, getMe, getNotifications, logout, markAllNotificationsRead, markNotificationRead, refreshAccessToken, type AuthUser, type Hire, type Notification } from './api/client'
import LoginPage from './pages/LoginPage'
import { useLiveEvents } from './hooks/useLiveEvents'

const HRPage = lazy(() => import('./pages/HRPage'))
const HireDetail = lazy(() => import('./pages/HireDetail'))
const ITPage = lazy(() => import('./pages/ITPage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
const AccountRecovery = lazy(() => import('./pages/AccountRecovery'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const GuidePage = lazy(() => import('./pages/GuidePage'))
const AgentControlPage = lazy(() => import('./pages/AgentControlPage'))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'))
const HRReviewPage = lazy(() => import('./pages/HRReviewPage'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

export const RoleContext = createContext<{ role: string; setRole: (r: string) => void }>({ role: 'HR', setRole: () => {} })
export const useRole = () => useContext(RoleContext)
const AuthContext = createContext<{ user: AuthUser; signOut: () => void }>({ user: { id: '', email: '', name: '', role: 'HR', must_change_password: false }, signOut: () => {} })
const useAuth = () => useContext(AuthContext)

const navigation: Array<{ label: string; to: string; icon: LucideIcon; group: string; roles: string[]; badge?: string }> = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, group: 'Workspace', roles: ['ADMIN', 'HR'] },
  { label: 'HR tasks', to: '/hr-tasks', icon: Workflow, group: 'Workspace', roles: ['HR'] },
  { label: 'HR review', to: '/reviews', icon: Check, group: 'Workspace', roles: ['HR'] },
  { label: 'IT tasks', to: '/it', icon: Workflow, group: 'Operations', roles: ['IT_STAFF'] },
  { label: 'Facilities tasks', to: '/facilities', icon: Workflow, group: 'Operations', roles: ['IT_STAFF'] },
  { label: 'Insights', to: '/insights', icon: Activity, group: 'Operations', roles: ['HR'] },
  { label: 'Automation activity', to: '/agents', icon: Activity, group: 'Operations', roles: ['HR'] },
  { label: 'Integrations', to: '/integrations', icon: PlugZap, group: 'Operations', roles: ['HR'] },
  { label: 'Profile & preferences', to: '/profile', icon: Gauge, group: 'Workspace', roles: ['ADMIN', 'HR', 'IT_STAFF'] },
  { label: 'Project guide', to: '/guide', icon: BookOpen, group: 'Help', roles: ['ADMIN', 'HR', 'IT_STAFF'] },
  { label: 'Templates', to: '/templates', icon: Workflow, group: 'Administration', roles: ['HR'] },
  { label: 'Audit trail', to: '/audit', icon: Activity, group: 'Administration', roles: ['ADMIN', 'HR'] },
]
const routes: Array<{ label: string; to: string; description: string; roles: string[] }> = [
  { label: 'Overview dashboard', to: '/', description: 'Hire portfolio and readiness', roles: ['ADMIN', 'HR'] },
  { label: 'HR tasks', to: '/hr-tasks', description: 'Complete and propose alternatives for HR onboarding work', roles: ['HR'] },
  { label: 'HR work review', to: '/reviews', description: 'Review department completions and alternative requests', roles: ['HR'] },
  { label: 'IT tasks', to: '/it', description: 'Complete IT work and submit alternative requests', roles: ['IT_STAFF'] },
  { label: 'Facilities tasks', to: '/facilities', description: 'Complete Facilities work and submit alternative requests', roles: ['IT_STAFF'] },
  { label: 'Insights and experiment', to: '/insights', description: 'Readiness metrics and policy comparison', roles: ['HR'] },
  { label: 'Automation activity', to: '/agents', description: 'Review automated workflow runs and recent activity', roles: ['HR'] },
  { label: 'Integration health', to: '/integrations', description: 'Check MCP services, model setup, scheduler, and retries', roles: ['HR'] },
  { label: 'Profile and preferences', to: '/profile', description: 'Update your account and notification settings', roles: ['ADMIN', 'HR', 'IT_STAFF'] },
  { label: 'Project guide', to: '/guide', description: 'Understand the workflow, technology, and demo', roles: ['ADMIN', 'HR', 'IT_STAFF'] },
  { label: 'Role templates', to: '/templates', description: 'Edit and publish task plans', roles: ['HR'] },
  { label: 'Audit trail', to: '/audit', description: 'Review activity and access events', roles: ['ADMIN', 'HR'] },
]

function AppFrame() {
  const { role } = useRole()
  const { user, signOut } = useAuth()
  const { connectionState, lastMessage } = useLiveEvents(queryClient, true)
  const [theme, setTheme] = useState(() => localStorage.getItem('onboardiq-theme') || 'system')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const shortcutPrefixAt = useRef(0)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const canViewHires = role === 'HR'
  const { data: hires = [] } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires, staleTime: 30_000, enabled: canViewHires })
  const { data: notifications = [] } = useQuery<Notification[]>({ queryKey: ['notifications', role], queryFn: () => getNotifications(), refetchInterval: connectionState === 'live' ? false : 15_000 })
  const unreadNotifications = notifications.filter(item => !item.read)
  const markAllRead = async () => { await markAllNotificationsRead(); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) }
  const openNotification = async (item: Notification) => {
    if (!item.read) { await markNotificationRead(item.id); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) }
    setNotificationsOpen(false)
    if (item.for_role === 'HR' && role === 'HR') navigate('/reviews')
    else if (item.hire_id && canViewHires) navigate(`/hire/${item.hire_id}`)
    else if (role === 'IT_STAFF') navigate(user.team === 'Facilities' ? '/facilities' : '/it')
  }

  useEffect(() => {
    localStorage.setItem('onboardiq-theme', theme)
  }, [theme])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme }, [resolvedTheme])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPaletteOpen(open => !open)
      } else if (event.key === '?' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        setPaletteOpen(true); setQuery('?')
      } else if (event.key === 'Escape') {
        setPaletteOpen(false); setMobileOpen(false)
      } else if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault(); setPaletteOpen(true); setQuery('')
      } else if (!['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        const now = Date.now()
        if (shortcutPrefixAt.current && now - shortcutPrefixAt.current < 1000) {
          shortcutPrefixAt.current = 0
          const shortcuts: Record<string, string> = { h: '/' }
          if (role === 'HR') { shortcuts.a = '/reviews'; shortcuts.t = '/hr-tasks' }
          else if (role === 'IT_STAFF') shortcuts.t = user.team === 'Facilities' ? '/facilities' : '/it'
          const destination = shortcuts[event.key.toLowerCase()]
          if (destination && visibleRoutes.some(item => item.to === destination)) navigate(destination)
        } else if (event.key.toLowerCase() === 'g') shortcutPrefixAt.current = now
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visibleRoutes = routes.filter(item => item.roles.includes(role))
  const current = location.pathname.startsWith('/hire/') ? 'Hire overview' : (visibleRoutes.find(item => item.to === location.pathname)?.label ?? 'OnboardFlow')
  const hireResults = useMemo(() => hires.filter(h => `${h.name} ${h.role} ${h.department}`.toLowerCase().includes(query.toLowerCase())), [hires, query])

  const go = (path: string) => { navigate(path); setPaletteOpen(false); setMobileOpen(false); setQuery('') }
  const sidebarClass = `app-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`

  return (
    <div className={`app-frame ${resolvedTheme === 'dark' ? 'dark' : ''}`}>
      <aside className={sidebarClass} aria-label="Main navigation">
        <div className="brand-lockup">
          <div className="brand-mark"><Workflow size={19} strokeWidth={1.8} /></div>
          {!collapsed && <div className="brand-copy"><strong>OnboardFlow</strong><small>EMPLOYEE ONBOARDING</small></div>}
          <button className="icon-button sidebar-collapse" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <PanelLeftClose size={17} />
          </button>
        </div>
        <div className="workspace-switcher" aria-label="Northstar Labs demo workspace">
          <span className="workspace-avatar">N</span>{!collapsed && <><span className="workspace-name">Northstar Labs<small>Demo workspace</small></span><ChevronDown size={15} /> </>}
        </div>
        {!collapsed && <div className="sidebar-caption">WORKSPACE</div>}
        <nav className="nav-list">
          {navigation.filter(item => item.roles.includes(role)).map(item => <NavLink key={item.label} to={item.to} end={item.to === '/'} title={collapsed ? item.label : undefined}
            className={({ isActive }) => `nav-item ${isActive && (item.to !== '/' || !location.pathname.startsWith('/hire/')) ? 'active' : ''}`}>
            <item.icon size={18} strokeWidth={1.8} /><span>{item.label}</span>{item.badge && !collapsed && <span className="nav-badge">{item.badge}</span>}
          </NavLink>)}
        </nav>
        <div className="sidebar-spacer" />
        <button className="nav-item sidebar-help" onClick={() => { setPaletteOpen(true); setQuery('?') }} title={collapsed ? 'Help & shortcuts' : undefined}>
          <HelpCircle size={18} strokeWidth={1.8} /><span>Help & shortcuts</span>
        </button>
        <div className="profile-row">
          <div className="profile-avatar">{user.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</div>
          {!collapsed && <><div className="profile-copy"><strong>{user.name}</strong><small>{roleLabel(role, user.team)}</small></div><ChevronDown size={15} /></>}
        </div>
      </aside>

      {mobileOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{current}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className={`connection-status ${connectionState}`} aria-label={`Connection ${connectionState}`}><span className="live-dot" />{connectionState === 'live' ? 'Live' : connectionState === 'connecting' ? 'Connecting' : 'Reconnecting'}</div>
            <button className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search anything K">
              <Search size={16} /><span>Search anything</span><kbd><Command size={11} /> K</kbd>
            </button>
            <div className="notification-anchor"><button className="icon-button topbar-icon" aria-label={`Notifications${unreadNotifications.length ? `, ${unreadNotifications.length} unread` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(value => !value)}><Bell size={18} />{unreadNotifications.length > 0 && <i className="notification-dot" />}</button>
              {notificationsOpen && <section className="notification-popover" aria-label="Notifications"><div className="notification-popover-head"><div><strong>Notifications</strong><small>{unreadNotifications.length ? `${unreadNotifications.length} unread` : 'You’re all caught up'}</small></div>{unreadNotifications.length > 0 && <button onClick={() => void markAllRead()}>Mark all read</button>}</div><div className="notification-popover-list">{notifications.slice(0, 6).map(item => <button key={item.id} className={`notification-row ${item.read ? '' : 'unread'}`} onClick={() => void openNotification(item)}><span className="notification-row-dot" /><span><strong>{item.message}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span></button>)}{notifications.length === 0 && <div className="notification-empty"><Bell size={20} /><span>No updates yet</span><small>Onboarding activity will show here.</small></div>}</div></section>}
            </div>
            <button className="icon-button topbar-icon theme-toggle" onClick={() => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')} aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`}>
              {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={17} />}
            </button>
            <button className="role-select" onClick={signOut} title="Sign out"><span className="role-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span><span className="role-name">Sign out</span><LogOut size={14} aria-hidden="true" /></button>
          </div>
        </header>

        <main className="page-content" key={location.pathname}>
          <Suspense fallback={<div className="page-skeleton" role="status" aria-label="Loading page"><span /></div>}><Routes>
            {role === 'ADMIN' && <Route path="/" element={<AdminDashboard />} />}
            {role === 'HR' && <Route path="/" element={<HRPage />} />}
            {role === 'HR' && <Route path="/hr-tasks" element={<ITPage department="HR" />} />}
            {role === 'HR' && <Route path="/reviews" element={<HRReviewPage />} />}
            {role === 'HR' && <Route path="/hire/:id" element={<HireDetail />} />}
            {role === 'IT_STAFF' && <Route path="/it" element={<ITPage department="IT" />} />}
            {role === 'IT_STAFF' && <Route path="/facilities" element={<ITPage department="Facilities" />} />}
            {role === 'HR' && <Route path="/insights" element={<InsightsPage />} />}
            {['ADMIN', 'HR'].includes(role) && <Route path="/agents" element={<AgentControlPage />} />}
            {role === 'HR' && <Route path="/integrations" element={<IntegrationsPage role={role} />} />}
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/guide" element={<GuidePage embedded />} />
            {role === 'HR' && <Route path="/templates" element={<AdminPage />} />}
            {['ADMIN', 'HR'].includes(role) && <Route path="/audit" element={<AdminPage />} />}
            <Route path="*" element={<div className="empty-state"><Compass size={30} /><h1>That page is not here yet</h1><p>Choose a workspace page from the navigation.</p><button className="button-primary" onClick={() => go(role === 'IT_STAFF' ? (user.team === 'Facilities' ? '/facilities' : '/it') : '/')}>Back to overview</button></div>} />
          </Routes></Suspense>
        </main>
        <footer className="app-footer"><span>OnboardFlow <span className="footer-separator">·</span> Employee onboarding across HR, IT, and Facilities.</span><span>Workflow status updates automatically</span></footer>
      </div>

      {paletteOpen && <div className="palette-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false) }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="palette-search"><Search size={18} /><input autoFocus value={query === '?' ? '' : query} onChange={event => setQuery(event.target.value)} placeholder="Search pages, hires, or actions…" /><kbd>ESC</kbd></div>
          {query === '?' ? <div className="palette-results"><p className="palette-label">KEYBOARD SHORTCUTS</p><div className="shortcut-row"><span>Open search</span><kbd>Ctrl K</kbd></div><div className="shortcut-row"><span>Focus search</span><kbd>/</kbd></div><div className="shortcut-row"><span>Go to overview</span><kbd>G, H</kbd></div><div className="shortcut-row"><span>Go to approvals</span><kbd>G, A</kbd></div><div className="shortcut-row"><span>Go to your department tasks</span><kbd>G, T</kbd></div><div className="shortcut-row"><span>Close dialog</span><kbd>ESC</kbd></div><div className="shortcut-row"><span>Show shortcuts</span><kbd>?</kbd></div></div> : <div className="palette-results">
            <p className="palette-label">PAGES</p>
            {visibleRoutes.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.label} className="palette-option" onClick={() => go(item.to)}><span className="palette-option-icon"><ArrowUpRight size={16} /></span><span>{item.label}<small>{item.description}</small></span><kbd>↵</kbd></button>)}
            {query && hireResults.length > 0 && <><p className="palette-label">HIRES</p>{hireResults.slice(0, 5).map(hire => <button key={hire.id} className="palette-option" onClick={() => go(`/hire/${hire.id}`)}><span className="hire-avatar">{hire.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><span>{hire.name}<small>{hire.role} · {hire.department}</small></span><ArrowUpRight size={15} /></button>)}</>}
            {query && visibleRoutes.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())).length === 0 && hireResults.length === 0 && <div className="palette-empty">No pages or hires match “{query}”.</div>}
          </div>}
          <div className="palette-foot"><span><Command size={12} /> Navigate</span><span><Check size={12} /> Select</span><span><X size={12} /> Close</span></div>
        </section>
      </div>}
      <div className="sr-only" aria-live="polite">{current} page. {lastMessage}</div>
    </div>
  )
}

function roleLabel(role: string, team?: string | null) {
  if (role === 'ADMIN') return 'Admin'
  if (role === 'IT_STAFF') return team === 'Facilities' ? 'Facilities' : 'IT'
  return role
}

function AuthCoordinator() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [checking, setChecking] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    refreshAccessToken().then(() => getMe()).then(setUser).catch(() => clearAccessToken()).finally(() => setChecking(false))
  }, [])

  const signOut = async () => {
    try { await logout() } catch { clearAccessToken() }
    setUser(null)
    navigate('/login', { replace: true })
  }
  const onAuthenticated = (nextUser: AuthUser) => {
    setUser(nextUser)
    navigate(nextUser.role === 'IT_STAFF' ? (nextUser.team === 'Facilities' ? '/facilities' : '/it') : '/', { replace: true })
  }

  if (checking) return <div className="auth-loading"><span className="brand-mark"><Workflow size={19} /></span><strong>Restoring your session…</strong></div>
  if (!user && location.pathname === '/guide') return <Suspense fallback={<div className="auth-loading">Loading project guide…</div>}><GuidePage /></Suspense>
  if (!user && ['/forgot-password', '/reset-password', '/accept-invite'].includes(location.pathname)) return <Suspense fallback={<div className="auth-loading">Loading secure page…</div>}><AccountRecovery /></Suspense>
  if (!user) return <LoginPage onAuthenticated={onAuthenticated} />
  if (location.pathname === '/login') return <Navigate to="/" replace />
  if (location.pathname === '/' && user.role === 'IT_STAFF') return <Navigate to={user.team === 'Facilities' ? '/facilities' : '/it'} replace />
  const role = user.role
  return <AuthContext.Provider value={{ user, signOut }}><RoleContext.Provider value={{ role, setRole: () => {} }}><AppFrame /></RoleContext.Provider></AuthContext.Provider>
}

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AuthCoordinator /></BrowserRouter></QueryClientProvider>
}
