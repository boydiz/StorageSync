import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input, Label, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { Archive, Loader2, CheckCircle } from 'lucide-react'

type Mode = 'login' | 'signup' | 'forgot'

export default function AuthPage() {
  const { user, loading } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="animate-spin h-6 w-6 text-primary" />
    </div>
  )
  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('Account created! Check your email to confirm, then sign in.')
        setMode('login')
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
        setSuccess('Check your email for a password reset link!')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSubmitting(false)
    }
  }

  const titles: Record<Mode, string> = {
    login: 'Welcome back',
    signup: 'Create account',
    forgot: 'Reset password',
  }

  const buttonLabels: Record<Mode, string> = {
    login: 'Sign in',
    signup: 'Create account',
    forgot: 'Send reset link',
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Archive className="h-7 w-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="font-display font-bold text-2xl">StorageSync</h1>
            <p className="text-muted-foreground text-sm mt-1">Organize your storage bins</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center text-lg">{titles[mode]}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Forgot password success state */}
            {mode === 'forgot' && success ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <CheckCircle className="h-10 w-10 text-green-500" />
                <p className="font-medium text-sm">{success}</p>
                <Button variant="outline" className="w-full mt-2" onClick={() => { setMode('login'); setSuccess('') }}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                {mode !== 'forgot' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      {mode === 'login' && (
                        <button
                          type="button"
                          onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}
                          className="text-xs text-primary hover:underline"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      minLength={6}
                    />
                  </div>
                )}

                {mode === 'forgot' && (
                  <p className="text-sm text-muted-foreground">
                    Enter your email and we'll send you a link to reset your password.
                  </p>
                )}

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                )}
                {success && mode !== 'forgot' && (
                  <p className="text-sm text-primary bg-primary/10 rounded-md px-3 py-2">{success}</p>
                )}

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {buttonLabels[mode]}
                </Button>
              </form>
            )}

            {/* Footer links */}
            {!success && (
              <div className="mt-4 text-center text-sm text-muted-foreground">
                {mode === 'login' && (
                  <>Don't have an account?{' '}
                    <button onClick={() => { setMode('signup'); setError('') }} className="text-primary font-medium hover:underline">Sign up</button>
                  </>
                )}
                {mode === 'signup' && (
                  <>Already have an account?{' '}
                    <button onClick={() => { setMode('login'); setError('') }} className="text-primary font-medium hover:underline">Sign in</button>
                  </>
                )}
                {mode === 'forgot' && !success && (
                  <button onClick={() => { setMode('login'); setError('') }} className="text-primary font-medium hover:underline">Back to sign in</button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
