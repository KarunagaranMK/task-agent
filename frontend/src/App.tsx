import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowUpRight, Bell, Check, ChevronDown, Command, Compass, LogOut,
  Gauge, HelpCircle, LayoutDashboard, Menu, Moon, PanelLeftClose, Search,
  ShieldCheck, Sparkles, Sun, Workflow, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { clearAccessToken, getHires, getMe, getNotifications, logout, markAllNotificationsRead, markNotificationRead, refreshAccessToken, type AuthUser, type Hire, type Notification } from './api/client'
import LoginPage from './pages/LoginPage'
import { useLiveEvents } from './hooks/useLiveEvents'

const HRPage = lazy(() => import('./pages/HRPage'))
const HireDetail = lazy(() => import('./pages/HireDetail'))
const ManagerPage = lazy(() => import('./pages/ManagerPage'))
const ITPage = lazy(() => import('./pages/ITPage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
const DemoPanel = lazy(() => import('./components/DemoPanel'))
const AccountRecovery = lazy(() => import('./pages/AccountRecovery'))
const MyOnboardingPage = lazy(() => import('./pages/MyOnboardingPage'))
const ManagerDashboard = lazy(() => import('./pages/ManagerDashboard'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

export const RoleContext = createContext<{ role: string; setRole: (r: string) => void }>({ role: 'HR', setRole: () => {} })
export const useRole = () => useContext(RoleContext)
const AuthContext = createContext<{ user: AuthUser; signOut: () => void }>({ user: { id: 0, email: '', name: '', role: 'HR', must_change_password: false }, signOut: () => {} })
const useAuth = () => useContext(AuthContext)

const navigation: Array<{ label: string; to: string; icon: LucideIcon; group: string; roles: string[]; badge?: string }> = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, group: 'Workspace', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { label: 'Approvals', to: '/manager', icon: ShieldCheck, group: 'Workspace', roles: ['ADMIN', 'MANAGER'] },
  { label: 'Team queue', to: '/it', icon: Workflow, group: 'Operations', roles: ['ADMIN', 'IT_STAFF'] },
  { label: 'Insights', to: '/insights', icon: Activity, group: 'Operations', roles: ['ADMIN', 'HR'] },
  { label: 'My onboarding', to: '/my-onboarding', icon: Workflow, group: 'Workspace', roles: ['NEW_HIRE'] },
  { label: 'Profile & preferences', to: '/profile', icon: Gauge, group: 'Workspace', roles: ['ADMIN', 'HR', 'MANAGER', 'IT_STAFF', 'NEW_HIRE'] },
  { label: 'Templates', to: '/templates', icon: Workflow, group: 'Administration', roles: ['ADMIN', 'HR'] },
  { label: 'People', to: '/users', icon: ShieldCheck, group: 'Administration', roles: ['ADMIN'] },
  { label: 'Audit trail', to: '/audit', icon: Activity, group: 'Administration', roles: ['ADMIN', 'HR'] },
  { label: 'Settings', to: '/settings', icon: Gauge, group: 'Administration', roles: ['ADMIN'] },
]
const routes: Array<{ label: string; to: string; description: string; roles: string[] }> = [
  { label: 'Overview dashboard', to: '/', description: 'Hire portfolio and readiness', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { label: 'Manager approvals', to: '/manager', description: 'Review access requests and escalations', roles: ['ADMIN', 'MANAGER'] },
  { label: 'Team ticket queue', to: '/it', description: 'Work across IT and Facilities tasks', roles: ['ADMIN', 'IT_STAFF'] },
  { label: 'Insights and experiment', to: '/insights', description: 'Readiness metrics and policy comparison', roles: ['ADMIN', 'HR'] },
  { label: 'My onboarding', to: '/my-onboarding', description: 'Your personal first-day plan', roles: ['NEW_HIRE'] },
  { label: 'Profile and preferences', to: '/profile', description: 'Update your account and notification settings', roles: ['ADMIN', 'HR', 'MANAGER', 'IT_STAFF', 'NEW_HIRE'] },
  { label: 'Role templates', to: '/templates', description: 'Edit and publish task plans', roles: ['ADMIN', 'HR'] },
  { label: 'People and access', to: '/users', description: 'Invite users and manage roles', roles: ['ADMIN'] },
  { label: 'Audit trail', to: '/audit', description: 'Review activity and access events', roles: ['ADMIN', 'HR'] },
  { label: 'Workspace settings', to: '/settings', description: 'Configure monitor guardrails', roles: ['ADMIN'] },
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
  const [demoOpen, setDemoOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const canViewHires = ['ADMIN', 'HR', 'MANAGER'].includes(role)
  const { data: hires = [] } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires, staleTime: 30_000, enabled: canViewHires })
  const { data: notifications = [] } = useQuery<Notification[]>({ queryKey: ['notifications', role], queryFn: () => getNotifications(), refetchInterval: connectionState === 'live' ? false : 15_000 })
  const unreadNotifications = notifications.filter(item => !item.read)
  const markAllRead = async () => { await markAllNotificationsRead(); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) }
  const openNotification = async (item: Notification) => {
    if (!item.read) { await markNotificationRead(item.id); void queryClient.invalidateQueries({ queryKey: ['notifications'] }) }
    setNotificationsOpen(false)
    if (item.hire_id && canViewHires) navigate(`/hire/${item.hire_id}`)
    else if (role === 'MANAGER') navigate('/manager')
    else if (role === 'IT_STAFF') navigate('/it')
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
        setPaletteOpen(false); setMobileOpen(false); setDemoOpen(false)
      } else if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        event.preventDefault(); setPaletteOpen(true); setQuery('')
      } else if (!['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) {
        const now = Date.now()
        if (shortcutPrefixAt.current && now - shortcutPrefixAt.current < 1000) {
          shortcutPrefixAt.current = 0
          const destination = ({ h: '/', a: '/manager', t: '/it' } as Record<string, string>)[event.key.toLowerCase()]
          if (destination && visibleRoutes.some(item => item.to === destination)) navigate(destination)
        } else if (event.key.toLowerCase() === 'g') shortcutPrefixAt.current = now
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visibleRoutes = routes.filter(item => item.roles.includes(role))
  const current = location.pathname.startsWith('/hire/') ? 'Hire overview' : (visibleRoutes.find(item => item.to === location.pathname)?.label ?? 'OnboardIQ')
  const hireResults = useMemo(() => hires.filter(h => `${h.name} ${h.role} ${h.department}`.toLowerCase().includes(query.toLowerCase())), [hires, query])

  const go = (path: string) => { navigate(path); setPaletteOpen(false); setMobileOpen(false); setQuery('') }
  const sidebarClass = `app-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`

  return (
    <div className={`app-frame ${resolvedTheme === 'dark' ? 'dark' : ''}`}>
      <aside className={sidebarClass} aria-label="Main navigation">
        <div className="brand-lockup">
          <div className="brand-mark"><Workflow size={19} strokeWidth={1.8} /></div>
          {!collapsed && <div className="brand-copy"><strong>onboard<span>iq</span></strong><small>WORKFORCE ORCHESTRATION</small></div>}
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
        {!collapsed && <div className="readiness-mini">
          <div className="mini-top"><span>Workspace health</span><span className="live-dot" />Live</div>
          <div className="mini-bar"><span style={{ width: '72%' }} /></div>
          <small>Most new hires are on track</small>
        </div>}
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
            {['ADMIN', 'HR'].includes(role) && <Route path="/" element={<HRPage />} />}
            {['ADMIN', 'HR', 'MANAGER'].includes(role) && <Route path="/hire/:id" element={<HireDetail />} />}
            {['ADMIN', 'MANAGER'].includes(role) && <Route path="/manager" element={<ManagerPage />} />}
            {['ADMIN', 'IT_STAFF'].includes(role) && <Route path="/it" element={<ITPage />} />}
            {['ADMIN', 'HR'].includes(role) && <Route path="/insights" element={<InsightsPage />} />}
            {role === 'NEW_HIRE' && <Route path="/my-onboarding" element={<MyOnboardingPage />} />}
            <Route path="/profile" element={<ProfilePage />} />
            {['ADMIN', 'HR'].includes(role) && <Route path="/templates" element={<AdminPage />} />}
            {role === 'ADMIN' && <Route path="/users" element={<AdminPage />} />}
            {['ADMIN', 'HR'].includes(role) && <Route path="/audit" element={<AdminPage />} />}
            {role === 'ADMIN' && <Route path="/settings" element={<AdminPage />} />}
            {role === 'ADMIN' && <Route path="/app/dev/mail" element={<AdminPage />} />}
            {role === 'MANAGER' && <Route path="/" element={<ManagerDashboard />} />}
            <Route path="*" element={<div className="empty-state"><Compass size={30} /><h1>That page is not here yet</h1><p>Choose a workspace page from the navigation.</p><button className="button-primary" onClick={() => go(role === 'IT_STAFF' ? '/it' : role === 'NEW_HIRE' ? '/my-onboarding' : '/')}>Back to overview</button></div>} />
          </Routes></Suspense>
        </main>
        <footer className="app-footer"><span>OnboardIQ <span className="footer-separator">·</span> Workforce onboarding, in sync.</span><span><Sparkles size={13} /> AI off <span className="footer-muted">(templates)</span></span></footer>
      </div>

      {['ADMIN', 'HR'].includes(role) && <button className={`demo-fab ${demoOpen ? 'selected' : ''}`} onClick={() => setDemoOpen(value => !value)} aria-label={demoOpen ? 'Close demo controls' : 'Open demo controls'}>
        {demoOpen ? <X size={17} /> : <Gauge size={17} />}<span>Demo controls</span>
      </button>}
      {demoOpen && ['ADMIN', 'HR'].includes(role) && <div className="demo-drawer"><div className="demo-drawer-head"><div><span className="eyebrow">LIVE SIMULATION</span><h3>Demo controls</h3></div><button className="icon-button" onClick={() => setDemoOpen(false)} aria-label="Close demo controls"><X size={17} /></button></div><Suspense fallback={<div className="panel-loading">Loading controls…</div>}><DemoPanel /></Suspense></div>}

      {paletteOpen && <div className="palette-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false) }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="palette-search"><Search size={18} /><input autoFocus value={query === '?' ? '' : query} onChange={event => setQuery(event.target.value)} placeholder="Search pages, hires, or actions…" /><kbd>ESC</kbd></div>
          {query === '?' ? <div className="palette-results"><p className="palette-label">KEYBOARD SHORTCUTS</p><div className="shortcut-row"><span>Open search</span><kbd>Ctrl K</kbd></div><div className="shortcut-row"><span>Focus search</span><kbd>/</kbd></div><div className="shortcut-row"><span>Go to overview</span><kbd>G, H</kbd></div><div className="shortcut-row"><span>Go to approvals</span><kbd>G, A</kbd></div><div className="shortcut-row"><span>Go to team queue</span><kbd>G, T</kbd></div><div className="shortcut-row"><span>Close dialog</span><kbd>ESC</kbd></div><div className="shortcut-row"><span>Show shortcuts</span><kbd>?</kbd></div></div> : <div className="palette-results">
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
  if (role === 'MANAGER') return 'Manager'
  if (role === 'IT_STAFF') return team === 'Facilities' ? 'Facilities' : 'IT'
  if (role === 'NEW_HIRE') return 'New hire'
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
    navigate(nextUser.role === 'IT_STAFF' ? '/it' : nextUser.role === 'NEW_HIRE' ? '/my-onboarding' : '/', { replace: true })
  }

  if (checking) return <div className="auth-loading"><span className="brand-mark"><Workflow size={19} /></span><strong>Restoring your session…</strong></div>
  if (!user && ['/forgot-password', '/reset-password', '/accept-invite'].includes(location.pathname)) return <Suspense fallback={<div className="auth-loading">Loading secure page…</div>}><AccountRecovery /></Suspense>
  if (!user) return <LoginPage onAuthenticated={onAuthenticated} />
  if (location.pathname === '/login') return <Navigate to="/" replace />
  if (location.pathname === '/' && user.role === 'IT_STAFF') return <Navigate to="/it" replace />
  if (location.pathname === '/' && user.role === 'NEW_HIRE') return <Navigate to="/my-onboarding" replace />
  const role = user.role
  return <AuthContext.Provider value={{ user, signOut }}><RoleContext.Provider value={{ role, setRole: () => {} }}><AppFrame /></RoleContext.Provider></AuthContext.Provider>
}

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AuthCoordinator /></BrowserRouter></QueryClientProvider>
}
