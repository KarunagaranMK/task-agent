import { FormEvent, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, LockKeyhole, Mail, Workflow } from 'lucide-react'
import { acceptInvite, requestPasswordReset, resetPassword } from '../api/client'

export default function AccountRecovery() {
  const location = useLocation()
  const navigate = useNavigate()
  const invite = location.pathname === '/accept-invite'
  const reset = location.pathname === '/reset-password'
  const token = new URLSearchParams(location.search).get('token') ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [sent, setSent] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      if (!reset && !invite) { await requestPasswordReset(email); setSent(true); return }
      if (password !== confirm) { setError('Those passwords do not match.'); return }
      if (!token) { setError('This link is missing its security token. Request a new link from your administrator.'); return }
      if (invite) await acceptInvite(token, password)
      else await resetPassword(token, password)
      setComplete(true)
    } catch {
      setError('This link may have expired or already been used. Request a new link and try again.')
    } finally { setBusy(false) }
  }

  const title = reset ? 'Choose a new password' : invite ? 'Set up your account' : 'Reset your password'
  return <main className="recovery-page">
    <section className="recovery-card">
      <div className="recovery-brand"><span className="login-brand-mark"><Workflow size={20} /></span><strong>onboard<span>iq</span></strong></div>
      {complete || sent ? <div className="recovery-result"><span className="recovery-result-icon"><CheckCircle2 size={26} /></span><span className="login-eyebrow">{complete ? 'ALL SET' : 'CHECK YOUR INBOX'}</span><h1>{complete ? 'Your account is ready' : 'If there’s an account, a link is on its way'}</h1><p>{complete ? 'Your password has been updated. Sign in to continue to your workspace.' : 'For privacy, we show the same confirmation for every email address. The link is valid for 30 minutes.'}</p><button className="login-submit" type="button" onClick={() => navigate('/login')}>Back to sign in <ArrowLeft size={16} /></button></div> : <>
        <span className="login-eyebrow">ACCOUNT SECURITY</span><h1>{title}</h1>
        <p className="recovery-intro">{reset ? 'Choose a strong password with at least 10 characters.' : invite ? 'Create a secure password to activate your OnboardIQ account.' : 'Enter your work email and we’ll send a secure recovery link if an account matches.'}</p>
        <form className="login-form" onSubmit={submit}>
          {!reset && !invite && <><label htmlFor="recovery-email">Work email</label><div className="login-input-wrap"><Mail size={16} /><input id="recovery-email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="name@company.com" /></div></>}
          {(reset || invite) && <><label htmlFor="new-password">New password</label><div className="login-input-wrap"><LockKeyhole size={16} /><input id="new-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={e => setPassword(e.target.value)} required placeholder="At least 10 characters" /></div><label htmlFor="confirm-password">Confirm password</label><div className="login-input-wrap"><LockKeyhole size={16} /><input id="confirm-password" type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={e => setConfirm(e.target.value)} required placeholder="Enter it again" /></div></>}
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : reset || invite ? 'Save password' : 'Send recovery link'}</button>
        </form>
        <Link to="/login" className="recovery-back"><ArrowLeft size={15} /> Back to sign in</Link>
      </>}
    </section>
  </main>
}
