import { useState } from 'react'
import { Printer, Tag, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { formatBinNumber } from '@/lib/utils'

const LAYOUTS = [1, 2, 3, 4, 5, 6] as const
type Layout = typeof LAYOUTS[number]

// Usable area on US Letter with 0.5in margins: 7.5in x 10in
const USABLE_W = 7.5
const USABLE_H = 10
const GAP = 0.15

const LAYOUT_GRID: Record<Layout, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  3: { cols: 1, rows: 3 },
  4: { cols: 2, rows: 2 },
  5: { cols: 2, rows: 3 },
  6: { cols: 2, rows: 3 },
}

function getLabelSize(layout: Layout) {
  const { cols, rows } = LAYOUT_GRID[layout]
  const w = (USABLE_W - GAP * (cols - 1)) / cols
  const h = (USABLE_H - GAP * (rows - 1)) / rows
  return { w, h, cols, rows, perPage: cols * rows }
}

interface BinType {
  id: string
  binNumber: number
  name: string
  location: string
  description: string
  color: string
}

function LabelCard({ bin, layout }: { bin: BinType; layout: Layout }) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const { w, h } = getLabelSize(layout)

  // QR size: take up roughly half the label height for small, more for large
  const qrIn = layout === 1 ? h * 0.58 : layout === 2 ? h * 0.52 : layout === 3 ? h * 0.5 : h * 0.45
  const qrPx = Math.round(qrIn * 96)

  const titleSize = layout === 1 ? '1.5rem' : layout === 2 ? '1.2rem' : layout === 3 ? '1rem' : '0.8rem'
  const metaSize = layout <= 2 ? '0.8rem' : '0.65rem'
  const stripeH = layout === 1 ? '10px' : layout <= 3 ? '7px' : '5px'
  const pad = layout === 1 ? '0.75rem' : layout <= 3 ? '0.55rem' : '0.4rem'

  return (
    <div style={{
      width: `${w}in`,
      height: `${h}in`,
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      overflow: 'hidden',
      backgroundColor: 'white',
      display: 'flex',
      flexDirection: 'column',
      pageBreakInside: 'avoid',
      boxSizing: 'border-box',
    }}>
      {/* Color stripe */}
      <div style={{ height: stripeH, backgroundColor: bin.color, flexShrink: 0 }} />

      {/* Content */}
      <div style={{ flex: 1, padding: pad, display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: '4px' }}>
        {/* Text block */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontFamily: 'monospace', fontSize: metaSize, color: '#6b7280' }}>
            #{formatBinNumber(bin.binNumber)}
          </div>
          <div style={{ fontWeight: 'bold', fontSize: titleSize, color: '#111827', lineHeight: 1.2, wordBreak: 'break-word' }}>
            {bin.name}
          </div>
          {bin.location && (
            <div style={{ fontSize: metaSize, color: '#6b7280', marginTop: '2px' }}>{bin.location}</div>
          )}
          {bin.description && layout <= 3 && (
            <div style={{ fontSize: '0.6rem', color: '#9ca3af', marginTop: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {bin.description}
            </div>
          )}
        </div>

        {/* QR code centered in remaining space */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <QRCodeSVG value={qrUrl} size={qrPx} />
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
  const { cols, rows, perPage } = getLabelSize(layout)

  // Split into pages
  const pages: BinType[][] = []
  for (let i = 0; i < selectedBins.length; i += perPage) {
    pages.push(selectedBins.slice(i, i + perPage))
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">Labels</h1>
          <p className="text-muted-foreground text-sm mt-1">Select bins to print labels</p>
        </div>
        <Button onClick={() => setShowPreview(true)} disabled={selected.size === 0}>
          <Printer className="h-4 w-4" /> Preview & Print ({selected.size})
        </Button>
      </div>

      {/* Select all / deselect */}
      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={selectAll}>Select all</Button>
        <Button variant="outline" size="sm" onClick={deselectAll}>Deselect all</Button>
      </div>

      {/* Bin list */}
      {bins.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No bins to print labels for</p>
        </div>
      ) : (
        <div className="space-y-2 no-print">
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

      {/* ── SCREEN PREVIEW MODAL ── */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col no-print" style={{ fontFamily: 'sans-serif' }}>
          {/* Fixed toolbar */}
          <div className="bg-card border-b border-border flex items-center justify-between px-5 py-3 shrink-0 shadow-lg z-10">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-semibold text-sm">Print Preview</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Labels per page:</span>
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
              <span className="text-xs text-muted-foreground">{pages.length} page{pages.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => window.print()} size="sm">
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setShowPreview(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Scrollable page previews */}
          <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center gap-8">
            {pages.map((pageBins, pageIdx) => (
              <div key={pageIdx}>
                <p className="text-xs text-gray-400 mb-2 text-center">Page {pageIdx + 1}</p>
                <div style={{
                  width: '8.5in',
                  minHeight: '11in',
                  backgroundColor: 'white',
                  padding: '0.5in',
                  boxSizing: 'border-box',
                  boxShadow: '0 4px 32px rgba(0,0,0,0.4)',
                }}>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, 1fr)`,
                    gridTemplateRows: `repeat(${rows}, 1fr)`,
                    gap: `${GAP}in`,
                    width: '100%',
                    height: `${USABLE_H}in`,
                  }}>
                    {pageBins.map(bin => (
                      <LabelCard key={bin.id} bin={bin} layout={layout} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PRINT OUTPUT (hidden on screen, shown when printing) ── */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #print-output { display: block !important; }
          @page {
            size: letter portrait;
            margin: 0.5in;
          }
        }
      `}</style>

      <div id="print-output" style={{ display: 'none' }}>
        {pages.map((pageBins, pageIdx) => (
          <div
            key={pageIdx}
            style={{
              pageBreakAfter: pageIdx < pages.length - 1 ? 'always' : 'auto',
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
              gap: `${GAP}in`,
              width: `${USABLE_W}in`,
              height: `${USABLE_H}in`,
              boxSizing: 'border-box',
            }}
          >
            {pageBins.map(bin => (
              <LabelCard key={bin.id} bin={bin} layout={layout} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
