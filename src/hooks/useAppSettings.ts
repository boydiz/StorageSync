import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { AppSettings } from '@/types'

function mapSettings(row: Record<string, unknown>): AppSettings {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    appName: row.app_name as string,
    appDescription: row.app_description as string,
    logoDataUrl: row.logo_data_url as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function useAppSettings() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle()
      if (error) throw error
      return data ? mapSettings(data) : null
    },
    enabled: !!user,
  })

  const update = useMutation({
    mutationFn: async (input: Partial<{ appName: string; appDescription: string; logoDataUrl: string | null }>) => {
      const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (input.appName !== undefined) payload.app_name = input.appName
      if (input.appDescription !== undefined) payload.app_description = input.appDescription
      if (input.logoDataUrl !== undefined) payload.logo_data_url = input.logoDataUrl

      const { data, error } = await supabase
        .from('app_settings')
        .update(payload)
        .eq('user_id', user!.id)
        .select()
        .single()
      if (error) throw error
      return mapSettings(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  })

  return { settings, isLoading, update }
}
