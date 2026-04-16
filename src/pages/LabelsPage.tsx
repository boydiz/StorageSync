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

const PAGE_W = 7.5   // usable inches (8.5 - 1in margins)
const PAGE_H = 10    // usable inches (11 - 1in margins)
const GAP    = 0.12  // gap between labels in inches

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

const SIZES: Record<Layout, { name: string; num: string; desc: string; stripe: string; pad: string }> = {
  1: { name: '3.2rem',  num: '2.0rem',  desc: '1rem',    stripe: '20px', pad: '1rem'   },
  2: { name: '2.4rem',  num: '1.6rem',  desc: '0.85rem', stripe: '16px', pad: '0.85rem'},
  3: { name: '1.6rem',  num: '1.1rem',  desc: '0.75rem', stripe: '12px', pad: '0.65rem'},
  4: { name: '1.7rem',  num: '1.2rem',  desc: '0.7rem',  stripe: '12px', pad: '0.55rem'},
  5: { name: '1.2rem',  num: '0.9rem',  desc: '0.6rem',  stripe: '10px', pad: '0.45rem'},
  6: { name: '1.1rem',  num: '0.85rem', desc: '0.55rem', stripe: '8px',  pad: '0.4rem' },
}

function LabelCard({ bin, layout }: { bin: BinData; layout: Layout }) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const { w, h } = getLabelSize(layout)
  const sz = SIZES[layout]
  const isLayout3 = layout === 3
  const qrIn = layout === 1 ? h*0.60 : layout === 2 ? h*0.52 : layout === 3 ? h*0.74 : layout === 4 ? h*0.50 : h*0.44
  const qrPx = Math.round(qrIn * 96)

  const textBlock = (
    <>
      <div style={{ fontFamily:'monospace', fontSize:sz.num, color:'#374151', fontWeight:700, lineHeight:1 }}>
        #{formatBinNumber(bin.binNumber)}
      </div>
      <div style={{ fontWeight:800, fontSize:sz.name, color:'#111827', lineHeight:1.1, wordBreak:'break-word', marginTop:'3px' }}>
        {bin.name}
      </div>
      {bin.location && <div style={{ fontSize:sz.desc, color:'#6b7280', marginTop:'4px' }}>{bin.location}</div>}
      {bin.description && (
        <div style={{ fontSize:sz.desc, color:'#9ca3af', marginTop:'3px', overflow:'hidden', display:'-webkit-box', WebkitLineClamp: isLayout3 ? 4 : 2, WebkitBoxOrient:'vertical' as const }}>
          {bin.description}
        </div>
      )}
    </>
  )

  return (
    <div style={{ width:`${w}in`, height:`${h}in`, border:'1.5px solid #d1d5db', borderRadius:'10px', overflow:'hidden', backgroundColor:'white', display:'flex', flexDirection:'column', pageBreakInside:'avoid', boxSizing:'border-box' }}>
      <div style={{ height:sz.stripe, backgroundColor:bin.color, flexShrink:0 }} />
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

// Build a static HTML string for the print window (works on desktop + mobile PDF)
function buildPrintHtml(pages: BinData[][], layout: Layout): string {
  const { cols, rows, w, h } = getLabelSize(layout)

  const pagesHtml = pages.map((pageBins, pi) => {
    const labelsHtml = pageBins.map(bin => {
      const qrUrl = `${window.location.origin}/bin/${bin.id}`
      const sz = SIZES[layout]
      const isLayout3 = layout === 3
      const qrIn = layout === 1 ? h*0.60 : layout === 2 ? h*0.52 : layout === 3 ? h*0.74 : layout === 4 ? h*0.50 : h*0.44
      const qrPx = Math.round(qrIn * 96)
      const qrSvg = ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={qrUrl} size={qrPx} />)
      const numStr = String(bin.binNumber).padStart(3, '0')

      const textHtml = `
        <div style="font-family:monospace;font-size:${sz.num};color:#374151;font-weight:700;line-height:1">#${numStr}</div>
        <div style="font-weight:800;font-size:${sz.name};color:#111827;line-height:1.1;word-break:break-word;margin-top:3px">${bin.name}</div>
        ${bin.location ? `<div style="font-size:${sz.desc};color:#6b7280;margin-top:4px">${bin.location}</div>` : ''}
        ${bin.description ? `<div style="font-size:${sz.desc};color:#9ca3af;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${isLayout3?4:2};-webkit-box-orient:vertical">${bin.description}</div>` : ''}
      `
      const innerHtml = isLayout3
        ? `<div style="flex:1;overflow:hidden">${textHtml}</div><div style="flex-shrink:0">${qrSvg}</div>`
        : `<div style="flex-shrink:0">${textHtml}</div><div style="flex:1;display:flex;align-items:center;justify-content:center">${qrSvg}</div>`

      return `<div style="width:${w}in;height:${h}in;border:1.5px solid #d1d5db;border-radius:10px;overflow:hidden;background:white;display:flex;flex-direction:column;page-break-inside:avoid;box-sizing:border-box;">
        <div style="height:${sz.stripe};background:${bin.color};flex-shrink:0"></div>
        <div style="flex:1;display:flex;flex-direction:${isLayout3?'row':'column'};padding:${sz.pad};gap:${isLayout3?'0.6rem':'4px'};overflow:hidden;${isLayout3?'align-items:center':''}">
          ${innerHtml}
        </div>
      </div>`
    }).join('')

    return `<div style="display:grid;grid-template-columns:repeat(${cols},${w}in);grid-template-rows:repeat(${rows},${h}in);gap:${GAP}in;width:${PAGE_W}in;height:${PAGE_H}in;${pi < pages.length-1 ? 'page-break-after:always' : ''}">
      ${labelsHtml}
    </div>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StorageSync Labels</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:white}
    @page{size:letter portrait;margin:0.5in}
    @media print{body{margin:0}}</style>
  </head><body>
    ${pagesHtml}
    <script>window.onload=function(){setTimeout(function(){window.print();},400)}<\/script>
  </body></html>`
}

function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
}

export default function LabelsPage() {
  const { bins } = useBins()
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [layout, setLayout]       = useState<Layout>(2)
  const [showPreview, setShowPreview] = useState(false)
  const [scale, setScale]         = useState(1)
  const containerRef              = useRef<HTMLDivElement>(null)

  const toggleBin = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll   = () => setSelected(new Set(bins.map(b => b.id)))
  const deselectAll = () => setSelected(new Set())

  const selectedBins = bins.filter(b => selected.has(b.id))
  const { cols, rows, perPage, w, h } = getLabelSize(layout)

  const pages: BinData[][] = []
  for (let i = 0; i < selectedBins.length; i += perPage) pages.push(selectedBins.slice(i, i + perPage))

  // Scale page preview to fit available width with some padding
  const calcScale = useCallback(() => {
    const availW = window.innerWidth - 48  // 24px padding each side
    const pageWpx = 8.5 * 96
    setScale(Math.min(1, availW / pageWpx))
  }, [])

  useEffect(() => {
    if (!showPreview) return
    calcScale()
    window.addEventListener('resize', calcScale)
    return () => window.removeEventListener('resize', calcScale)
  }, [showPreview, calcScale])

  const handlePrint = () => {
    const html = buildPrintHtml(pages, layout)
    if (isMobile()) {
      // On mobile: open in same tab as a blob URL — triggers system print/AirPrint/Save PDF
      const blob = new Blob([html], { type: 'text/html' })
      const url  = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } else {
      // Desktop: open new window, auto-print
      const win = window.open('', '_blank', 'width=900,height=700')
      if (win) { win.document.write(html); win.document.close() }
    }
  }

  // Height of a scaled page for correct spacing
  const scaledPageH = 11 * 96 * scale

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
          <span className="hidden sm:inline">Preview & Print</span>
          <span className="sm:hidden">Print</span>
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

          {/* Toolbar */}
          <div style={{ backgroundColor:'#020617', borderBottom:'1px solid #1e293b', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, gap:'8px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
              <span style={{ color:'white', fontWeight:700, fontSize:'13px' }}>Preview</span>
              <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <span style={{ color:'#64748b', fontSize:'11px' }}>Per page:</span>
                <div style={{ display:'flex', gap:'3px' }}>
                  {LAYOUTS.map(l => (
                    <button key={l} onClick={() => setLayout(l)} style={{ width:30, height:30, borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:700, backgroundColor: layout===l ? '#3b82f6' : '#1e293b', color: layout===l ? 'white' : '#64748b' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <span style={{ color:'#334155', fontSize:'11px' }}>{pages.length}p · {selectedBins.length} labels</span>
            </div>
            <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
              <button onClick={handlePrint} style={{ display:'flex', alignItems:'center', gap:'6px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:8, padding:'8px 16px', cursor:'pointer', fontWeight:700, fontSize:13 }}>
                <Printer size={14} />
                <span>{isMobile() ? 'Print / Save PDF' : 'Print'}</span>
              </button>
              <button onClick={() => setShowPreview(false)} style={{ width:34, height:34, borderRadius:8, border:'1px solid #1e293b', backgroundColor:'transparent', color:'#64748b', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scrollable page previews */}
          <div ref={containerRef} style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'24px 24px', display:'flex', flexDirection:'column', alignItems:'center', gap:'24px' }}>
            {pages.map((pageBins, pageIdx) => (
              <div key={pageIdx} style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center' }}>
                <p style={{ color:'#475569', fontSize:'11px', marginBottom:'8px' }}>Page {pageIdx + 1} of {pages.length}</p>
                {/* Wrapper that reserves correct height after scaling */}
                <div style={{ width: `${8.5 * 96 * scale}px`, height: `${scaledPageH}px`, position:'relative' }}>
                  <div style={{ transformOrigin:'top left', transform:`scale(${scale})`, position:'absolute', top:0, left:0 }}>
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
