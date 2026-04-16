import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit, Trash2, Plus, MapPin, FileText, Printer, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { useItems } from '@/hooks/useItems'
import { useUserRole } from '@/hooks/useUserRole'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, Badge } from '@/components/ui/primitives'
import { formatBinNumber } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export default function BinDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { bins, deleteBin } = useBins()
  const { getItemsByBin, deleteItem } = useItems()
  const { isAdmin } = useUserRole()
  const { toast } = useToast()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const bin = bins.find(b => b.id === id)
  const items = id ? getItemsByBin(id) : []

  if (!bin) return (
    <div className="p-8 text-center text-muted-foreground">
      <p>Bin not found</p>
      <Button variant="ghost" className="mt-4" onClick={() => navigate('/')}>Go home</Button>
    </div>
  )

  const qrUrl = `${window.location.origin}/bin/${bin.id}`

  const handleDeleteBin = async () => {
    setDeleting(true)
    try {
      await deleteBin.mutateAsync(bin.id)
      toast('Bin deleted')
      navigate('/')
    } catch {
      toast('Failed to delete bin', 'error')
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    try {
      await deleteItem.mutateAsync(itemId)
      toast('Item removed')
    } catch {
      toast('Failed to delete item', 'error')
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Bin header card */}
      <Card className="mb-6 overflow-hidden">
        <div className="h-2 w-full" style={{ backgroundColor: bin.color }} />
        <CardContent className="pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className="font-mono">#{formatBinNumber(bin.binNumber)}</Badge>
              </div>
              <h1 className="font-display font-bold text-2xl">{bin.name}</h1>
              {bin.location && (
                <div className="flex items-center gap-1.5 mt-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span className="text-sm">{bin.location}</span>
                </div>
              )}
              {bin.description && (
                <div className="flex items-start gap-1.5 mt-2 text-muted-foreground">
                  <FileText className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="text-sm">{bin.description}</span>
                </div>
              )}
            </div>

            {/* QR Code */}
            <div className="shrink-0 p-2 bg-white rounded-lg border">
              <QRCodeSVG value={qrUrl} size={80} />
            </div>
          </div>

          {isAdmin && (
            <div className="flex gap-2 mt-5">
              <Button variant="outline" size="sm" onClick={() => navigate(`/bin/${bin.id}/edit`)}>
                <Edit className="h-4 w-4" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print Label
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive ml-auto" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-lg">Items ({items.length})</h2>
        {isAdmin && (
          <Button size="sm" onClick={() => navigate(`/item/new?binId=${bin.id}`)}>
            <Plus className="h-4 w-4" /> Add item
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
          <p className="text-sm">No items in this bin yet</p>
          {isAdmin && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate(`/item/new?binId=${bin.id}`)}>
              Add first item
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 hover:border-primary/30 transition-colors">
              <div className="min-w-0">
                <p className="font-medium text-sm">{item.name}</p>
                {item.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.description}</p>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge variant="secondary">Qty: {item.quantity}</Badge>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/item/${item.id}/edit`)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDeleteItem(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete bin?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{bin.name}</strong> and all {items.length} item{items.length !== 1 ? 's' : ''} inside it. This cannot be undone.
          </p>
          <div className="flex gap-3 mt-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} className="flex-1">Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteBin} disabled={deleting} className="flex-1">
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
