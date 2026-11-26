import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, CircleHelp, Eye, EyeOff, LockKeyhole, Mail, Workflow } from 'lucide-react'
import { getDemoStatus, login, type AuthUser } from '../api/client'

const demoAccounts = [
  { label: 'Admin', email: 'admin@demo.local' },
  { label: 'HR', email: 'hr@demo.local' },
  { label: 'IT', email: 'it@demo.local' },
  { label: 'Facilities', email: 'facilities@demo.local' },
]
const demoPassword = 'OnboardIQ-Demo!'

export default function LoginPage({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoEnabled, setDemoEnabled] = useState(false)

  useEffect(() => {
    let active = true
    getDemoStatus().then(enabled => { if (active) setDemoEnabled(enabled) }).catch(() => { if (active) setDemoEnabled(false) })
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      onAuthenticated(await login(email, password))
    } catch (cause) {
      const failure = cause as { code?: string; response?: { status?: number } }
      if (failure.code === 'ERR_NETWORK') setError('The sign-in service is unavailable. Start the app with “python run.py” or contact your workspace administrator.')
      else if (failure.response?.status === 429) setError('Too many sign-in attempts. Wait a few minutes, then try again.')
      else if (failure.response?.status === 401) setError('Email or password was not accepted. Check your details and try again.')
      else setError('We couldn’t complete sign-in. Check the service connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function choose(emailAddress: string) {
    setEmail(emailAddress)
    setPassword(demoPassword)
    setError('')
  }

  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="login-brand"><span className="login-brand-mark"><Workflow size={20} /></span><strong>OnboardFlow</strong></div>
        <div className="login-story-copy">
          <span className="login-kicker"><span /> EMPLOYEE ONBOARDING</span>
          <h1>Coordinate every handoff.<br /><em>Prepare for Day 1.</em></h1>
          <p>Give HR, IT, and Facilities one shared view of onboarding tasks, approvals, and readiness.</p>
          <div className="login-flow" aria-label="Onboarding flow">
            <div className="flow-step completed"><span><Check size={13} /></span><div><strong>Plan created</strong><small>Role-specific tasks mapped</small></div></div>
            <div className="flow-connector" />
            <div className="flow-step completed"><span><Check size={13} /></span><div><strong>Teams coordinated</strong><small>IT · HR · Facilities</small></div></div>
            <div className="flow-connector" />
            <div className="flow-step active"><span><Check size={13} /></span><div><strong>Ready for Day 1</strong><small>Key tasks tracked to completion</small></div></div>
          </div>
        </div>
        <div className="login-story-footer"><span>Clear ownership from registration to Day 1.</span><span>HR <i>·</i> IT <i>·</i> Facilities</span></div>
      </section>

      <section className="login-panel">
        <div className="login-panel-top"><span className="login-workspace"><span className="workspace-dot">N</span> Northstar Labs</span><Link className="login-help" to="/guide" title="Project guide" aria-label="Open the project guide"><CircleHelp size={16} /></Link></div>
        <div className="login-card">
          <div className="login-heading"><span className="login-eyebrow">WORKSPACE ACCESS</span><h2>Sign in</h2><p>Use your work email to continue to OnboardFlow.</p></div>
          <form onSubmit={submit} className="login-form">
            <label htmlFor="login-email">Work email</label>
            <div className="login-input-wrap"><Mail size={16} /><input id="login-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" required /></div>
            <div className="login-password-label"><label htmlFor="login-password">Password</label><Link to="/forgot-password" className="forgot-link">Forgot password?</Link></div>
            <div className="login-input-wrap"><LockKeyhole size={16} /><input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter your password" required /><button type="button" className="show-password" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="login-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button>
          </form>
          {demoEnabled && <div className="demo-accounts">
            <div className="demo-accounts-title"><span>DEMO ACCOUNTS</span><small>Select a role to fill its credentials</small></div>
            <div className="demo-chip-grid">{demoAccounts.map(account => <button type="button" key={account.email} className={`demo-chip ${email === account.email ? 'selected' : ''}`} onClick={() => choose(account.email)}>{account.label}{email === account.email && <Check size={12} />}</button>)}</div>
            <p className="demo-password-note">Shared demo password: <code>{demoPassword}</code></p>
          </div>}
          <div className="login-trust"><LockKeyhole size={13} /><span>Session protected with rotating, httpOnly refresh cookies</span></div>
        </div>
        <div className="login-panel-footer"><span>© 2026 OnboardFlow</span><span>Employee onboarding workspace</span></div>
      </section>
    </main>
  )
}
