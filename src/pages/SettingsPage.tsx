import { useState, useEffect } from 'react'
import { Loader2, Upload, X, UserPlus, Trash2 } from 'lucide-react'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useUserRole } from '@/hooks/useUserRole'
import { useDarkMode } from '@/hooks/useDarkMode'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/toast'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/controls'

interface SharedUser {
  id: string
  sharedWithUserId: string
  email: string
}

export default function SettingsPage() {
  const { settings, update } = useAppSettings()
  const { isViewer } = useUserRole()
  const { isDark, toggle: toggleDark } = useDarkMode()
  const { user } = useAuth()
  const { toast } = useToast()

  const [appName, setAppName] = useState('')
  const [appDesc, setAppDesc] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [shareEmail, setShareEmail] = useState('')
  const [sharing, setSharing] = useState(false)
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([])

  useEffect(() => {
    if (settings) {
      setAppName(settings.appName)
      setAppDesc(settings.appDescription)
      setLogoPreview(settings.logoDataUrl)
    }
  }, [settings])

  useEffect(() => {
    if (user && !isViewer) loadSharedUsers()
  }, [user, isViewer])

  const loadSharedUsers = async () => {
    const { data } = await supabase
      .from('shared_access')
      .select('id, shared_with_user_id')
      .eq('owner_id', user!.id)
    if (data) {
      const usersWithEmail = await Promise.all(
        data.map(async (row) => {
          const { data: userData } = await supabase.auth.admin?.getUserById(row.shared_with_user_id).catch(() => ({ data: null })) || { data: null }
          return {
            id: row.id,
            sharedWithUserId: row.shared_with_user_id,
            email: (userData as { user?: { email?: string } })?.user?.email || row.shared_with_user_id,
          }
        })
      )
      setSharedUsers(usersWithEmail)
    }
  }

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 200 * 1024) { toast('Logo must be under 200KB', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => setLogoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await update.mutateAsync({ appName, appDescription: appDesc, logoDataUrl: logoPreview })
      toast('Settings saved!')
    } catch {
      toast('Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleShare = async () => {
    if (!shareEmail.trim()) return
    setSharing(true)
    try {
      const { data: userId } = await supabase.rpc('get_user_id_by_email', { _email: shareEmail.trim() })
      if (!userId) { toast('User not found with that email', 'error'); return }
      if (userId === user!.id) { toast("You can't share with yourself", 'error'); return }

      const { error: accessError } = await supabase.from('shared_access').insert({ owner_id: user!.id, shared_with_user_id: userId })
      if (accessError) { toast('Already shared with this user', 'error'); return }

      await supabase.from('user_roles').upsert({ user_id: userId, role: 'viewer' })
      toast(`Shared with ${shareEmail}!`)
      setShareEmail('')
      loadSharedUsers()
    } catch {
      toast('Failed to share', 'error')
    } finally {
      setSharing(false)
    }
  }

  const handleRemoveShare = async (shareId: string, userId: string) => {
    await supabase.from('shared_access').delete().eq('id', shareId)
    await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'viewer')
    loadSharedUsers()
    toast('Access removed')
  }

  if (isViewer) {
    return (
      <div className="p-4 md:p-8 max-w-lg mx-auto animate-fade-in">
        <h1 className="font-display font-bold text-2xl mb-6">Settings</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center py-4">You have view-only access to this inventory. Settings can only be managed by the owner.</p>
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <Label>Dark mode</Label>
              <Switch checked={isDark} onCheckedChange={toggleDark} />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-lg mx-auto animate-fade-in space-y-6">
      <h1 className="font-display font-bold text-2xl md:text-3xl">Settings</h1>

      {/* Appearance */}
      <Card>
        <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label>Dark mode</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Toggle dark theme</p>
            </div>
            <Switch checked={isDark} onCheckedChange={toggleDark} />
          </div>
        </CardContent>
      </Card>

      {/* Branding */}
      <Card>
        <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>App Name</Label>
            <Input value={appName} onChange={e => setAppName(e.target.value)} placeholder="StorageSync" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={appDesc} onChange={e => setAppDesc(e.target.value)} placeholder="Brief description..." rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Logo</Label>
            {logoPreview ? (
              <div className="flex items-center gap-3">
                <img src={logoPreview} alt="logo" className="h-14 w-14 rounded-xl object-cover border" />
                <Button variant="outline" size="sm" onClick={() => setLogoPreview(null)}>
                  <X className="h-4 w-4" /> Remove
                </Button>
              </div>
            ) : (
              <label className="flex items-center gap-2 cursor-pointer border border-dashed rounded-lg px-4 py-3 hover:bg-accent transition-colors">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Upload logo (SVG/PNG/JPG, max 200KB)</span>
                <input type="file" accept="image/svg+xml,image/png,image/jpeg" className="hidden" onChange={handleLogoUpload} />
              </label>
            )}
          </div>
          <Button onClick={handleSaveSettings} disabled={saving} className="w-full">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </CardContent>
      </Card>

      {/* Sharing */}
      <Card>
        <CardHeader><CardTitle>Share Access</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Invite someone to view your inventory (read-only).</p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="email@example.com"
              value={shareEmail}
              onChange={e => setShareEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleShare()}
            />
            <Button onClick={handleShare} disabled={sharing || !shareEmail.trim()}>
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            </Button>
          </div>

          {sharedUsers.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Shared with</p>
              {sharedUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{u.email}</p>
                    <p className="text-xs text-muted-foreground">Viewer</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleRemoveShare(u.id, u.sharedWithUserId)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
