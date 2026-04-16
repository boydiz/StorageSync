import { useState } from 'react'
import { Printer, Tag } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { formatBinNumber } from '@/lib/utils'

const LAYOUTS = [1, 2, 3, 4, 5, 6] as const
type Layout = typeof LAYOUTS[number]

function LabelCard({ bin, layout }: { bin: ReturnType<typeof useBins>['bins'][0], layout: Layout }) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const qrSize = layout <= 2 ? 100 : layout <= 4 ? 70 : 55
  const isWide = layout === 3

  return (
    <div
      className="border border-gray-300 rounded-lg overflow-hidden bg-white"
      style={{ breakInside: 'avoid' }}
    >
      <div className="h-2 w-full" style={{ backgroundColor: bin.color }} />
      <div className={`p-3 flex ${isWide ? 'flex-row gap-4' : 'flex-col gap-3'} items-${isWide ? 'center' : 'start'}`}>
        <div className="flex-1 min-w-0">
          <p className={`font-mono text-gray-500 ${layout <= 2 ? 'text-sm' : 'text-xs'}`}>
            #{formatBinNumber(bin.binNumber)}
          </p>
          <p className={`font-bold text-gray-900 break-words ${layout === 1 ? 'text-xl' : layout <= 3 ? 'text-base' : 'text-sm'}`}>
            {bin.name}
          </p>
          {bin.location && (
            <p className={`text-gray-600 mt-1 ${layout <= 2 ? 'text-sm' : 'text-xs'}`}>{bin.location}</p>
          )}
          {bin.description && layout <= 3 && (
            <p className={`text-gray-500 mt-1 ${layout <= 2 ? 'text-xs' : 'text-xs'} line-clamp-2`}>{bin.description}</p>
          )}
        </div>
        <div className="shrink-0">
          <QRCodeSVG value={qrUrl} size={qrSize} />
        </div>
      </div>
    </div>
  )
}

export default function LabelsPage() {
  const { bins } = useBins()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [layout, setLayout] = useState<Layout>(2)
  const [showPreview, setShowPreview] = useState(false)

  const toggleBin = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(bins.map(b => b.id)))
  const deselectAll = () => setSelected(new Set())

  const selectedBins = bins.filter(b => selected.has(b.id))

  const colsClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  }[layout]

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">Labels</h1>
          <p className="text-muted-foreground text-sm mt-1">Select bins to print labels</p>
        </div>
        <Button onClick={() => setShowPreview(true)} disabled={selected.size === 0}>
          <Printer className="h-4 w-4" /> Print ({selected.size})
        </Button>
      </div>

      {/* Select controls */}
      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={selectAll}>Select all</Button>
        <Button variant="outline" size="sm" onClick={deselectAll}>Deselect all</Button>
      </div>

      {bins.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No bins to print labels for</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bins.map(bin => (
            <label key={bin.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${selected.has(bin.id) ? 'border-primary/50 bg-primary/5' : 'bg-card hover:bg-accent'}`}>
              <Checkbox checked={selected.has(bin.id)} onCheckedChange={() => toggleBin(bin.id)} />
              <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: bin.color }} />
              <span className="font-mono text-xs text-muted-foreground">#{formatBinNumber(bin.binNumber)}</span>
              <span className="text-sm font-medium flex-1">{bin.name}</span>
              {bin.location && <span className="text-xs text-muted-foreground hidden sm:block">{bin.location}</span>}
            </label>
          ))}
        </div>
      )}

      {/* Print preview modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 no-print">
          <div className="bg-card rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-display font-bold text-lg">Print Preview</h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Per page:</span>
                  <div className="flex gap-1">
                    {LAYOUTS.map(l => (
                      <button
                        key={l}
                        onClick={() => setLayout(l)}
                        className={`h-8 w-8 rounded-md text-sm font-medium transition-colors ${layout === l ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <Button onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print
                </Button>
                <button onClick={() => setShowPreview(false)} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
              </div>
            </div>
            <div className="overflow-y-auto p-5 flex-1">
              <div className={`grid ${colsClass} gap-3`}>
                {selectedBins.map(bin => (
                  <LabelCard key={bin.id} bin={bin} layout={layout} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print-only content */}
      <div className="hidden print:block">
        <div className={`grid ${colsClass} gap-3`}>
          {selectedBins.map(bin => (
            <LabelCard key={bin.id} bin={bin} layout={layout} />
          ))}
        </div>
      </div>
    </div>
  )
}
