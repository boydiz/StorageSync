import { useState, useRef, useEffect, useCallback } from 'react'
import { Printer, Tag, X, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/primitives'
import { formatBinNumber } from '@/lib/utils'
import ReactDOMServer from 'react-dom/server'

// ─── Types ───────────────────────────────────────────────────────────────────

type PrintMode = 'home' | 'thermal' | 'wideformat' | 'custom'

interface HomeSettings {
  labelsPerPage: 1 | 2 | 3 | 4 | 5 | 6
}

interface ThermalSettings {
  labelW: number   // inches
  labelH: number   // inches
  marginH: number  // inches horizontal margin
  marginV: number  // inches vertical margin
}

interface WideFormatSettings {
  rollWidth: number    // inches
  labelW: number       // inches
  labelH: number       // inches
  gap: number          // inches between labels
  maxLength: number    // max strip length in inches
}

interface CustomSettings {
  pageW: number
  pageH: number
  cols: number
  rows: number
  marginH: number
  marginV: number
  gap: number
}

interface BinData {
  id: string; binNumber: number; name: string
  location: string; description: string; color: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_GRID: Record<1|2|3|4|5|6, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 }, 2: { cols: 1, rows: 2 }, 3: { cols: 1, rows: 3 },
  4: { cols: 2, rows: 2 }, 5: { cols: 2, rows: 3 }, 6: { cols: 2, rows: 3 },
}

const THERMAL_PRESETS = [
  { label: '4" × 6"', w: 4, h: 6 },
  { label: '6" × 4"', w: 6, h: 4 },
  { label: '3" × 2"', w: 3, h: 2 },
  { label: '2" × 3"', w: 2, h: 3 },
  { label: '4" × 4"', w: 4, h: 4 },
]

// ─── Label Card (renders a single label) ─────────────────────────────────────

interface LabelCardProps {
  bin: BinData
  w: number   // inches
  h: number   // inches
  isLayout3?: boolean
  compact?: boolean
}

