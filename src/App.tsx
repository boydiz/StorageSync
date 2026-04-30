import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ToastProvider } from '@/components/ui/toast'
import { AppLayout } from '@/components/layout/AppLayout'
import AuthPage from '@/pages/AuthPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import Dashboard from '@/pages/Dashboard'
import BinDetail from '@/pages/BinDetail'
import BinForm from '@/pages/BinForm'
import ItemForm from '@/pages/ItemForm'
import ItemsPage from '@/pages/ItemsPage'
import LabelsPage from '@/pages/LabelsPage'
import SettingsPage from '@/pages/SettingsPage'
import { Loader2 } from 'lucide-react'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60, retry: 1 },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="animate-spin h-6 w-6 text-primary" />
    </div>
  )
  if (!user) return <Navigate to="/auth" replace />
  return <AppLayout>{children}</AppLayout>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/items" element={<ProtectedRoute><ItemsPage /></ProtectedRoute>} />
      <Route path="/labels" element={<ProtectedRoute><LabelsPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/bin/new" element={<ProtectedRoute><BinForm /></ProtectedRoute>} />
      <Route path="/bin/:id" element={<ProtectedRoute><BinDetail /></ProtectedRoute>} />
      <Route path="/bin/:id/edit" element={<ProtectedRoute><BinForm /></ProtectedRoute>} />
      <Route path="/item/new" element={<ProtectedRoute><ItemForm /></ProtectedRoute>} />
      <Route path="/item/:id/edit" element={<ProtectedRoute><ItemForm /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
