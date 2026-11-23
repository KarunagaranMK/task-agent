import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowUpRight, Bell, Check, ChevronDown, Command, Compass, LogOut,
  Gauge, HelpCircle, LayoutDashboard, Menu, Moon, PanelLeftClose, Search,
  ShieldCheck, Sparkles, Sun, Workflow, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import HRPage from './pages/HRPage'
import HireDetail from './pages/HireDetail'
import ManagerPage from './pages/ManagerPage'
import ITPage from './pages/ITPage'
import InsightsPage from './pages/InsightsPage'
import DemoPanel from './components/DemoPanel'
import { clearAccessToken, getHires, getMe, logout, refreshAccessToken, type AuthUser, type Hire } from './api/client'
import LoginPage from './pages/LoginPage'
import AccountRecovery from './pages/AccountRecovery'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

export const RoleContext = createContext<{ role: string; setRole: (r: string) => void }>({ role: 'HR', setRole: () => {} })
export const useRole = () => useContext(RoleContext)
const AuthContext = createContext<{ user: AuthUser; signOut: () => void }>({ user: { id: 0, email: '', name: '', role: 'HR', must_change_password: false }, signOut: () => {} })
const useAuth = () => useContext(AuthContext)

const navigation: Array<{ label: string; to: string; icon: LucideIcon; group: string; roles: string[]; badge?: string }> = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, group: 'Workspace', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { label: 'Approvals', to: '/manager', icon: ShieldCheck, group: 'Workspace', roles: ['ADMIN', 'MANAGER'], badge: '2' },
  { label: 'Team queue', to: '/it', icon: Workflow, group: 'Operations', roles: ['ADMIN', 'IT_STAFF'] },
  { label: 'Insights', to: '/insights', icon: Activity, group: 'Operations', roles: ['ADMIN', 'HR'] },
  { label: 'My onboarding', to: '/my-onboarding', icon: Workflow, group: 'Workspace', roles: ['NEW_HIRE'] },
]
const routes: Array<{ label: string; to: string; description: string; roles: string[] }> = [
  { label: 'Overview dashboard', to: '/', description: 'Hire portfolio and readiness', roles: ['ADMIN', 'HR', 'MANAGER'] },
  { label: 'Manager approvals', to: '/manager', description: 'Review access requests and escalations', roles: ['ADMIN', 'MANAGER'] },
  { label: 'Team ticket queue', to: '/it', description: 'Work across IT and Facilities tasks', roles: ['ADMIN', 'IT_STAFF'] },
  { label: 'Insights and experiment', to: '/insights', description: 'Readiness metrics and policy comparison', roles: ['ADMIN', 'HR'] },
  { label: 'My onboarding', to: '/my-onboarding', description: 'Your personal first-day plan', roles: ['NEW_HIRE'] },
]

