import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Item } from '@/types'

function mapItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as string,
    name: row.name as string,
    quantity: row.quantity as number,
    description: row.description as string,
    binId: row.bin_id as string,
    userId: row.user_id as string,
    createdAt: row.created_at as string,
  }
}

export function useItems() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map(mapItem)
    },
    enabled: !!user,
  })

  const createItem = useMutation({
    mutationFn: async (input: { name: string; quantity: number; description: string; binId: string }) => {
      const { data, error } = await supabase
        .from('items')
        .insert({ name: input.name, quantity: input.quantity, description: input.description, bin_id: input.binId, user_id: user!.id })
        .select()
        .single()
      if (error) throw error
      return mapItem(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })

  const updateItem = useMutation({
    mutationFn: async ({ id, ...input }: { id: string; name: string; quantity: number; description: string; binId: string }) => {
      const { data, error } = await supabase
        .from('items')
        .update({ name: input.name, quantity: input.quantity, description: input.description, bin_id: input.binId })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return mapItem(data)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })

  const moveItems = useMutation({
    mutationFn: async ({ itemIds, targetBinId }: { itemIds: string[]; targetBinId: string }) => {
      const { error } = await supabase
        .from('items')
        .update({ bin_id: targetBinId })
        .in('id', itemIds)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })

  const getItem = (id: string) => items.find(i => i.id === id)
  const getItemsByBin = (binId: string) => items.filter(i => i.binId === binId)

  return { items, isLoading, createItem, updateItem, deleteItem, moveItems, getItem, getItemsByBin }
}
