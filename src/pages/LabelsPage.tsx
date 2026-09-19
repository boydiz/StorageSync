import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Printer, Tag, X, ChevronDown, ChevronUp, Scissors, Droplet, Share2, Download, Loader2 } from 'lucide-react'
import { useBins } from '@/hooks/useBins'
import { useItems } from '@/hooks/useItems'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/controls'
import { formatBinNumber } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { PageSvg } from '@/components/labels/PageSvg'
import { loadLabelFonts, type LabelFonts } from '@/lib/labels/fonts'
import { layoutLabel, pickLayout, scanDistanceLabel, type LabelBin } from '@/lib/labels/layout'
import {
  HOME_GRID, WIDE_SHAPES, buildHomePages, buildThermalPages, buildWidePages, buildCustomPages,
  homeLabelSize, wideLabelSize, wideRowsPerSheet, customLabelSize,
  type PageSpec, type WideFormatSettings, type WideShape, type CustomSettings,
} from '@/lib/labels/jobs'

// ─── Types ────────────────────────────────────────────────────────────────────

type PrintMode = 'home' | 'thermal' | 'wideformat' | 'custom'

interface CutContourSettings {
  enabled: boolean
  offset: number      // inches, -0.1 to 0.1
  color: string       // hex (preview + fallback color only)
  swatchName: string  // spot swatch name, e.g. "CutContour"
}

interface BlackInkSettings {
  enabled: boolean
  swatchName: string  // spot swatch name for all black text/QR, e.g. "RVW-BK22A"
}

interface ThermalSettings { labelW: number; labelH: number; marginH: number; marginV: number }

const THERMAL_PRESETS = [
  {label:'4" × 6"',w:4,h:6},{label:'6" × 4"',w:6,h:4},
  {label:'3" × 2"',w:3,h:2},{label:'2" × 3"',w:2,h:3},{label:'4" × 4"',w:4,h:4},
]

const SAMPLE_BIN: LabelBin = {
  id: 'sample', binNumber: 1, name: 'Sample bin', description: 'x', color: '#3b82f6',
  items: ['x'], url: 'https://example.com/bin/sample',
}

// ─── Num Input ────────────────────────────────────────────────────────────────

function NumInput({label,value,onChange,min=0.1,max=60,step=0.1,suffix='"'}:{
  label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;step?:number;suffix?:string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1">
        <Input type="number" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(Math.max(min,Math.min(max,parseFloat(e.target.value)||min)))}
          className="h-8 text-sm w-24"/>
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  )
}

// ─── Wide Format Diagram ──────────────────────────────────────────────────────
// To-scale sketch of one row of labels across the sheet, with the resulting
// label size and an estimated QR scan distance.

function WideFormatDiagram({sheetW,margin,cols,gap,labelW,labelH,qrIn,overflow}:{
  sheetW:number;margin:number;cols:number;gap:number;labelW:number;labelH:number;qrIn:number;overflow:boolean
}) {
  const VW = 300
  const scale = VW / sheetW
  const startX = margin * scale
  const boxW = labelW * scale
  const drawH = Math.max(28, Math.min(labelH * scale, 150))
  const gapPx = gap * scale
  const shown = Math.min(cols, 8)
  const qrPx = Math.max(0, Math.min(qrIn * scale, boxW - 8, drawH - 8))

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <svg width={VW} height={drawH + 4} style={{display:'block',maxWidth:'100%',overflow:'visible'}}>
        <rect x={0.5} y={0.5} width={VW-1} height={drawH+3} fill="none"
          stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" className="text-muted-foreground"/>
        {Array.from({length:shown}).map((_,i)=>{
          const x = startX + i*(boxW+gapPx)
          return (
            <g key={i}>
              <rect x={x} y={2} width={boxW} height={drawH} rx={3}
                style={{fill:'hsl(var(--primary) / 0.10)',stroke:'hsl(var(--primary) / 0.55)'}}/>
              <rect x={x + (boxW-qrPx)/2} y={2 + (drawH-qrPx)/2} width={qrPx} height={qrPx} rx={2}
                style={{fill:'hsl(var(--foreground) / 0.18)'}}/>
            </g>
          )
        })}
        {cols>shown && (
          <text x={VW-4} y={drawH/2} textAnchor="end" dominantBaseline="middle"
            className="fill-muted-foreground" style={{fontSize:11}}>+{cols-shown} more</text>
        )}
      </svg>
      <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Label <strong className="text-foreground">{labelW.toFixed(2)}" × {labelH.toFixed(2)}"</strong></span>
        {qrIn>0 && <span>QR ≈ <strong className="text-foreground">{qrIn.toFixed(1)}"</strong> → scans {scanDistanceLabel(qrIn)}</span>}
        {overflow && <span className="text-destructive font-medium">Too many across — reduce count or gap</span>}
      </div>
    </div>
  )
}