function AppFrame() {
  const { role } = useRole()
  const { user, signOut } = useAuth()
  const [theme, setTheme] = useState(() => localStorage.getItem('onboardiq-theme') || 'light')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [query, setQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const canViewHires = ['ADMIN', 'HR', 'MANAGER'].includes(role)
  const { data: hires = [] } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires, staleTime: 30_000, enabled: canViewHires })

  useEffect(() => {
    localStorage.setItem('onboardiq-theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])
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
    <div className={`app-frame ${theme === 'dark' ? 'dark' : ''}`}>
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
            <div className="connection-status"><span className="live-dot" />Live</div>
            <button className="search-trigger" onClick={() => setPaletteOpen(true)} aria-label="Search or jump to">
              <Search size={16} /><span>Search anything</span><kbd><Command size={11} /> K</kbd>
            </button>
            {['ADMIN', 'HR', 'MANAGER'].includes(role) && <button className="icon-button topbar-icon" aria-label="Notifications" onClick={() => go(role === 'MANAGER' ? '/manager' : '/')}><Bell size={18} /><i className="notification-dot" /></button>}
            <button className="icon-button topbar-icon theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={17} />}
            </button>
            <button className="role-select" onClick={signOut} title="Sign out"><span className="role-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="role-name">Sign out</span><LogOut size={14} /></button>
          </div>
        </header>

        <main className="page-content" key={location.pathname}>
          <Routes>
            {['ADMIN', 'HR'].includes(role) && <Route path="/" element={<HRPage />} />}
            {['ADMIN', 'HR', 'MANAGER'].includes(role) && <Route path="/hire/:id" element={<HireDetail />} />}
            {['ADMIN', 'MANAGER'].includes(role) && <Route path="/manager" element={<ManagerPage />} />}
            {['ADMIN', 'IT_STAFF'].includes(role) && <Route path="/it" element={<ITPage />} />}
            {['ADMIN', 'HR'].includes(role) && <Route path="/insights" element={<InsightsPage />} />}
            {role === 'NEW_HIRE' && <Route path="/my-onboarding" element={<div className="empty-state"><Workflow size={30} /><h1>Your onboarding plan</h1><p>Your personal task timeline will appear here once HR links your hire record.</p></div>} />}
            <Route path="*" element={<div className="empty-state"><Compass size={30} /><h1>That page is not here yet</h1><p>Choose a workspace page from the navigation.</p><button className="button-primary" onClick={() => go('/')}>Back to overview</button></div>} />
          </Routes>
        </main>
        <footer className="app-footer"><span>OnboardIQ <span className="footer-separator">·</span> Workforce onboarding, in sync.</span><span><Sparkles size={13} /> AI off <span className="footer-muted">(templates)</span></span></footer>
      </div>

      {['ADMIN', 'HR'].includes(role) && <button className={`demo-fab ${demoOpen ? 'selected' : ''}`} onClick={() => setDemoOpen(value => !value)} aria-label={demoOpen ? 'Close demo controls' : 'Open demo controls'}>
        {demoOpen ? <X size={17} /> : <Gauge size={17} />}<span>Demo controls</span>
      </button>}
      {demoOpen && ['ADMIN', 'HR'].includes(role) && <div className="demo-drawer"><div className="demo-drawer-head"><div><span className="eyebrow">LIVE SIMULATION</span><h3>Demo controls</h3></div><button className="icon-button" onClick={() => setDemoOpen(false)} aria-label="Close demo controls"><X size={17} /></button></div><DemoPanel /></div>}

      {paletteOpen && <div className="palette-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false) }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="palette-search"><Search size={18} /><input autoFocus value={query === '?' ? '' : query} onChange={event => setQuery(event.target.value)} placeholder="Search pages, hires, or actions…" /><kbd>ESC</kbd></div>
          {query === '?' ? <div className="palette-results"><p className="palette-label">KEYBOARD SHORTCUTS</p><div className="shortcut-row"><span>Open search</span><kbd>⌘ K</kbd></div><div className="shortcut-row"><span>Focus search</span><kbd>/</kbd></div><div className="shortcut-row"><span>Close dialog</span><kbd>ESC</kbd></div><div className="shortcut-row"><span>Show shortcuts</span><kbd>?</kbd></div></div> : <div className="palette-results">
            <p className="palette-label">PAGES</p>
            {visibleRoutes.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.label} className="palette-option" onClick={() => go(item.to)}><span className="palette-option-icon"><ArrowUpRight size={16} /></span><span>{item.label}<small>{item.description}</small></span><kbd>↵</kbd></button>)}
            {query && hireResults.length > 0 && <><p className="palette-label">HIRES</p>{hireResults.slice(0, 5).map(hire => <button key={hire.id} className="palette-option" onClick={() => go(`/hire/${hire.id}`)}><span className="hire-avatar">{hire.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><span>{hire.name}<small>{hire.role} · {hire.department}</small></span><ArrowUpRight size={15} /></button>)}</>}
            {query && visibleRoutes.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())).length === 0 && hireResults.length === 0 && <div className="palette-empty">No pages or hires match “{query}”.</div>}
          </div>}
          <div className="palette-foot"><span><Command size={12} /> Navigate</span><span><Check size={12} /> Select</span><span><X size={12} /> Close</span></div>
        </section>
      </div>}
      <div className="sr-only" aria-live="polite">{current} page</div>
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
  const onAuthenticated = (nextUser: AuthUser) => { setUser(nextUser); navigate('/', { replace: true }) }

  if (checking) return <div className="auth-loading"><span className="brand-mark"><Workflow size={19} /></span><strong>Restoring your session…</strong></div>
  if (!user && ['/forgot-password', '/reset-password', '/accept-invite'].includes(location.pathname)) return <AccountRecovery />
  if (!user) return <LoginPage onAuthenticated={onAuthenticated} />
  if (location.pathname === '/login') return <Navigate to="/" replace />
  const role = user.role
  return <AuthContext.Provider value={{ user, signOut }}><RoleContext.Provider value={{ role, setRole: () => {} }}><AppFrame /></RoleContext.Provider></AuthContext.Provider>
}

export default function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AuthCoordinator /></BrowserRouter></QueryClientProvider>
}
