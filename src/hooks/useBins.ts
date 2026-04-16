import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Bin } from '@/types'

function mapBin(row: Record<string, unknown>): Bin {
  return {
    id: row.id as string,
    binNumber: row.bin_number as number,
    name: row.name as string,
    location: row.location as string,
    description: row.description as string,
    color: row.color as string,
    createdAt: row.created_at as string,
    userId: row.user_id as string,
  }
}

export function useBins() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data: bins = [], isLoading } = useQuery({
    queryKey: ['bins', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bins')
        .select('*')
        .order('bin_number', { ascending: true })
      if (error) throw error
      return (data || []).map(mapBin)
    },
    enabled: !!user,
  })

  const createBin = useMutation({
    mutationFn: async (input: { name: string; location: string; description: string; color: string }) => {
      const { data: nextNum } = await supabase.rpc('get_next_bin_number', { _user_id: user!.id })
      const { data, error } = await supabase
        .from('bins')
        .insert({ ...input, user_id: user!.id, bin_number: nextNum })
        .select()
        .single()
      if (error) throw error
      return mapBin(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bins'] }),
  })

  const updateBin = useMutation({
    mutationFn: async ({ id, ...input }: { id: string; name: string; location: string; description: string; color: string }) => {
      const { data, error } = await supabase
        .from('bins')
        .update(input)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return mapBin(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bins'] }),
  })

  const deleteBin = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bins').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bins'] })
      qc.invalidateQueries({ queryKey: ['items'] })
    },
  })

  const getBin = (id: string) => bins.find(b => b.id === id)

  return { bins, isLoading, createBin, updateBin, deleteBin, getBin }
}