// ─── Cut Contour Panel ────────────────────────────────────────────────────────

function CutContourPanel({cut,setCut}:{cut:CutContourSettings;setCut:(c:CutContourSettings)=>void}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden mt-3">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground"/>
          <span className="text-sm font-medium">Cut Contour</span>
          {cut.enabled && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">ON</span>
          )}
        </div>
        <Switch checked={cut.enabled} onCheckedChange={v=>setCut({...cut,enabled:v})}/>
      </div>

      {cut.enabled && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Offset */}
            <div className="space-y-1">
              <Label className="text-xs">Offset</Label>
              <div className="flex items-center gap-1">
                <Input type="number" min={-0.1} max={0.1} step={0.01} value={cut.offset}
                  onChange={e=>setCut({...cut,offset:Math.max(-0.1,Math.min(0.1,parseFloat(e.target.value)||0))})}
                  className="h-8 text-sm w-24"/>
                <span className="text-xs text-muted-foreground">"</span>
              </div>
              <p className="text-xs text-muted-foreground">{cut.offset>0?`+${cut.offset.toFixed(3)}" outside`:cut.offset<0?`${cut.offset.toFixed(3)}" inside`:'On label edge'}</p>
            </div>

            {/* Color */}
            <div className="space-y-1">
              <Label className="text-xs">Preview color</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={cut.color}
                  onChange={e=>setCut({...cut,color:e.target.value})}
                  className="h-8 w-12 rounded border border-input cursor-pointer"/>
                <span className="text-xs font-mono text-muted-foreground">{cut.color}</span>
              </div>
            </div>

            {/* Swatch name */}
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Swatch / spot color name</Label>
              <Input value={cut.swatchName}
                onChange={e=>setCut({...cut,swatchName:e.target.value})}
                className="h-8 text-sm"
                placeholder="CutContour"/>
              <p className="text-xs text-muted-foreground">Must match your RIP software's cut layer name</p>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              The cut line is a solid 0.02" stroke in a spot swatch with this name. Common names — <span className="font-mono">CutContour</span> (Onyx, Caldera, VersaWorks), <span className="font-mono">Die Cut</span> (Illustrator), <span className="font-mono">RDG_WHITE</span> (Roland). Check your printer software docs.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Print Black Panel ────────────────────────────────────────────────────────

