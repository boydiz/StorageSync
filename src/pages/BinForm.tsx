import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useBins } from '@/hooks/useBins'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'

const COLOR_PRESETS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

export default function BinForm() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const { bins, createBin, updateBin } = useBins()
  const { toast } = useToast()

  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isEdit) {
      const bin = bins.find(b => b.id === id)
      if (bin) {
        setName(bin.name)
        setLocation(bin.location)
        setDescription(bin.description)
        setColor(bin.color)
      }
    }
  }, [id, bins, isEdit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      if (isEdit) {
        await updateBin.mutateAsync({ id: id!, name, location, description, color })
        toast('Bin updated!')
        navigate(`/bin/${id}`)
      } else {
        const bin = await createBin.mutateAsync({ name, location, description, color })
        toast('Bin created!')
        navigate(`/bin/${bin.id}`)
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
          <CardTitle>{isEdit ? 'Edit Bin' : 'New Bin'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="e.g. Holiday Decorations" value={name} onChange={e => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" placeholder="e.g. Garage shelf 2" value={location} onChange={e => setLocation(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" placeholder="What's in this bin..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
            </div>

            {/* Color picker */}
            <div className="space-y-3">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? 'hsl(var(--foreground))' : 'transparent',
                    }}
                  />
                ))}
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="color"
                    value={color}
                    onChange={e => setColor(e.target.value)}
                    className="h-8 w-8 rounded-full border border-input cursor-pointer"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{color}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={submitting || !name.trim()} className="flex-1">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEdit ? 'Save changes' : 'Create bin'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
