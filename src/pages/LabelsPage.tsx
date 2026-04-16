import { useState, useRef, useEffect, useCallback } from 'react'
import { Printer, Tag, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { formatBinNumber } from '@/lib/utils'
import ReactDOMServer from 'react-dom/server'

const LAYOUTS = [1, 2, 3, 4, 5, 6] as const
type Layout = typeof LAYOUTS[number]

// US Letter: 8.5 x 11in with 0.5in margins = 7.5 x 10in usable
const PAGE_W = 7.5
const PAGE_H = 10
const GAP    = 0.12

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
  id: string; binNumber: number; name: string
  location: string; description: string; color: string
}

// FIXED sizes per layout — these never change regardless of how many labels
// Stripe is thick on ALL layouts
const SIZES: Record<Layout, { name: string; num: string; desc: string; stripe: string; pad: string; qrFrac: number }> = {
  1: { name: '3.4rem',  num: '2.2rem',  desc: '1.0rem',  stripe: '20px', pad: '1.0rem',  qrFrac: 0.60 },
  2: { name: '2.6rem',  num: '1.8rem',  desc: '0.9rem',  stripe: '18px', pad: '0.85rem', qrFrac: 0.52 },
  3: { name: '1.8rem',  num: '1.3rem',  desc: '0.8rem',  stripe: '16px', pad: '0.7rem',  qrFrac: 0.72 },
  4: { name: '1.8rem',  num: '1.3rem',  desc: '0.75rem', stripe: '16px', pad: '0.6rem',  qrFrac: 0.50 },
  5: { name: '1.4rem',  num: '1.1rem',  desc: '0.7rem',  stripe: '14px', pad: '0.5rem',  qrFrac: 0.46 },
  6: { name: '1.3rem',  num: '1.0rem',  desc: '0.65rem', stripe: '14px', pad: '0.45rem', qrFrac: 0.44 },
}

function LabelCard({ bin, layout }: { bin: BinData; layout: Layout }) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const { w, h } = getLabelSize(layout)
  const sz = SIZES[layout]
  const isLayout3 = layout === 3
  const qrPx = Math.round(sz.qrFrac * h * 96)

  const textBlock = (
    <>
      <div style={{ fontFamily:'monospace', fontSize:sz.num, color:'#1e293b', fontWeight:800, lineHeight:1, letterSpacing:'-0.01em' }}>
        #{formatBinNumber(bin.binNumber)}
      </div>
      <div style={{ fontWeight:900, fontSize:sz.name, color:'#0f172a', lineHeight:1.1, wordBreak:'break-word', marginTop:'4px' }}>
        {bin.name}
      </div>
      {bin.location && (
        <div style={{ fontSize:sz.desc, color:'#475569', marginTop:'5px', fontWeight:500 }}>{bin.location}</div>
      )}
      {bin.description && (
        <div style={{ fontSize:sz.desc, color:'#94a3b8', marginTop:'3px', overflow:'hidden', display:'-webkit-box', WebkitLineClamp: isLayout3 ? 4 : 2, WebkitBoxOrient:'vertical' as const }}>
          {bin.description}
        </div>
      )}
    </>
  )

  return (
    <div style={{
      width:`${w}in`, height:`${h}in`,
      border:'1.5px solid #cbd5e1', borderRadius:'10px',
      overflow:'hidden', backgroundColor:'white',
      display:'flex', flexDirection:'column',
      pageBreakInside:'avoid', boxSizing:'border-box',
    }}>
      {/* Color stripe — always bold */}
      <div style={{ height:sz.stripe, backgroundColor:bin.color, flexShrink:0, width:'100%',
        // Force color printing
        WebkitPrintColorAdjust:'exact', printColorAdjust:'exact', colorAdjust:'exact',
      } as React.CSSProperties} />

      {isLayout3 ? (
        <div style={{ flex:1, display:'flex', flexDirection:'row', padding:sz.pad, gap:'0.6rem', overflow:'hidden', alignItems:'center' }}>
          <div style={{ flex:1, overflow:'hidden' }}>{textBlock}</div>
          <div style={{ flexShrink:0 }}><QRCodeSVG value={qrUrl} size={qrPx} /></div>
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', padding:sz.pad, gap:'4px', overflow:'hidden' }}>
          <div style={{ flexShrink:0 }}>{textBlock}</div>
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <QRCodeSVG value={qrUrl} size={qrPx} />
          </div>
        </div>
      )}
    </div>
  )
}