function BlackInkPanel({black,setBlack}:{black:BlackInkSettings;setBlack:(b:BlackInkSettings)=>void}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <Droplet className="h-4 w-4 text-muted-foreground"/>
          <span className="text-sm font-medium">Print black (spot color)</span>
          {black.enabled && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">ON</span>
          )}
        </div>
        <Switch checked={black.enabled} onCheckedChange={v=>setBlack({...black,enabled:v})}/>
      </div>

      {black.enabled && (
        <div className="p-4 space-y-2">
          <Label className="text-xs">Black swatch name</Label>
          <Input value={black.swatchName}
            onChange={e=>setBlack({...black,swatchName:e.target.value})}
            className="h-8 text-sm"
            placeholder="RVW-BK22A"/>
          <p className="text-xs text-muted-foreground">
            All black text and QR codes print in this spot swatch (100%) so the RIP maps it to true rich black. Must match the swatch name in your RIP. Turn off to print standard process black.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LabelsPage() {
  const {bins, setPrinted} = useBins()
  const {items} = useItems()
  const {toast} = useToast()
  const [searchParams] = useSearchParams()

  const [fonts,setFonts] = useState<LabelFonts|null>(null)
  const [fontError,setFontError] = useState(false)
  useEffect(()=>{ loadLabelFonts().then(setFonts).catch(()=>setFontError(true)) },[])

  // item names grouped by bin, for printing the contents list on each label
  const itemsByBin = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const it of items) {
      (map[it.binId] ??= []).push(it.quantity > 1 ? `${it.name} ×${it.quantity}` : it.name)
    }
    return map
  }, [items])
  const [selected,setSelected]       = useState<Set<string>>(() => {
    const preselect = searchParams.get('bin')
    return preselect ? new Set([preselect]) : new Set()
  })
  const [showPreview,setShowPreview] = useState(false)
  const [mode,setMode]               = useState<PrintMode>('home')
  const [settingsOpen,setSettingsOpen] = useState(true)

  const [homeLpp,setHomeLpp]   = useState<1|2|3|4|5|6>(2)
  const [thermal,setThermal]   = useState<ThermalSettings>({labelW:4,labelH:6,marginH:0.1,marginV:0.1})
  const [thermalPreset,setThermalPreset] = useState(0)
  const [wide,setWide]         = useState<WideFormatSettings>({
    sheetW:12.5, sheetLen:30, colsAcross:3, gap:0.3, margin:0.25, shape:'qr', autoFit:true
  })
  const [custom,setCustom]     = useState<CustomSettings>({pageW:8.5,pageH:11,cols:2,rows:3,marginH:0.5,marginV:0.5,gap:0.15})
  const [cut,setCut]           = useState<CutContourSettings>({enabled:false,offset:0.05,color:'#FF00CC',swatchName:'CutContour'})
  const [black,setBlack]       = useState<BlackInkSettings>({enabled:true,swatchName:'RVW-BK22A'})
  const [outlineText,setOutlineText] = useState(false)

  const updateWide = (updates: Partial<WideFormatSettings>) => setWide(prev => ({...prev,...updates}))

  const [printFilter,setPrintFilter] = useState<'all'|'todo'|'done'>('all')
  const printedCount = bins.filter(b=>b.printedAt).length
  const visibleBins = useMemo(
    ()=>bins.filter(b=>printFilter==='all' ? true : printFilter==='done' ? !!b.printedAt : !b.printedAt),
    [bins, printFilter],
  )

  const toggleBin   = (id:string) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
  const selectAll   = () => setSelected(new Set(visibleBins.map(b=>b.id)))
  const selectUnprinted = () => setSelected(new Set(bins.filter(b=>!b.printedAt).map(b=>b.id)))
  const deselectAll = () => setSelected(new Set())

  const printedError = () => toast("Couldn't save printed status — the database update (migration 005) may not be applied yet", 'error')
  const markPrinted = async (ids: string[]) => {
    try {
      await setPrinted.mutateAsync({ids, printed:true})
      toast(`${ids.length} label${ids.length!==1?'s':''} marked as printed`)
    } catch { printedError() }
  }
  const togglePrinted = (id: string, printed: boolean) =>
    setPrinted.mutate({ids:[id], printed}, { onError: printedError })
  const selectedBins: LabelBin[] = useMemo(() => bins.filter(b=>selected.has(b.id)).map(b => ({
    id: b.id, binNumber: b.binNumber, name: b.name,
    description: b.description, color: b.color,
    items: itemsByBin[b.id] ?? [],
    url: `${window.location.origin}/bin/${b.id}`,
  })), [bins, selected, itemsByBin])

  // Derived sizes for the settings panels
  const home = homeLabelSize(homeLpp)
  const wideSize = wideLabelSize(wide)
  const wideRowsPer = wideRowsPerSheet(wide.sheetLen, wideSize.h, wide.gap, wide.margin)
  const customSize = customLabelSize(custom)
  const wideQrIn = useMemo(() => {
    if (!fonts) return 0
    const s = wideLabelSize(wide)
    return layoutLabel(SAMPLE_BIN, s.w, s.h, pickLayout(s.w, s.h), fonts.measurer).qrSize
  }, [fonts, wide])

  // The pages both the preview and the PDF are built from
  const pages: PageSpec[] = useMemo(() => {
    if (mode==='home')    return buildHomePages(selectedBins, homeLpp)
    if (mode==='thermal') return buildThermalPages(selectedBins, thermal.labelW, thermal.labelH, thermal.marginH, thermal.marginV)
    if (mode==='wideformat') return wideLabelSize(wide).overflow ? [] : buildWidePages(selectedBins, wide)
    const cs = customLabelSize(custom)
    return cs.w > 0 && cs.h > 0 ? buildCustomPages(selectedBins, custom) : []
  }, [mode, selectedBins, homeLpp, thermal, wide, custom])

  const spotBlack = mode === 'wideformat' && black.enabled

  // Build the PDF whenever the preview is open, so Share/Download act instantly on tap
  const [pdf,setPdf] = useState<{blob:Blob|null;building:boolean;error:string}>({blob:null,building:false,error:''})
  useEffect(()=>{
    if (!showPreview) {
      setPdf(p=>p.blob===null&&!p.building&&!p.error ? p : {blob:null,building:false,error:''})
      return
    }
    if (!fonts || pages.length===0) return
    let cancelled = false
    setPdf(p=>p.building&&!p.error ? p : {...p,building:true,error:''})
    const t = setTimeout(async ()=>{
      try {
        const { buildPdf } = await import('@/lib/labels/pdf')
        const bytes = await buildPdf(pages, fonts, { cut, black: { spot: spotBlack, swatchName: black.swatchName }, outlineText })
        if (!cancelled) setPdf({blob:new Blob([bytes as BlobPart],{type:'application/pdf'}),building:false,error:''})
      } catch (err) {
        console.error('PDF build failed', err)
        if (!cancelled) setPdf({blob:null,building:false,error:'Could not build the PDF'})
      }
    },150)
    return ()=>{ cancelled = true; clearTimeout(t) }
  },[showPreview, fonts, pages, cut, black.swatchName, spotBlack, outlineText])

  const fileName = `StorageSync-labels-${new Date().toISOString().slice(0,10)}.pdf`

  const canShareFiles = useMemo(()=>{
    try {
      return typeof navigator.canShare==='function'
        && window.matchMedia('(pointer: coarse)').matches
        && navigator.canShare({files:[new File([''],'x.pdf',{type:'application/pdf'})]})
    } catch { return false }
  },[])

  const download = () => {
    if (!pdf.blob) return
    const url = URL.createObjectURL(pdf.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(()=>URL.revokeObjectURL(url),60000)
    toast(`Saved ${fileName} — check your Downloads folder`)
    void markPrinted(selectedBins.map(b=>b.id))
  }

  const share = async () => {
    if (!pdf.blob) return
    const file = new File([pdf.blob], fileName, {type:'application/pdf'})
    try {
      await navigator.share({files:[file], title:'StorageSync labels'})
      void markPrinted(selectedBins.map(b=>b.id))
    } catch (err) {
      if (err instanceof DOMException && err.name==='AbortError') return
      download()
    }
  }

  const MODE_LABELS:Record<PrintMode,string>={
    home:'🏠 Home Printer', thermal:'🖨️ Thermal', wideformat:'📏 Wide Format', custom:'⚙️ Custom'
  }

  const previewPages = mode==='thermal' ? pages.slice(0,3) : pages
  const wideHeights = mode==='wideformat' ? pages.map(p=>p.h) : []

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">Labels</h1>
          <p className="text-muted-foreground text-sm mt-1">Select bins and configure print settings</p>
        </div>
        <Button onClick={()=>setShowPreview(true)} disabled={selected.size===0 || !fonts}>
          {fonts || fontError ? <Printer className="h-4 w-4"/> : <Loader2 className="h-4 w-4 animate-spin"/>} Preview & Print ({selected.size})
        </Button>
      </div>
      {fontError && <p className="text-sm text-destructive mb-4">Couldn't load label fonts. Reload the page to try again.</p>}

      {/* Mode tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {(['home','thermal','wideformat','custom'] as PrintMode[]).map(m=>(
          <button key={m} onClick={()=>setMode(m)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors text-left ${mode===m?'border-primary bg-primary/10 text-primary':'border-border bg-card text-muted-foreground hover:bg-accent'}`}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Settings panel */}
      <div className="border border-border rounded-xl overflow-hidden mb-4">
        <button onClick={()=>setSettingsOpen(v=>!v)} className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors">
          <span className="text-sm font-medium">Print Settings — {MODE_LABELS[mode]}</span>
          {settingsOpen?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}
        </button>

        {settingsOpen && (
          <div className="p-4 space-y-4">

            {/* HOME */}
            {mode==='home' && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Standard 8.5" × 11" US Letter</p>
                <div>
                  <Label className="text-xs mb-2 block">Labels per page</Label>
                  <div className="flex gap-2">
                    {([1,2,3,4,5,6] as const).map(n=>(
                      <button key={n} onClick={()=>setHomeLpp(n)}
                        className={`w-9 h-9 rounded-lg text-sm font-bold border transition-colors ${homeLpp===n?'bg-primary text-primary-foreground border-primary':'border-border bg-card hover:bg-accent'}`}>{n}</button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Label size: {home.w.toFixed(2)}" × {home.h.toFixed(2)}"</p>
              </div>
            )}

            {/* THERMAL */}
            {mode==='thermal' && (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs mb-2 block">Presets</Label>
                  <div className="flex flex-wrap gap-2">
                    {THERMAL_PRESETS.map((p,i)=>(
                      <button key={i} onClick={()=>{setThermalPreset(i);setThermal(t=>({...t,labelW:p.w,labelH:p.h}))}}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${thermalPreset===i?'bg-primary text-primary-foreground border-primary':'border-border bg-card hover:bg-accent'}`}>
                        {p.label}
                      </button>
                    ))}
                    <button onClick={()=>setThermalPreset(-1)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${thermalPreset===-1?'bg-primary text-primary-foreground border-primary':'border-border bg-card hover:bg-accent'}`}>
                      Custom
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <NumInput label="Width"    value={thermal.labelW}  onChange={v=>setThermal(t=>({...t,labelW:v}))}  min={1} max={12}/>
                  <NumInput label="Height"   value={thermal.labelH}  onChange={v=>setThermal(t=>({...t,labelH:v}))}  min={1} max={12}/>
                  <NumInput label="H margin" value={thermal.marginH} onChange={v=>setThermal(t=>({...t,marginH:v}))} min={0} max={1} step={0.05}/>
                  <NumInput label="V margin" value={thermal.marginV} onChange={v=>setThermal(t=>({...t,marginV:v}))} min={0} max={1} step={0.05}/>
                </div>
                <p className="text-xs text-muted-foreground">1 label per sheet · {thermal.labelW>thermal.labelH?'Landscape':'Portrait'} · {selectedBins.length} sheet{selectedBins.length!==1?'s':''}</p>
              </div>
            )}

            {/* WIDE FORMAT */}
            {mode==='wideformat' && (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs mb-2 block">Label shape</Label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(WIDE_SHAPES) as WideShape[]).map(s=>(
                      <button key={s} onClick={()=>updateWide({shape:s})}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${wide.shape===s?'bg-primary text-primary-foreground border-primary':'border-border bg-card hover:bg-accent'}`}>
                        {WIDE_SHAPES[s].label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">{WIDE_SHAPES[wide.shape].hint}. Label width fills the sheet; height is locked to this shape.</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <NumInput label="Sheet width"      value={wide.sheetW}     onChange={v=>updateWide({sheetW:v})}     min={4} max={64} step={0.5}/>
                  <NumInput label="Sheet length (max)" value={wide.sheetLen} onChange={v=>updateWide({sheetLen:v})}   min={6} max={120} step={1}/>
                  <NumInput label="Labels across"    value={wide.colsAcross} onChange={v=>updateWide({colsAcross:Math.max(1,Math.round(v))})} min={1} max={30} step={1} suffix=""/>
                  <NumInput label="Gap between"      value={wide.gap}        onChange={v=>updateWide({gap:v})}        min={0.1} max={2} step={0.05}/>
                  <NumInput label="Sheet margin"     value={wide.margin}     onChange={v=>updateWide({margin:v})}     min={0} max={3} step={0.05}/>
                </div>

                <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <span className="text-sm font-medium">Auto-fit sheet length</span>
                    <p className="text-xs text-muted-foreground">Trim each sheet to its last row — no blank tail. Off = every sheet is the full max length.</p>
                  </div>
                  <Switch checked={wide.autoFit} onCheckedChange={v=>updateWide({autoFit:v})}/>
                </label>

                <WideFormatDiagram
                  sheetW={wide.sheetW} margin={wide.margin} cols={wide.colsAcross} gap={wide.gap}
                  labelW={wideSize.w} labelH={wideSize.h} qrIn={wideQrIn} overflow={wideSize.overflow}
                />

                {selectedBins.length>0 && !wideSize.overflow && (
                  <p className="text-xs text-muted-foreground">
                    {pages.length} sheet{pages.length!==1?'s':''} · {wide.colsAcross} × {wideRowsPer} labels per sheet ·
                    {wide.autoFit && wideHeights.length>0
                      ? <> last sheet ≈ <strong className="text-foreground">{Math.max(...wideHeights).toFixed(1)}"</strong> tall</>
                      : <> {wide.sheetLen}" per sheet</>}
                  </p>
                )}

                <BlackInkPanel black={black} setBlack={setBlack}/>
              </div>
            )}

            {/* CUSTOM */}
            {mode==='custom' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <NumInput label="Page width"  value={custom.pageW}   onChange={v=>setCustom(c=>({...c,pageW:v}))}  min={2} max={60} step={0.5}/>
                  <NumInput label="Page height" value={custom.pageH}   onChange={v=>setCustom(c=>({...c,pageH:v}))}  min={2} max={120} step={0.5}/>
                  <NumInput label="Columns"     value={custom.cols}    onChange={v=>setCustom(c=>({...c,cols:Math.round(v)}))} min={1} max={20} step={1} suffix=""/>
                  <NumInput label="Rows"        value={custom.rows}    onChange={v=>setCustom(c=>({...c,rows:Math.round(v)}))} min={1} max={50} step={1} suffix=""/>
                  <NumInput label="H margin"    value={custom.marginH} onChange={v=>setCustom(c=>({...c,marginH:v}))} min={0} max={3} step={0.05}/>
                  <NumInput label="V margin"    value={custom.marginV} onChange={v=>setCustom(c=>({...c,marginV:v}))} min={0} max={3} step={0.05}/>
                  <NumInput label="Gap"         value={custom.gap}     onChange={v=>setCustom(c=>({...c,gap:v}))}     min={0} max={2} step={0.05}/>
                </div>
                {customSize.w>0&&customSize.h>0&&<p className="text-xs text-muted-foreground">Label size: {customSize.w.toFixed(2)}" × {customSize.h.toFixed(2)}" · {custom.cols*custom.rows} per page</p>}
              </div>
            )}

            {/* CUT CONTOUR — available for all modes */}
            <CutContourPanel cut={cut} setCut={setCut}/>

            <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <span className="text-sm font-medium">Outline text</span>
                <p className="text-xs text-muted-foreground">Off: live text in Arial (already on your PC — nothing to install). On: converts all text to shapes so no fonts are needed at all, but it can't be edited afterward.</p>
              </div>
              <Switch checked={outlineText} onCheckedChange={setOutlineText}/>
            </label>
          </div>
        )}
      </div>

      {/* Bin select controls */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Button variant="outline" size="sm" onClick={selectAll}>Select all</Button>
        <Button variant="outline" size="sm" onClick={selectUnprinted}>Select not printed</Button>
        <Button variant="outline" size="sm" onClick={deselectAll}>Deselect all</Button>
      </div>

      {/* Printed filter */}
      <div className="flex flex-wrap gap-2 mb-1.5">
        {([
          ['all',  `All (${bins.length})`],
          ['todo', `Not printed (${bins.length-printedCount})`],
          ['done', `Printed (${printedCount})`],
        ] as const).map(([key,label])=>(
          <button key={key} onClick={()=>setPrintFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${printFilter===key?'bg-primary text-primary-foreground border-primary':'border-border bg-card text-muted-foreground hover:bg-accent'}`}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mb-4">Labels are marked printed automatically when you save or share the PDF. Use the Printed checkbox on the right of each bin to mark or unmark it yourself.</p>

      {/* Bin list */}
      {bins.length===0?(
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-40"/>
          <p className="text-sm">No bins to print labels for</p>
        </div>
      ):(
        <div className="space-y-2">
          {visibleBins.length===0&&(
            <p className="text-center text-sm text-muted-foreground py-8 border border-dashed rounded-xl">No bins match this filter</p>
          )}
          {visibleBins.map(bin=>(
            <label key={bin.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${selected.has(bin.id)?'border-primary/50 bg-primary/5':'bg-card hover:bg-accent'}`}>
              <Checkbox checked={selected.has(bin.id)} onCheckedChange={()=>toggleBin(bin.id)}/>
              <div className="h-3 w-3 rounded-full shrink-0" style={{backgroundColor:bin.color}}/>
              <span className="font-mono text-sm font-bold">#{formatBinNumber(bin.binNumber)}</span>
              <span className="text-sm font-medium flex-1">{bin.name}</span>
              {bin.location&&<span className="text-xs text-muted-foreground hidden sm:block">{bin.location}</span>}
              {/* Printed checkbox — separate from the selection checkbox on the left */}
              <span onClick={e=>{e.preventDefault();e.stopPropagation()}}
                className={`shrink-0 flex items-center gap-1.5 border-l border-border pl-3 text-[11px] font-medium ${bin.printedAt?'text-green-500':'text-muted-foreground'}`}>
                <Checkbox checked={!!bin.printedAt} aria-label={`Bin ${formatBinNumber(bin.binNumber)} printed`}
                  onCheckedChange={v=>togglePrinted(bin.id, v===true)}/>
                <span className="leading-tight">
                  Printed
                  {bin.printedAt&&<span className="block text-[10px] opacity-80">{new Date(bin.printedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {/* FULL-SCREEN PREVIEW */}
      {showPreview&&(
        <div style={{position:'fixed',inset:0,zIndex:9999,backgroundColor:'#0f172a',display:'flex',flexDirection:'column'}}>
          {/* Toolbar */}
          <div style={{backgroundColor:'#020617',borderBottom:'1px solid #1e293b',padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0,gap:'8px',flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
              <span style={{color:'white',fontWeight:700,fontSize:'13px'}}>{MODE_LABELS[mode]}</span>
              {mode==='home'&&(
                <div style={{display:'flex',gap:'3px'}}>
                  {([1,2,3,4,5,6] as const).map(l=>(
                    <button key={l} onClick={()=>setHomeLpp(l)} style={{width:28,height:28,borderRadius:5,border:'none',cursor:'pointer',fontSize:12,fontWeight:700,backgroundColor:homeLpp===l?'#3b82f6':'#1e293b',color:homeLpp===l?'white':'#64748b'}}>{l}</button>
                  ))}
                </div>
              )}
              {cut.enabled&&<span style={{fontSize:'11px',color:'#f59e0b',display:'flex',alignItems:'center',gap:'4px'}}><Scissors size={12}/> Cut: {cut.swatchName}</span>}
              {spotBlack&&<span style={{fontSize:'11px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'4px'}}><Droplet size={12}/> Black: {black.swatchName}</span>}
              <span style={{color:'#64748b',fontSize:'11px'}}>{selectedBins.length} label{selectedBins.length!==1?'s':''}</span>
            </div>
            <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
              {pdf.building&&<span style={{color:'#94a3b8',fontSize:12,display:'flex',alignItems:'center',gap:6}}><Loader2 size={13} className="animate-spin"/> Preparing PDF…</span>}
              {pdf.error&&<span style={{color:'#f87171',fontSize:12}}>{pdf.error}</span>}
              {canShareFiles&&(
                <button onClick={share} disabled={!pdf.blob||pdf.building} style={{display:'flex',alignItems:'center',gap:'6px',backgroundColor:'#3b82f6',color:'white',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:700,fontSize:13,opacity:!pdf.blob||pdf.building?0.5:1}}>
                  <Share2 size={14}/> Share / Email PDF
                </button>
              )}
              <button onClick={download} disabled={!pdf.blob||pdf.building} style={{display:'flex',alignItems:'center',gap:'6px',backgroundColor:canShareFiles?'#1e293b':'#3b82f6',color:'white',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:700,fontSize:13,opacity:!pdf.blob||pdf.building?0.5:1}}>
                <Download size={14}/> {canShareFiles?'Save':'Download PDF'}
              </button>
              <button onClick={()=>setShowPreview(false)} style={{width:32,height:32,borderRadius:7,border:'1px solid #1e293b',backgroundColor:'transparent',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <X size={15}/>
              </button>
            </div>
          </div>

          {/* Preview content */}
          <div style={{flex:1,overflowY:'auto',overflowX:'hidden',display:'flex',flexDirection:'column',alignItems:'center',gap:'32px',padding:'24px 16px'}}>
            {fonts && previewPages.map((pg,i)=>(
              <div key={i} style={{width:'100%',maxWidth:`${pg.w*96}px`,display:'flex',flexDirection:'column',gap:'8px'}}>
                <p style={{color:'#64748b',fontSize:'11px'}}>
                  {mode==='thermal'
                    ? `Label ${i+1}${i===2&&pages.length>3?' (first 3 shown)':''}`
                    : mode==='wideformat'
                      ? `Sheet ${i+1} of ${pages.length} · ${pg.w}" × ${pg.h.toFixed(1)}" · label ${wideSize.w.toFixed(2)}" × ${wideSize.h.toFixed(2)}" (${WIDE_SHAPES[wide.shape].label})`
                      : `Page ${i+1} of ${pages.length}`}
                </p>
                <PageSvg page={pg} measurer={fonts.measurer} cut={cut}/>
              </div>
            ))}
            {mode==='wideformat'&&wideSize.overflow&&<p style={{color:'#f87171',fontSize:13}}>Too many labels across for this sheet width — reduce the count or gap.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
