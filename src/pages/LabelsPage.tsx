import { useState, useEffect } from 'react'
import { Printer, Tag, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { formatBinNumber } from '@/lib/utils'

const LAYOUTS = [1, 2, 3, 4, 5, 6] as const
type Layout = typeof LAYOUTS[number]

// US Letter with 0.5in margins = 7.5 x 10 usable inches
const PAGE_W = 7.5
const PAGE_H = 10
const GAP = 0.12

const GRID: Record<Layout, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  3: { cols: 1, rows: 3 },
  4: { cols: 2, rows: 2 },
  5: { cols: 2, rows: 3 },
  6: { cols: 2, rows: 3 },
}

function getLabelSize(layout: Layout) {
  const { cols, rows } = GRID[layout]
  const w = (PAGE_W - GAP * (cols - 1)) / cols
  const h = (PAGE_H - GAP * (rows - 1)) / rows
  return { w, h, cols, rows, perPage: cols * rows }
}

interface BinData {
  id: string
  binNumber: number
  name: string
  location: string
  description: string
  color: string
}

function LabelCard({ bin, layout }: { bin: BinData; layout: Layout }) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const { w, h } = getLabelSize(layout)
  const isLayout3 = layout === 3

  // Font sizes — keep large and readable
  const nameSize   = layout === 1 ? '2.8rem' : layout === 2 ? '2rem'  : layout === 3 ? '1.6rem' : layout === 4 ? '1.4rem' : '1.1rem'
  const numSize    = layout === 1 ? '1.1rem' : layout === 2 ? '0.9rem': layout === 3 ? '0.85rem': layout === 4 ? '0.8rem' : '0.7rem'
  const descSize   = layout === 1 ? '0.9rem' : layout === 2 ? '0.75rem':layout === 3 ? '0.7rem' : layout === 4 ? '0.65rem': '0.6rem'
  const stripeH    = layout <= 2  ? '14px'   : layout === 3 ? '10px'  : '8px'

  // QR size in pixels (96dpi)
  const qrIn = layout === 1 ? h * 0.62 : layout === 2 ? h * 0.55 : layout === 3 ? h * 0.72 : layout === 4 ? h * 0.52 : h * 0.46
  const qrPx = Math.round(qrIn * 96)

  const pad = layout === 1 ? '1rem' : layout <= 3 ? '0.7rem' : '0.45rem'

  return (
    <div style={{
      width: `${w}in`,
      height: `${h}in`,
      border: '1.5px solid #d1d5db',
      borderRadius: '10px',
      overflow: 'hidden',
      backgroundColor: 'white',
      display: 'flex',
      flexDirection: 'column',
      pageBreakInside: 'avoid',
      boxSizing: 'border-box',
    }}>
      {/* Color stripe */}
      <div style={{ height: stripeH, backgroundColor: bin.color, flexShrink: 0, width: '100%' }} />

      {/* Layout 3: horizontal — text left, QR right */}
      {isLayout3 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: pad, gap: '0.5rem', overflow: 'hidden', alignItems: 'center' }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontFamily: 'monospace', fontSize: numSize, color: '#6b7280', fontWeight: 600 }}>
              #{formatBinNumber(bin.binNumber)}
            </div>
            <div style={{ fontWeight: '800', fontSize: nameSize, color: '#111827', lineHeight: 1.15, wordBreak: 'break-word' }}>
              {bin.name}
            </div>
            {bin.location && (
              <div style={{ fontSize: descSize, color: '#6b7280', marginTop: '4px' }}>{bin.location}</div>
            )}
            {bin.description && (
              <div style={{ fontSize: descSize, color: '#9ca3af', marginTop: '3px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const }}>
                {bin.description}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <QRCodeSVG value={qrUrl} size={qrPx} />
          </div>
        </div>
      ) : (
        /* All other layouts: vertical — text top, QR bottom */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: pad, gap: '6px', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontFamily: 'monospace', fontSize: numSize, color: '#6b7280', fontWeight: 600 }}>
              #{formatBinNumber(bin.binNumber)}
            </div>
            <div style={{ fontWeight: '800', fontSize: nameSize, color: '#111827', lineHeight: 1.15, wordBreak: 'break-word' }}>
              {bin.name}
            </div>
            {bin.location && (
              <div style={{ fontSize: descSize, color: '#6b7280', marginTop: '3px' }}>{bin.location}</div>
            )}
            {bin.description && layout <= 4 && (
              <div style={{ fontSize: descSize, color: '#9ca3af', marginTop: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                {bin.description}
              </div>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <QRCodeSVG value={qrUrl} size={qrPx} />
          </div>
        </div>
      )}
    </div>
  )
}

// Inject print styles once into <head>
function PrintStyles({ layout }: { layout: Layout }) {
  const { cols, rows, perPage, w, h } = getLabelSize(layout)
  useEffect(() => {
    const id = 'storagesync-print-styles'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    el.textContent = `
      @media print {
        @page { size: letter portrait; margin: 0.5in; }
        body > * { display: none !important; }
        #ss-print-root { display: block !important; position: fixed; top: 0; left: 0; width: 100%; }
        .ss-print-page {
          display: grid !important;
          grid-template-columns: repeat(${cols}, ${w}in);
          grid-template-rows: repeat(${rows}, ${h}in);
          gap: ${GAP}in;
          page-break-after: always;
          width: ${PAGE_W}in;
          height: ${PAGE_H}in;
        }
        .ss-print-page:last-child { page-break-after: auto; }
      }
    `
    return () => { if (el) el.textContent = '' }
  }, [cols, rows, perPage, w, h])
  return null
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
  const selectAll   = () => setSelected(new Set(bins.map(b => b.id)))
  const deselectAll = () => setSelected(new Set())

  const selectedBins = bins.filter(b => selected.has(b.id))
  const { cols, rows, perPage, w, h } = getLabelSize(layout)

  const pages: BinData[][] = []
  for (let i = 0; i < selectedBins.length; i += perPage) {
    pages.push(selectedBins.slice(i, i + perPage))
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      <PrintStyles layout={layout} />

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

      {/* Select controls */}
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

      {/* ── FULL-SCREEN PREVIEW MODAL ── */}
      {showPreview && (
        <div
          className="no-print"
          style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: '#1a1a2e', display: 'flex', flexDirection: 'column' }}
        >
          {/* Toolbar */}
          <div style={{ backgroundColor: '#0f0f1a', borderBottom: '1px solid #333', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
              <span style={{ color: 'white', fontWeight: 600, fontSize: '14px' }}>Print Preview</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: '#aaa', fontSize: '12px' }}>Labels per page:</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {LAYOUTS.map(l => (
                    <button
                      key={l}
                      onClick={() => setLayout(l)}
                      style={{
                        width: '32px', height: '32px', borderRadius: '6px', border: 'none',
                        cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                        backgroundColor: layout === l ? '#3b82f6' : '#2a2a3e',
                        color: layout === l ? 'white' : '#aaa',
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <span style={{ color: '#666', fontSize: '12px' }}>{pages.length} page{pages.length !== 1 ? 's' : ''} · {selectedBins.length} label{selectedBins.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => window.print()}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
              >
                <Printer size={15} /> Print
              </button>
              <button
                onClick={() => setShowPreview(false)}
                style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #444', backgroundColor: 'transparent', color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Page previews — scale to fit viewport */}
          <div style={{ flex: 1, overflow: 'auto', padding: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px' }}>
            {pages.map((pageBins, pageIdx) => (
              <div key={pageIdx}>
                <p style={{ color: '#666', fontSize: '11px', textAlign: 'center', marginBottom: '8px' }}>Page {pageIdx + 1} of {pages.length}</p>
                {/* Scale the 8.5x11 page to fit the screen */}
                <div style={{ transformOrigin: 'top center' }}>
                  <div style={{
                    width: '8.5in',
                    height: '11in',
                    backgroundColor: 'white',
                    padding: '0.5in',
                    boxSizing: 'border-box',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, ${w}in)`,
                    gridTemplateRows: `repeat(${rows}, ${h}in)`,
                    gap: `${GAP}in`,
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

      {/* ── PRINT OUTPUT ── hidden on screen, injected for print ── */}
      <div id="ss-print-root" style={{ display: 'none' }}>
        {pages.map((pageBins, pageIdx) => (
          <div key={pageIdx} className="ss-print-page">
            {pageBins.map(bin => (
              <LabelCard key={bin.id} bin={bin} layout={layout} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
