import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Package, MoveRight, Plus } from 'lucide-react'
import { useItems } from '@/hooks/useItems'
import { useBins } from '@/hooks/useBins'
import { useUserRole } from '@/hooks/useUserRole'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input, Badge } from '@/components/ui/primitives'
import { Checkbox } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatBinNumber } from '@/lib/utils'

export default function ItemsPage() {
  const navigate = useNavigate()
  const { items, moveItems } = useItems()
  const { bins } = useBins()
  const { isAdmin } = useUserRole()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const [targetBinId, setTargetBinId] = useState('')
  const [moving, setMoving] = useState(false)

  const q = search.toLowerCase()
  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q)
  )

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleMove = async () => {
    if (!targetBinId || selected.size === 0) return
    setMoving(true)
    try {
      await moveItems.mutateAsync({ itemIds: Array.from(selected), targetBinId })
      toast(`Moved ${selected.size} item${selected.size > 1 ? 's' : ''}!`)
      setSelected(new Set())
      setMoveDialogOpen(false)
    } catch {
      toast('Failed to move items', 'error')
    } finally {
      setMoving(false)
    }
  }

  const getBin = (binId: string) => bins.find(b => b.id === binId)

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">All Items</h1>
          <p className="text-muted-foreground text-sm mt-1">{items.length} total items</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => navigate('/item/new')}>
            <Plus className="h-4 w-4" /> New item
          </Button>
        )}
      </div>

      {/* Search + batch actions */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search items..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {isAdmin && selected.size > 0 && (
          <Button onClick={() => setMoveDialogOpen(true)} variant="outline">
            <MoveRight className="h-4 w-4" /> Move {selected.size}
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{search ? 'No items match your search' : 'No items yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const bin = getBin(item.binId)
            const isChecked = selected.has(item.id)
            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors ${isChecked ? 'border-primary/50 bg-primary/5' : 'hover:border-border'}`}
              >
                {isAdmin && (
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleSelect(item.id)}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{item.name}</p>
                  {item.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">×{item.quantity}</Badge>
                  {bin && (
                    <button onClick={() => navigate(`/bin/${bin.id}`)} className="flex items-center gap-1.5 bg-secondary rounded-full px-2.5 py-1 hover:bg-accent transition-colors">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: bin.color }} />
                      <span className="text-xs font-mono">#{formatBinNumber(bin.binNumber)}</span>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Move dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selected.size} item{selected.size > 1 ? 's' : ''} to...</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {bins.map(bin => (
              <label
                key={bin.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${targetBinId === bin.id ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
              >
                <input type="radio" name="targetBin" value={bin.id} checked={targetBinId === bin.id} onChange={() => setTargetBinId(bin.id)} className="hidden" />
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: bin.color }} />
                <span className="font-mono text-xs text-muted-foreground">#{formatBinNumber(bin.binNumber)}</span>
                <span className="text-sm font-medium">{bin.name}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleMove} disabled={!targetBinId || moving} className="flex-1">
              Move items
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
