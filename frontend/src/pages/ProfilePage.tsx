import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, KeyRound, UserRound } from 'lucide-react'
import { changePassword, getMe, getPreferences, savePreferences, updateProfile } from '../api/client'

export default function ProfilePage() {
  const qc = useQueryClient()
  const userQuery = useQuery({ queryKey: ['me'], queryFn: getMe })
  const prefsQuery = useQuery({ queryKey: ['preferences'], queryFn: getPreferences })
  const [name, setName] = useState('')
  const [prefs, setPrefs] = useState({ in_app: true, email: false })
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => { if (userQuery.data) setName(userQuery.data.name) }, [userQuery.data])
  useEffect(() => { if (prefsQuery.data) setPrefs(prefsQuery.data) }, [prefsQuery.data])

  const profile = useMutation({ mutationFn: () => updateProfile(name.trim()), onSuccess: data => { setName(data.name); setMessage('Profile saved.'); void qc.invalidateQueries({ queryKey: ['me'] }) } })
  const preferences = useMutation({ mutationFn: () => savePreferences(prefs), onSuccess: () => setMessage('Notification preferences saved.') })
  const password = useMutation({ mutationFn: () => changePassword(current, next), onSuccess: () => { setCurrent(''); setNext(''); setMessage('Password changed. Sign in again with your new password.') } })
  const error = [profile.error, preferences.error, password.error].find(Boolean) as Error | undefined

  return <main className="admin-page profile-page">
    <header className="admin-header"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>Profile & preferences</h1><p>Keep your personal details and sign-in settings up to date.</p></div><span className="admin-count">{userQuery.data?.role?.replace('_', ' ')}</span></header>
    {message && <div className="profile-status" role="status"><Check size={16} />{message}</div>}
    {error && <div className="profile-error" role="alert">{error.message}</div>}
    <div className="admin-grid profile-grid">
      <section className="admin-card"><div className="admin-card-head"><div><h2><UserRound size={18} /> Profile</h2><p>Visible to teammates in your OnboardFlow AI workspace.</p></div></div><form onSubmit={event => { event.preventDefault(); profile.mutate() }} className="profile-form"><label>Full name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Work email<input value={userQuery.data?.email ?? ''} readOnly /></label><label>Role<input value={userQuery.data?.role?.replace(/_/g, ' ') ?? ''} readOnly /></label><button className="button-primary" disabled={profile.isPending || !name.trim()}><Check size={15} /> Save profile</button></form></section>
      <section className="admin-card"><div className="admin-card-head"><div><h2><Bell size={18} /> Notifications</h2><p>Choose which updates appear in your account.</p></div></div><div className="profile-preferences"><label className="setting-switch"><input type="checkbox" checked={prefs.in_app} onChange={event => setPrefs({ ...prefs, in_app: event.target.checked })} /><span><b>In-app notifications</b><small>Show onboarding activity in the notification center.</small></span></label><label className="setting-switch"><input type="checkbox" checked={prefs.email} onChange={event => setPrefs({ ...prefs, email: event.target.checked })} /><span><b>Email preference</b><small>Save your preference for email updates.</small></span></label><button className="button-primary" disabled={preferences.isPending} onClick={() => preferences.mutate()}><Check size={15} /> Save preferences</button></div></section>
      <section className="admin-card"><div className="admin-card-head"><div><h2><KeyRound size={18} /> Change password</h2><p>Use at least 10 characters. You’ll need to sign in again after changing it.</p></div></div><form className="profile-form" onSubmit={event => { event.preventDefault(); password.mutate() }}><label>Current password<input type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} /></label><label>New password<input type="password" autoComplete="new-password" minLength={10} required value={next} onChange={event => setNext(event.target.value)} /></label><button className="button-primary" disabled={password.isPending}><KeyRound size={15} /> Update password</button></form></section>
    </div>
  </main>
}
