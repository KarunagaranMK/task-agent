import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowUpRight, Bell, Check, ChevronDown, Command, Compass,
  Gauge, HelpCircle, LayoutDashboard, Menu, Moon, PanelLeftClose, Search,
  ShieldCheck, Sparkles, Sun, Workflow, X,
} from 'lucide-react'
import HRPage from './pages/HRPage'
import HireDetail from './pages/HireDetail'
import ManagerPage from './pages/ManagerPage'
import ITPage from './pages/ITPage'
import InsightsPage from './pages/InsightsPage'
import DemoPanel from './components/DemoPanel'
import { getHires, type Hire } from './api/client'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })

export const RoleContext = createContext<{ role: string; setRole: (r: string) => void }>({ role: 'HR', setRole: () => {} })
export const useRole = () => useContext(RoleContext)

const navigation = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, group: 'Workspace' },
  { label: 'Approvals', to: '/manager', icon: ShieldCheck, group: 'Workspace', badge: '2' },
  { label: 'Team queue', to: '/it', icon: Workflow, group: 'Operations' },
  { label: 'Insights', to: '/insights', icon: Activity, group: 'Operations' },
]
const routes = [
  { label: 'Overview dashboard', to: '/', description: 'Hire portfolio and readiness' },
  { label: 'Manager approvals', to: '/manager', description: 'Review access requests and escalations' },
  { label: 'Team ticket queue', to: '/it', description: 'Work across IT and Facilities tasks' },
  { label: 'Insights and experiment', to: '/insights', description: 'Readiness metrics and policy comparison' },
]

function AppFrame() {
  const { role, setRole } = useRole()
  const [theme, setTheme] = useState(() => localStorage.getItem('onboardiq-theme') || 'light')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)
  const [query, setQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const { data: hires = [] } = useQuery<Hire[]>({ queryKey: ['hires'], queryFn: getHires, staleTime: 30_000 })

  useEffect(() => {
    localStorage.setItem('onboardiq-role', role)
  }, [role])
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

  const current = location.pathname.startsWith('/hire/') ? 'Hire overview' : (routes.find(item => item.to === location.pathname)?.label ?? 'OnboardIQ')
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
        <button className="workspace-switcher" onClick={() => setRole(role === 'HR' ? 'Manager' : 'HR')} title="Switch demo role">
          <span className="workspace-avatar">N</span>{!collapsed && <><span className="workspace-name">Northstar Labs<small>Demo workspace</small></span><ChevronDown size={15} /></>}
        </button>
        {!collapsed && <div className="sidebar-caption">WORKSPACE</div>}
        <nav className="nav-list">
          {navigation.map(item => <NavLink key={item.label} to={item.to} end={item.to === '/'} title={collapsed ? item.label : undefined}
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
          <div className="profile-avatar">{role === 'Manager' ? 'AM' : role === 'IT' ? 'JK' : 'SC'}</div>
          {!collapsed && <><div className="profile-copy"><strong>{role === 'Manager' ? 'Alex Morgan' : role === 'IT' ? 'Jordan Kim' : 'Sarah Chen'}</strong><small>{role} · Demo account</small></div><ChevronDown size={15} /></>}
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
            <button className="icon-button topbar-icon" aria-label="Notifications" onClick={() => go('/manager')}><Bell size={18} /><i className="notification-dot" /></button>
            <button className="icon-button topbar-icon theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={17} />}
            </button>
            <button className="role-select" value={role} onClick={() => setRole(role === 'HR' ? 'Manager' : role === 'Manager' ? 'IT' : 'HR')} title="Switch demo role"><span className="role-avatar">{role[0]}</span><span className="role-name">{role}</span><ChevronDown size={14} /></button>
          </div>
        </header>

        <main className="page-content" key={location.pathname}>
          <Routes>
            <Route path="/" element={<HRPage />} />
            <Route path="/hire/:id" element={<HireDetail />} />
            <Route path="/manager" element={<ManagerPage />} />
            <Route path="/it" element={<ITPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="*" element={<div className="empty-state"><Compass size={30} /><h1>That page is not here yet</h1><p>Choose a workspace page from the navigation.</p><button className="button-primary" onClick={() => go('/')}>Back to overview</button></div>} />
          </Routes>
        </main>
        <footer className="app-footer"><span>OnboardIQ <span className="footer-separator">·</span> Workforce onboarding, in sync.</span><span><Sparkles size={13} /> AI off <span className="footer-muted">(templates)</span></span></footer>
      </div>

      <button className={`demo-fab ${demoOpen ? 'selected' : ''}`} onClick={() => setDemoOpen(value => !value)} aria-label={demoOpen ? 'Close demo controls' : 'Open demo controls'}>
        {demoOpen ? <X size={17} /> : <Gauge size={17} />}<span>Demo controls</span>
      </button>
      {demoOpen && <div className="demo-drawer"><div className="demo-drawer-head"><div><span className="eyebrow">LIVE SIMULATION</span><h3>Demo controls</h3></div><button className="icon-button" onClick={() => setDemoOpen(false)} aria-label="Close demo controls"><X size={17} /></button></div><DemoPanel /></div>}

      {paletteOpen && <div className="palette-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPaletteOpen(false) }}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="palette-search"><Search size={18} /><input autoFocus value={query === '?' ? '' : query} onChange={event => setQuery(event.target.value)} placeholder="Search pages, hires, or actions…" /><kbd>ESC</kbd></div>
          {query === '?' ? <div className="palette-results"><p className="palette-label">KEYBOARD SHORTCUTS</p><div className="shortcut-row"><span>Open search</span><kbd>⌘ K</kbd></div><div className="shortcut-row"><span>Focus search</span><kbd>/</kbd></div><div className="shortcut-row"><span>Close dialog</span><kbd>ESC</kbd></div><div className="shortcut-row"><span>Show shortcuts</span><kbd>?</kbd></div></div> : <div className="palette-results">
            <p className="palette-label">PAGES</p>
            {routes.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.label} className="palette-option" onClick={() => go(item.to)}><span className="palette-option-icon"><ArrowUpRight size={16} /></span><span>{item.label}<small>{item.description}</small></span><kbd>↵</kbd></button>)}
            {query && hireResults.length > 0 && <><p className="palette-label">HIRES</p>{hireResults.slice(0, 5).map(hire => <button key={hire.id} className="palette-option" onClick={() => go(`/hire/${hire.id}`)}><span className="hire-avatar">{hire.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><span>{hire.name}<small>{hire.role} · {hire.department}</small></span><ArrowUpRight size={15} /></button>)}</>}
            {query && routes.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())).length === 0 && hireResults.length === 0 && <div className="palette-empty">No pages or hires match “{query}”.</div>}
          </div>}
          <div className="palette-foot"><span><Command size={12} /> Navigate</span><span><Check size={12} /> Select</span><span><X size={12} /> Close</span></div>
        </section>
      </div>}
      <div className="sr-only" aria-live="polite">{current} page</div>
    </div>
  )
}

export default function App() {
  const [role, setRole] = useState(() => localStorage.getItem('onboardiq-role') || 'HR')
  return <QueryClientProvider client={queryClient}><RoleContext.Provider value={{ role, setRole }}><BrowserRouter><AppFrame /></BrowserRouter></RoleContext.Provider></QueryClientProvider>
}
