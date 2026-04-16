import { useState, useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useItems } from '@/hooks/useItems'
import { useBins } from '@/hooks/useBins'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatBinNumber } from '@/lib/utils'

export default function ItemForm() {
  const { id } = useParams()
  const isEdit = !!id
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { items, createItem, updateItem } = useItems()
  const { bins } = useBins()
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [description, setDescription] = useState('')
  const [binId, setBinId] = useState(searchParams.get('binId') || '')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isEdit) {
      const item = items.find(i => i.id === id)
      if (item) {
        setName(item.name)
        setQuantity(item.quantity)
        setDescription(item.description)
        setBinId(item.binId)
      }
    }
  }, [id, items, isEdit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !binId) return
    setSubmitting(true)
    try {
      if (isEdit) {
        await updateItem.mutateAsync({ id: id!, name, quantity, description, binId })
        toast('Item updated!')
        navigate(`/bin/${binId}`)
      } else {
        await createItem.mutateAsync({ name, quantity, description, binId })
        toast('Item added!')
        navigate(`/bin/${binId}`)
      }
    } catch {
      toast('Something went wrong', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-lg mx-auto animate-fade-in">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? 'Edit Item' : 'New Item'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="e.g. Extension cord" value={name} onChange={e => setName(e.target.value)} required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={e => setQuantity(parseInt(e.target.value) || 1)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" placeholder="Optional notes..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
            </div>

            <div className="space-y-2">
              <Label>Bin *</Label>
              <Select value={binId} onValueChange={setBinId} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bin..." />
                </SelectTrigger>
                <SelectContent>
                  {bins.map(bin => (
                    <SelectItem key={bin.id} value={bin.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: bin.color }} />
                        #{formatBinNumber(bin.binNumber)} · {bin.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={submitting || !name.trim() || !binId} className="flex-1">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? 'Save changes' : 'Add item'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
