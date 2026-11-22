import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, createContext, useContext } from 'react'
import HRPage from './pages/HRPage'
import HireDetail from './pages/HireDetail'
import ManagerPage from './pages/ManagerPage'
import ITPage from './pages/ITPage'
import InsightsPage from './pages/InsightsPage'
import DemoPanel from './components/DemoPanel'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

export const RoleContext = createContext<{ role: string; setRole: (r: string) => void }>({ role: 'HR', setRole: () => {} })
export const useRole = () => useContext(RoleContext)

export default function App() {
  const [role, setRole] = useState('HR')
  const [dark, setDark] = useState(false)

  return (
    <QueryClientProvider client={queryClient}>
      <RoleContext.Provider value={{ role, setRole }}>
        <div className={dark ? 'dark' : ''}>
          <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
            <BrowserRouter>
              {/* Header */}
              <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">O²</div>
                    <span className="font-semibold text-sm hidden sm:block">Onboarding Orchestrator</span>
                  </div>
                  <nav className="flex gap-1">
                    {[
                      { label: 'HR', to: '/' },
                      { label: 'Manager', to: '/manager' },
                      { label: 'IT / Facilities', to: '/it' },
                      { label: 'Insights', to: '/insights' },
                    ].map(({ label, to }) => (
                      <NavLink key={to} to={to} end={to === '/'}
                        className={({ isActive }) =>
                          `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`
                        }>
                        {label}
                      </NavLink>
                    ))}
                  </nav>
                  <div className="flex items-center gap-2 shrink-0">
                    <select value={role} onChange={e => setRole(e.target.value)}
                      className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700">
                      {['HR', 'Manager', 'IT', 'Facilities'].map(r => <option key={r}>{r}</option>)}
                    </select>
                    <button onClick={() => setDark(d => !d)}
                      className="text-sm w-8 h-8 rounded border border-gray-300 dark:border-gray-600 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700">
                      {dark ? '☀️' : '🌙'}
                    </button>
                  </div>
                </div>
              </header>

              <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
                <main className="flex-1 min-w-0">
                  <Routes>
                    <Route path="/" element={<HRPage />} />
                    <Route path="/hire/:id" element={<HireDetail />} />
                    <Route path="/manager" element={<ManagerPage />} />
                    <Route path="/it" element={<ITPage />} />
                    <Route path="/insights" element={<InsightsPage />} />
                  </Routes>
                </main>
                <aside className="w-64 shrink-0 hidden lg:block">
                  <DemoPanel />
                </aside>
              </div>
            </BrowserRouter>
          </div>
        </div>
      </RoleContext.Provider>
    </QueryClientProvider>
  )
}
