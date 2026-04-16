import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export function useUserRole() {
  const { user } = useAuth()

  const { data: role, isLoading } = useQuery({
    queryKey: ['user-role', user?.id],
    queryFn: async () => {
      if (!user) return 'admin'
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'viewer')
        .maybeSingle()
      return data ? 'viewer' : 'admin'
    },
    enabled: !!user,
  })

  return {
    role: role ?? 'admin',
    isAdmin: role !== 'viewer',
    isViewer: role === 'viewer',
    loading: isLoading,
  }
}