function LabelCard({ bin, w, h, isLayout3 = false, compact = false }: LabelCardProps) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const area = w * h
  const stripeH = area > 20 ? '16px' : area > 8 ? '12px' : area > 4 ? '8px' : '6px'
  const nameSz  = area > 30 ? '3rem'  : area > 15 ? '2.2rem' : area > 8 ? '1.6rem' : area > 4 ? '1.1rem' : '0.85rem'
  const numSz   = area > 30 ? '2rem'  : area > 15 ? '1.5rem' : area > 8 ? '1.1rem' : area > 4 ? '0.85rem': '0.7rem'
  const descSz  = area > 15 ? '0.85rem': area > 8 ? '0.72rem': '0.6rem'
  const pad     = area > 15 ? '0.8rem' : area > 8 ? '0.55rem': area > 4 ? '0.4rem' : '0.3rem'

  const qrFrac  = isLayout3 ? 0.74 : area > 20 ? 0.58 : area > 8 ? 0.50 : 0.42
  const qrPx    = Math.round(qrFrac * Math.min(w, h) * 96)

  const textBlock = (
    <>
      <div style={{ fontFamily:'monospace', fontSize:numSz, color:'#1e293b', fontWeight:900, lineHeight:1, letterSpacing:'-0.01em' }}>
        #{formatBinNumber(bin.binNumber)}
      </div>
      <div style={{ fontWeight:900, fontSize:nameSz, color:'#0f172a', lineHeight:1.1, wordBreak:'break-word', marginTop:'3px' }}>
        {bin.name}
      </div>
      {bin.location && !compact && (
        <div style={{ fontSize:descSz, color:'#475569', marginTop:'4px', fontWeight:500 }}>{bin.location}</div>
      )}
      {bin.description && !compact && area > 8 && (
        <div style={{ fontSize:descSz, color:'#94a3b8', marginTop:'3px', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' as const }}>
          {bin.description}
        </div>
      )}
    </>
  )

  return (
    <div style={{ width:`${w}in`, height:`${h}in`, border:'1.5px solid #cbd5e1', borderRadius:'8px', overflow:'hidden', backgroundColor:'white', display:'flex', flexDirection:'column', pageBreakInside:'avoid', boxSizing:'border-box' }}>
      <div style={{ height:stripeH, backgroundColor:bin.color, flexShrink:0, WebkitPrintColorAdjust:'exact', printColorAdjust:'exact' } as React.CSSProperties} />
      {isLayout3 ? (
        <div style={{ flex:1, display:'flex', flexDirection:'row', padding:pad, gap:'0.5rem', overflow:'hidden', alignItems:'center' }}>
          <div style={{ flex:1, overflow:'hidden' }}>{textBlock}</div>
          <div style={{ flexShrink:0 }}><QRCodeSVG value={qrUrl} size={qrPx} /></div>
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', padding:pad, gap:'3px', overflow:'hidden' }}>
          <div style={{ flexShrink:0 }}>{textBlock}</div>
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <QRCodeSVG value={qrUrl} size={qrPx} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Print HTML Builder ────────────────────────────────────────────────────────

function buildLabelHtml(bin: BinData, w: number, h: number, isLayout3 = false): string {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const area = w * h
  const stripeH = area > 20 ? '16px' : area > 8 ? '12px' : area > 4 ? '8px' : '6px'
  const nameSz  = area > 30 ? '3rem'  : area > 15 ? '2.2rem' : area > 8 ? '1.6rem' : area > 4 ? '1.1rem' : '0.85rem'
  const numSz   = area > 30 ? '2rem'  : area > 15 ? '1.5rem' : area > 8 ? '1.1rem' : area > 4 ? '0.85rem': '0.7rem'
  const descSz  = area > 15 ? '0.85rem': area > 8 ? '0.72rem': '0.6rem'
  const pad     = area > 15 ? '0.8rem' : area > 8 ? '0.55rem': area > 4 ? '0.4rem' : '0.3rem'
  const qrFrac  = isLayout3 ? 0.74 : area > 20 ? 0.58 : area > 8 ? 0.50 : 0.42
  const qrPx    = Math.round(qrFrac * Math.min(w, h) * 96)
  const qrSvg   = ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={qrUrl} size={qrPx} />)
  const numStr  = String(bin.binNumber).padStart(3, '0')

  const textHtml = `
    <div style="font-family:monospace;font-size:${numSz};color:#1e293b;font-weight:900;line-height:1;letter-spacing:-0.01em">#${numStr}</div>
    <div style="font-weight:900;font-size:${nameSz};color:#0f172a;line-height:1.1;word-break:break-word;margin-top:3px">${bin.name}</div>
    ${bin.location ? `<div style="font-size:${descSz};color:#475569;margin-top:4px;font-weight:500">${bin.location}</div>` : ''}
    ${bin.description && area > 8 ? `<div style="font-size:${descSz};color:#94a3b8;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${bin.description}</div>` : ''}
  `

  const inner = isLayout3
    ? `<div style="flex:1;overflow:hidden">${textHtml}</div><div style="flex-shrink:0">${qrSvg}</div>`
    : `<div style="flex-shrink:0">${textHtml}</div><div style="flex:1;display:flex;align-items:center;justify-content:center">${qrSvg}</div>`

  return `<div style="width:${w}in;height:${h}in;border:1.5px solid #cbd5e1;border-radius:8px;overflow:hidden;background:white;display:flex;flex-direction:column;page-break-inside:avoid;box-sizing:border-box;">
    <div style="height:${stripeH};background:${bin.color};flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact"></div>
    <div style="flex:1;display:flex;flex-direction:${isLayout3?'row':'column'};padding:${pad};gap:${isLayout3?'0.5rem':'3px'};overflow:hidden;${isLayout3?'align-items:center':''}">
      ${inner}
    </div>
  </div>`
}

function openPrintWindow(html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, '_blank')
  if (win) setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ─── Home Print Builder ───────────────────────────────────────────────────────

function buildHomePrint(bins: BinData[], lpp: 1|2|3|4|5|6) {
  const { cols, rows } = HOME_GRID[lpp]
  const gap  = 0.12
  const pw   = 7.5; const ph = 10
  const lw   = (pw - gap*(cols-1)) / cols
  const lh   = (ph - gap*(rows-1)) / rows
  const perPage = cols * rows
  const isL3 = lpp === 3

  const pages: BinData[][] = []
  for (let i = 0; i < bins.length; i += perPage) pages.push(bins.slice(i, i+perPage))

  const pagesHtml = pages.map((pg, pi) => `
    <div style="display:grid;grid-template-columns:repeat(${cols},${lw}in);grid-template-rows:repeat(${rows},${lh}in);gap:${gap}in;width:${pw}in;height:${ph}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b => buildLabelHtml(b, lw, lh, isL3)).join('')}
    </div>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StorageSync Labels</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}html,body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:letter portrait;margin:0.5in}</style></head><body>${pagesHtml}
    <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`
}

// ─── Thermal Print Builder ────────────────────────────────────────────────────

function buildThermalPrint(bins: BinData[], lw: number, lh: number, marginH: number, marginV: number) {
  const isLandscape = lw > lh
  const pagesHtml = bins.map((b, i) => `
    <div style="width:${lw}in;height:${lh}in;padding:${marginV}in ${marginH}in;box-sizing:border-box;${i<bins.length-1?'page-break-after:always':''}">
      ${buildLabelHtml(b, lw - marginH*2, lh - marginV*2, isLandscape)}
    </div>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StorageSync Thermal Labels</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}html,body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:${lw}in ${lh}in;margin:0}</style></head><body>${pagesHtml}
    <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`
}

// ─── Wide Format Print Builder ────────────────────────────────────────────────

function buildWideFormatPrint(bins: BinData[], rollW: number, labelW: number, labelH: number, gap: number, maxLen: number) {
  const usableW = rollW - 0.5
  const cols    = Math.floor((usableW + gap) / (labelW + gap))
  const actualGap = cols > 1 ? (usableW - cols * labelW) / (cols - 1) : 0
  const rows    = Math.ceil(bins.length / cols)
  const totalH  = rows * labelH + (rows - 1) * gap
  const stripH  = Math.min(totalH, maxLen)

  const pages: BinData[][] = []
  const perStrip = cols * Math.floor((maxLen + gap) / (labelH + gap))
  for (let i = 0; i < bins.length; i += perStrip) pages.push(bins.slice(i, i+perStrip))

  const pagesHtml = pages.map((pg, pi) => {
    const pgRows  = Math.ceil(pg.length / cols)
    const pgH     = pgRows * labelH + (pgRows - 1) * gap
    return `<div style="width:${usableW}in;height:${pgH}in;display:grid;grid-template-columns:repeat(${cols},${labelW}in);gap:${gap}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b => buildLabelHtml(b, labelW, labelH, false)).join('')}
    </div>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StorageSync Wide Format Labels</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}html,body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:${rollW}in auto;margin:0 0.25in}</style></head><body>${pagesHtml}
    <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`
}

// ─── Custom Print Builder ─────────────────────────────────────────────────────

function buildCustomPrint(bins: BinData[], s: CustomSettings) {
  const lw = (s.pageW - s.marginH*2 - s.gap*(s.cols-1)) / s.cols
  const lh = (s.pageH - s.marginV*2 - s.gap*(s.rows-1)) / s.rows
  const perPage = s.cols * s.rows
  const pages: BinData[][] = []
  for (let i = 0; i < bins.length; i += perPage) pages.push(bins.slice(i, i+perPage))

  const pagesHtml = pages.map((pg, pi) => `
    <div style="width:${s.pageW - s.marginH*2}in;height:${s.pageH - s.marginV*2}in;display:grid;grid-template-columns:repeat(${s.cols},${lw}in);grid-template-rows:repeat(${s.rows},${lh}in);gap:${s.gap}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b => buildLabelHtml(b, lw, lh)).join('')}
    </div>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StorageSync Custom Labels</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}html,body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:${s.pageW}in ${s.pageH}in;margin:${s.marginV}in ${s.marginH}in}</style></head><body>${pagesHtml}
    <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>`
}

// ─── Num Input ────────────────────────────────────────────────────────────────

function NumInput({ label, value, onChange, min = 0.1, max = 60, step = 0.1, suffix = '"' }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; suffix?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number" min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || min)))}
          className="h-8 text-sm w-24"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LabelsPage() {
  const { bins } = useBins()
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview] = useState(false)
  const [mode, setMode]               = useState<PrintMode>('home')
  const [scale, setScale]             = useState(1)
  const containerRef                  = useRef<HTMLDivElement>(null)

  // Home settings
  const [homeLpp, setHomeLpp] = useState<1|2|3|4|5|6>(2)

  // Thermal settings
  const [thermal, setThermal] = useState<ThermalSettings>({ labelW: 4, labelH: 6, marginH: 0.1, marginV: 0.1 })
  const [thermalPreset, setThermalPreset] = useState(0)

  // Wide format settings
  const [wide, setWide] = useState<WideFormatSettings>({ rollWidth: 12.5, labelW: 4, labelH: 6, gap: 0.3, maxLength: 36 })

  // Custom settings
  const [custom, setCustom] = useState<CustomSettings>({ pageW: 8.5, pageH: 11, cols: 2, rows: 3, marginH: 0.5, marginV: 0.5, gap: 0.15 })

  const [settingsOpen, setSettingsOpen] = useState(true)

  const toggleBin = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll   = () => setSelected(new Set(bins.map(b => b.id)))
  const deselectAll = () => setSelected(new Set())
  const selectedBins = bins.filter(b => selected.has(b.id))

  // Scale preview to fit screen
  const calcScale = useCallback(() => {
    const TOOLBAR = 110
    const PAD     = 48
    let previewW  = 8.5
    if (mode === 'thermal')    previewW = thermal.labelW
    if (mode === 'wideformat') previewW = wide.rollWidth
    if (mode === 'custom')     previewW = custom.pageW

    const availW = window.innerWidth  - 48
    const availH = window.innerHeight - TOOLBAR - PAD
    const pageWpx = previewW * 96
    const pageHpx = (mode === 'thermal' ? thermal.labelH : mode === 'wideformat' ? wide.maxLength : mode === 'custom' ? custom.pageH : 11) * 96
    setScale(Math.min(1, availW / pageWpx, availH / pageHpx))
  }, [mode, thermal, wide, custom])

  useEffect(() => {
    if (!showPreview) return
    calcScale()
    window.addEventListener('resize', calcScale)
    return () => window.removeEventListener('resize', calcScale)
  }, [showPreview, calcScale])

  // Wide format calculation
  const wideUsable = wide.rollWidth - 0.5
  const wideCols   = Math.max(1, Math.floor((wideUsable + wide.gap) / (wide.labelW + wide.gap)))
  const wideActualGap = wideCols > 1 ? (wideUsable - wideCols * wide.labelW) / (wideCols - 1) : 0
  const wideRows   = Math.ceil(selectedBins.length / wideCols)
  const wideStripH = wideRows * wide.labelH + (wideRows - 1) * wide.gap

  // Custom calculation
  const customLw = (custom.pageW - custom.marginH*2 - custom.gap*(custom.cols-1)) / custom.cols
  const customLh = (custom.pageH - custom.marginV*2 - custom.gap*(custom.rows-1)) / custom.rows

  // Home calculation
  const { cols: homeCols, rows: homeRows } = HOME_GRID[homeLpp]
  const homeGap = 0.12
  const homeLw  = (7.5 - homeGap*(homeCols-1)) / homeCols
  const homeLh  = (10  - homeGap*(homeRows-1)) / homeRows

  const handlePrint = () => {
    let html = ''
    if (mode === 'home')       html = buildHomePrint(selectedBins, homeLpp)
    if (mode === 'thermal')    html = buildThermalPrint(selectedBins, thermal.labelW, thermal.labelH, thermal.marginH, thermal.marginV)
    if (mode === 'wideformat') html = buildWideFormatPrint(selectedBins, wide.rollWidth, wide.labelW, wide.labelH, wide.gap, wide.maxLength)
    if (mode === 'custom')     html = buildCustomPrint(selectedBins, custom)
    openPrintWindow(html)
  }

  const MODE_LABELS: Record<PrintMode, string> = {
    home: '🏠 Home Printer',
    thermal: '🖨️ Thermal Printer',
    wideformat: '📏 Wide Format',
    custom: '⚙️ Custom',
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">Labels</h1>
          <p className="text-muted-foreground text-sm mt-1">Select bins and configure print settings</p>
        </div>
        <Button onClick={() => setShowPreview(true)} disabled={selected.size === 0}>
          <Printer className="h-4 w-4" /> Preview & Print ({selected.size})
        </Button>
      </div>

      {/* Print Mode Selector */}
      <div className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {(['home','thermal','wideformat','custom'] as PrintMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors text-left ${mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-accent'}`}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Settings panel */}
        <div className="border border-border rounded-xl overflow-hidden">
          <button onClick={() => setSettingsOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors">
            <span className="text-sm font-medium">Print Settings — {MODE_LABELS[mode]}</span>
            {settingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {settingsOpen && (
            <div className="p-4 space-y-4">

              {/* HOME settings */}
              {mode === 'home' && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Standard 8.5" × 11" US Letter paper</p>
                  <div>
                    <Label className="text-xs mb-2 block">Labels per page</Label>
                    <div className="flex gap-2">
                      {([1,2,3,4,5,6] as const).map(n => (
                        <button key={n} onClick={() => setHomeLpp(n)}
                          className={`w-9 h-9 rounded-lg text-sm font-bold border transition-colors ${homeLpp === n ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card hover:bg-accent'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Label size: {homeLw.toFixed(2)}" × {homeLh.toFixed(2)}" · {homeCols} col{homeCols>1?'s':''} × {homeRows} row{homeRows>1?'s':''}
                  </p>
                </div>
              )}

              {/* THERMAL settings */}
              {mode === 'thermal' && (
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs mb-2 block">Label size presets</Label>
                    <div className="flex flex-wrap gap-2">
                      {THERMAL_PRESETS.map((p, i) => (
                        <button key={i} onClick={() => { setThermalPreset(i); setThermal(t => ({ ...t, labelW: p.w, labelH: p.h })) }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${thermalPreset === i ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card hover:bg-accent'}`}>
                          {p.label}
                        </button>
                      ))}
                      <button onClick={() => setThermalPreset(-1)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${thermalPreset === -1 ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card hover:bg-accent'}`}>
                        Custom
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <NumInput label="Label width"  value={thermal.labelW} onChange={v => setThermal(t => ({...t, labelW: v}))} min={1} max={12} />
                    <NumInput label="Label height" value={thermal.labelH} onChange={v => setThermal(t => ({...t, labelH: v}))} min={1} max={12} />
                    <NumInput label="H margin"     value={thermal.marginH} onChange={v => setThermal(t => ({...t, marginH: v}))} min={0} max={1} step={0.05} />
                    <NumInput label="V margin"     value={thermal.marginV} onChange={v => setThermal(t => ({...t, marginV: v}))} min={0} max={1} step={0.05} />
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" /> One label per sheet · {thermal.labelW > thermal.labelH ? 'Landscape' : 'Portrait'} · {selectedBins.length} sheet{selectedBins.length !== 1 ? 's' : ''} total
                  </p>
                </div>
              )}

              {/* WIDE FORMAT settings */}
              {mode === 'wideformat' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <NumInput label="Roll width"    value={wide.rollWidth} onChange={v => setWide(w => ({...w, rollWidth: v}))} min={4} max={60} step={0.5} />
                    <NumInput label="Label width"   value={wide.labelW}    onChange={v => setWide(w => ({...w, labelW: v}))}    min={1} max={30} step={0.5} />
                    <NumInput label="Label height"  value={wide.labelH}    onChange={v => setWide(w => ({...w, labelH: v}))}    min={1} max={30} step={0.5} />
                    <NumInput label="Gap between"   value={wide.gap}       onChange={v => setWide(w => ({...w, gap: v}))}       min={0.1} max={2} step={0.05} />
                    <NumInput label="Max strip length" value={wide.maxLength} onChange={v => setWide(w => ({...w, maxLength: v}))} min={6} max={120} step={1} suffix='"' />
                  </div>
                  <div className={`rounded-lg px-4 py-3 text-sm ${wideCols < 1 ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                    {wideCols < 1
                      ? '⚠️ Label is wider than the roll! Reduce label width.'
                      : <>✓ <strong>{wideCols}</strong> label{wideCols>1?'s':''} across · actual gap <strong>{wideActualGap.toFixed(3)}"</strong> · strip height <strong>{wideStripH.toFixed(1)}"</strong> for {selectedBins.length} labels</>
                    }
                  </div>
                </div>
              )}

              {/* CUSTOM settings */}
              {mode === 'custom' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <NumInput label="Page width"   value={custom.pageW}   onChange={v => setCustom(c => ({...c, pageW: v}))}   min={2} max={60} step={0.5} />
                    <NumInput label="Page height"  value={custom.pageH}   onChange={v => setCustom(c => ({...c, pageH: v}))}   min={2} max={120} step={0.5} />
                    <NumInput label="Columns"      value={custom.cols}    onChange={v => setCustom(c => ({...c, cols: Math.round(v)}))} min={1} max={20} step={1} suffix="" />
                    <NumInput label="Rows"         value={custom.rows}    onChange={v => setCustom(c => ({...c, rows: Math.round(v)}))} min={1} max={50} step={1} suffix="" />
                    <NumInput label="H margin"     value={custom.marginH} onChange={v => setCustom(c => ({...c, marginH: v}))} min={0} max={3} step={0.05} />
                    <NumInput label="V margin"     value={custom.marginV} onChange={v => setCustom(c => ({...c, marginV: v}))} min={0} max={3} step={0.05} />
                    <NumInput label="Gap"          value={custom.gap}     onChange={v => setCustom(c => ({...c, gap: v}))}     min={0} max={2} step={0.05} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Label size: {customLw > 0 ? customLw.toFixed(2) : '—'}" × {customLh > 0 ? customLh.toFixed(2) : '—'}" · {custom.cols * custom.rows} per page
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
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
              <span style={{ color:'white', fontWeight:700, fontSize:'13px' }}>{MODE_LABELS[mode]} Preview</span>
              {mode === 'home' && (
                <div style={{ display:'flex', gap:'3px' }}>
                  {([1,2,3,4,5,6] as const).map(l => (
                    <button key={l} onClick={() => setHomeLpp(l)} style={{ width:28, height:28, borderRadius:5, border:'none', cursor:'pointer', fontSize:12, fontWeight:700, backgroundColor: homeLpp===l ? '#3b82f6' : '#1e293b', color: homeLpp===l ? 'white' : '#64748b' }}>{l}</button>
                  ))}
                </div>
              )}
              <span style={{ color:'#334155', fontSize:'11px' }}>{selectedBins.length} label{selectedBins.length!==1?'s':''}</span>
              {mode === 'wideformat' && wideCols > 0 && (
                <span style={{ color:'#64748b', fontSize:'11px' }}>{wideCols} across · {wideStripH.toFixed(1)}" long</span>
              )}
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={handlePrint} style={{ display:'flex', alignItems:'center', gap:'6px', backgroundColor:'#3b82f6', color:'white', border:'none', borderRadius:8, padding:'7px 14px', cursor:'pointer', fontWeight:700, fontSize:13 }}>
                <Printer size={14} /> Print / Save PDF
              </button>
              <button onClick={() => setShowPreview(false)} style={{ width:32, height:32, borderRadius:7, border:'1px solid #1e293b', backgroundColor:'transparent', color:'#64748b', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Preview area */}
          <div ref={containerRef} style={{ flex:1, overflowY:'auto', overflowX:'hidden', display:'flex', flexDirection:'column', alignItems:'center', gap:'32px', padding:'24px 0' }}>

            {/* HOME preview */}
            {mode === 'home' && (() => {
              const pages: BinData[][] = []
              const perPage = homeCols * homeRows
              for (let i = 0; i < selectedBins.length; i += perPage) pages.push(selectedBins.slice(i, i+perPage))
              return pages.map((pg, pi) => (
                <div key={pi} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
                  <p style={{ color:'#475569', fontSize:'11px' }}>Page {pi+1} of {pages.length}</p>
                  <div style={{ width:`${8.5*96*scale}px`, height:`${11*96*scale}px`, position:'relative', flexShrink:0 }}>
                    <div style={{ position:'absolute', top:0, left:0, transformOrigin:'top left', transform:`scale(${scale})` }}>
                      <div style={{ width:'8.5in', height:'11in', backgroundColor:'white', padding:'0.5in', boxSizing:'border-box', boxShadow:'0 8px 40px rgba(0,0,0,0.5)', display:'grid', gridTemplateColumns:`repeat(${homeCols},${homeLw}in)`, gridTemplateRows:`repeat(${homeRows},${homeLh}in)`, gap:`${homeGap}in` }}>
                        {pg.map(bin => <LabelCard key={bin.id} bin={bin} w={homeLw} h={homeLh} isLayout3={homeLpp===3} />)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            })()}

            {/* THERMAL preview */}
            {mode === 'thermal' && selectedBins.slice(0, 3).map((bin, i) => (
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
                <p style={{ color:'#475569', fontSize:'11px' }}>Label {i+1} of {selectedBins.length}{i===2 && selectedBins.length>3 ? ' (showing first 3)' : ''}</p>
                <div style={{ width:`${thermal.labelW*96*scale}px`, height:`${thermal.labelH*96*scale}px`, position:'relative', flexShrink:0 }}>
                  <div style={{ position:'absolute', top:0, left:0, transformOrigin:'top left', transform:`scale(${scale})` }}>
                    <div style={{ width:`${thermal.labelW}in`, height:`${thermal.labelH}in`, backgroundColor:'white', padding:`${thermal.marginV}in ${thermal.marginH}in`, boxSizing:'border-box', boxShadow:'0 8px 40px rgba(0,0,0,0.5)' }}>
                      <LabelCard bin={bin} w={thermal.labelW - thermal.marginH*2} h={thermal.labelH - thermal.marginV*2} isLayout3={thermal.labelW > thermal.labelH} />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* WIDE FORMAT preview */}
            {mode === 'wideformat' && wideCols > 0 && (() => {
              const previewH = Math.min(wideStripH, wide.maxLength)
              return (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
                  <p style={{ color:'#475569', fontSize:'11px' }}>Roll preview · {wide.rollWidth}" wide · {wideStripH.toFixed(1)}" long</p>
                  <div style={{ width:`${wide.rollWidth*96*scale}px`, height:`${previewH*96*scale}px`, position:'relative', flexShrink:0 }}>
                    <div style={{ position:'absolute', top:0, left:0, transformOrigin:'top left', transform:`scale(${scale})` }}>
                      <div style={{ width:`${wide.rollWidth}in`, height:`${previewH}in`, backgroundColor:'white', padding:`0 0.25in`, boxSizing:'border-box', boxShadow:'0 8px 40px rgba(0,0,0,0.5)', display:'grid', gridTemplateColumns:`repeat(${wideCols},${wide.labelW}in)`, gap:`${wide.gap}in`, alignContent:'start', paddingTop:'0.1in' }}>
                        {selectedBins.map(bin => <LabelCard key={bin.id} bin={bin} w={wide.labelW} h={wide.labelH} />)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* CUSTOM preview */}
            {mode === 'custom' && customLw > 0 && customLh > 0 && (() => {
              const perPage = custom.cols * custom.rows
              const pages: BinData[][] = []
              for (let i = 0; i < selectedBins.length; i += perPage) pages.push(selectedBins.slice(i, i+perPage))
              return pages.map((pg, pi) => (
                <div key={pi} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
                  <p style={{ color:'#475569', fontSize:'11px' }}>Page {pi+1} of {pages.length}</p>
                  <div style={{ width:`${custom.pageW*96*scale}px`, height:`${custom.pageH*96*scale}px`, position:'relative', flexShrink:0 }}>
                    <div style={{ position:'absolute', top:0, left:0, transformOrigin:'top left', transform:`scale(${scale})` }}>
                      <div style={{ width:`${custom.pageW}in`, height:`${custom.pageH}in`, backgroundColor:'white', padding:`${custom.marginV}in ${custom.marginH}in`, boxSizing:'border-box', boxShadow:'0 8px 40px rgba(0,0,0,0.5)', display:'grid', gridTemplateColumns:`repeat(${custom.cols},${customLw}in)`, gridTemplateRows:`repeat(${custom.rows},${customLh}in)`, gap:`${custom.gap}in` }}>
                        {pg.map(bin => <LabelCard key={bin.id} bin={bin} w={customLw} h={customLh} />)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            })()}

          </div>
        </div>
      )}
    </div>
  )
}