// Builds a complete print-ready HTML document
function buildPrintHtml(pages: BinData[][], layout: Layout): string {
  const { cols, rows, w, h } = getLabelSize(layout)
  const sz = SIZES[layout]

  const pagesHtml = pages.map((pageBins, pi) => {
    const labelsHtml = pageBins.map(bin => {
      const qrUrl = `${window.location.origin}/bin/${bin.id}`
      const qrPx = Math.round(sz.qrFrac * h * 96)
      const qrSvg = ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={qrUrl} size={qrPx} />)
      const numStr = String(bin.binNumber).padStart(3, '0')
      const isL3 = layout === 3

      const textHtml = `
        <div style="font-family:monospace;font-size:${sz.num};color:#1e293b;font-weight:800;line-height:1;letter-spacing:-0.01em">#${numStr}</div>
        <div style="font-weight:900;font-size:${sz.name};color:#0f172a;line-height:1.1;word-break:break-word;margin-top:4px">${bin.name}</div>
        ${bin.location ? `<div style="font-size:${sz.desc};color:#475569;margin-top:5px;font-weight:500">${bin.location}</div>` : ''}
        ${bin.description ? `<div style="font-size:${sz.desc};color:#94a3b8;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${isL3?4:2};-webkit-box-orient:vertical">${bin.description}</div>` : ''}
      `
      const innerHtml = isL3
        ? `<div style="flex:1;overflow:hidden">${textHtml}</div><div style="flex-shrink:0">${qrSvg}</div>`
        : `<div style="flex-shrink:0">${textHtml}</div><div style="flex:1;display:flex;align-items:center;justify-content:center">${qrSvg}</div>`

      return `
        <div style="width:${w}in;height:${h}in;border:1.5px solid #cbd5e1;border-radius:10px;overflow:hidden;background:white;display:flex;flex-direction:column;page-break-inside:avoid;box-sizing:border-box;">
          <div style="height:${sz.stripe};background-color:${bin.color};flex-shrink:0;width:100%;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;"></div>
          <div style="flex:1;display:flex;flex-direction:${isL3?'row':'column'};padding:${sz.pad};gap:${isL3?'0.6rem':'4px'};overflow:hidden;${isL3?'align-items:center':''}">
            ${innerHtml}
          </div>
        </div>`
    }).join('')

    return `
      <div style="display:grid;grid-template-columns:repeat(${cols},${w}in);grid-template-rows:repeat(${rows},${h}in);gap:${GAP}in;width:${PAGE_W}in;height:${PAGE_H}in;${pi < pages.length-1 ? 'page-break-after:always' : ''}">
        ${labelsHtml}
      </div>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>StorageSync Labels</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    @page { size: letter portrait; margin: 0.5in; }
  </style>
</head>
<body>
  ${pagesHtml}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 500); }<\/script>
</body>
</html>`
}

export default function LabelsPage() {
  const { bins } = useBins()
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [layout, setLayout]           = useState<Layout>(2)
  const [showPreview, setShowPreview] = useState(false)
  const [scale, setScale]             = useState(1)
  const containerRef                  = useRef<HTMLDivElement>(null)

  const toggleBin = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll   = () => setSelected(new Set(bins.map(b => b.id)))
  const deselectAll = () => setSelected(new Set())

  const selectedBins = bins.filter(b => selected.has(b.id))
  const { cols, rows, perPage, w, h } = getLabelSize(layout)

  const pages: BinData[][] = []
  for (let i = 0; i < selectedBins.length; i += perPage) pages.push(selectedBins.slice(i, i + perPage))

  // Scale so the full 8.5x11 page fits in the available area (both width AND height)
  const TOOLBAR_H = 56  // px
  const PADDING   = 48  // px total vertical padding in scroll area

  const calcScale = useCallback(() => {
    const availW = window.innerWidth  - 48   // 24px each side
    const availH = window.innerHeight - TOOLBAR_H - PADDING
    const pageWpx = 8.5 * 96
    const pageHpx = 11  * 96
    const scaleW  = availW / pageWpx
    const scaleH  = availH / pageHpx
    // Use the smaller of the two so the full page always fits without scrolling
    setScale(Math.min(1, scaleW, scaleH))
  }, [])

  useEffect(() => {
    if (!showPreview) return
    calcScale()
    window.addEventListener('resize', calcScale)
    return () => window.removeEventListener('resize', calcScale)
  }, [showPreview, calcScale])

  const handlePrint = () => {
    const html = buildPrintHtml(pages, layout)
    const blob = new Blob([html], { type: 'text/html' })
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, '_blank')
    // Revoke after a delay to allow load
    if (win) setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const scaledPageW = Math.round(8.5 * 96 * scale)
  const scaledPageH = Math.round(11  * 96 * scale)

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">Labels</h1>
          <p className="text-muted-foreground text-sm mt-1">Select bins to print labels</p>
        </div>
        <Button onClick={() => setShowPreview(true)} disabled={selected.size === 0}>
          <Printer className="h-4 w-4" />
          <span className="hidden sm:inline"> Preview &amp; Print</span>
          <span className="sm:hidden"> Print</span>
          {' '}({selected.size})
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

      {/* FULL-SCREEN PREVIEW */}
      {showPreview && (
        <div style={{ position:'fixed', inset:0, zIndex:9999, backgroundColor:'#0f172a', display:'flex', flexDirection:'column' }}>

          {/* Toolbar — fixed height */}
          <div style={{ height:`${TOOLBAR_H}px`, backgroundColor:'#020617', borderBottom:'1px solid #1e293b', padding:'0 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, gap:'8px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
              <span style={{ color:'white', fontWeight:700, fontSize:'13px' }}>Preview</span>
              <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <span style={{ color:'#64748b', fontSize:'11px' }}>Per page:</span>
                <div style={{ display:'flex', gap:'3px' }}>
                  {LAYOUTS.map(l => (
                    <button key={l} onClick={() => setLayout(l)} style={{ width:28, height:28, borderRadius:5, border:'none', cursor:'pointer', fontSize:12, fontWeight:700, backgroundColor: layout===l ? '#3b82f6' : '#1e293b', color: layout===l ? 'white' : '#64748b' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <span style={{ color:'#334155', fontSize:'11px' }}>{pages.length}p · {selectedBins.length} labels</span>
            </div>
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <button onClick={handlePrint} style={{ display:'flex', alignItems:'center', gap:'6px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:8, padding:'7px 14px', cursor:'pointer', fontWeight:700, fontSize:13 }}>
                <Printer size={14} /> Print / Save PDF
              </button>
              <button onClick={() => setShowPreview(false)} style={{ width:32, height:32, borderRadius:7, border:'1px solid #1e293b', backgroundColor:'transparent', color:'#64748b', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Page previews — one page per screen, scroll between pages */}
          <div ref={containerRef} style={{ flex:1, overflowY:'auto', overflowX:'hidden', display:'flex', flexDirection:'column', alignItems:'center', gap:'32px', padding:'24px 0' }}>
            {pages.map((pageBins, pageIdx) => (
              <div key={pageIdx} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
                <p style={{ color:'#475569', fontSize:'11px' }}>Page {pageIdx + 1} of {pages.length}</p>
                {/* Fixed-size wrapper to prevent layout shift */}
                <div style={{ width:`${scaledPageW}px`, height:`${scaledPageH}px`, position:'relative', flexShrink:0 }}>
                  <div style={{ position:'absolute', top:0, left:0, transformOrigin:'top left', transform:`scale(${scale})` }}>
                    <div style={{
                      width:'8.5in', height:'11in',
                      backgroundColor:'white',
                      padding:'0.5in',
                      boxSizing:'border-box',
                      boxShadow:'0 8px 40px rgba(0,0,0,0.5)',
                      display:'grid',
                      gridTemplateColumns:`repeat(${cols},${w}in)`,
                      gridTemplateRows:`repeat(${rows},${h}in)`,
                      gap:`${GAP}in`,
                    }}>
                      {pageBins.map(bin => <LabelCard key={bin.id} bin={bin} layout={layout} />)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
