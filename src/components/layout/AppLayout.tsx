import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Package, Tag, Settings, LogOut, Plus, Box, Archive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useUserRole } from '@/hooks/useUserRole'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/items', icon: Package, label: 'Items' },
  { to: '/labels', icon: Tag, label: 'Labels' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  const { isAdmin } = useUserRole()
  const { settings } = useAppSettings()
  const [fabOpen, setFabOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-56 border-r border-border bg-card shrink-0">
        {/* Logo area */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          {settings?.logoDataUrl ? (
            <img src={settings.logoDataUrl} alt="logo" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Archive className="h-4 w-4 text-primary" />
            </div>
          )}
          <span className="font-display font-bold text-base truncate">{settings?.appName || 'StorageSync'}</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-border">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors w-full"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex z-40 no-print">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex-1 flex flex-col items-center justify-center py-2 gap-1 text-xs font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* FAB (admin only) */}
      {isAdmin && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 no-print">
          {fabOpen && (
            <div className="absolute bottom-14 right-0 flex flex-col gap-2 items-end animate-fade-in">
              <button
                onClick={() => { navigate('/bin/new'); setFabOpen(false) }}
                className="flex items-center gap-2 bg-card border border-border shadow-lg rounded-full px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                <Box className="h-4 w-4 text-primary" /> New Bin
              </button>
              <button
                onClick={() => { navigate('/item/new'); setFabOpen(false) }}
                className="flex items-center gap-2 bg-card border border-border shadow-lg rounded-full px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                <Package className="h-4 w-4 text-primary" /> New Item
              </button>
            </div>
          )}
          <Button
            size="icon"
            className={cn('h-14 w-14 rounded-full shadow-lg transition-transform', fabOpen && 'rotate-45')}
            onClick={() => setFabOpen(v => !v)}
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  )
}
