import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Printer, Tag, X, ChevronDown, ChevronUp, Scissors } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/controls'
import { Input, Label } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/controls'
import { formatBinNumber } from '@/lib/utils'
import ReactDOMServer from 'react-dom/server'

// ─── Types ────────────────────────────────────────────────────────────────────

type PrintMode = 'home' | 'thermal' | 'wideformat' | 'custom'

interface CutContourSettings {
  enabled: boolean
  offset: number      // inches, -0.1 to 0.1
  color: string       // hex
  swatchName: string  // e.g. "CutContour"
}

interface HomeSettings    { labelsPerPage: 1|2|3|4|5|6 }
interface ThermalSettings { labelW: number; labelH: number; marginH: number; marginV: number }
interface WideFormatSettings {
  rollWidth: number
  colsAcross: number   // user sets this
  gap: number          // user sets this — label width auto-calculated
  labelH: number
  maxLength: number
  // auto-calculated:
  labelW: number
}
interface CustomSettings {
  pageW: number; pageH: number; cols: number; rows: number
  marginH: number; marginV: number; gap: number
}

interface BinData {
  id: string; binNumber: number; name: string
  location: string; description: string; color: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_GRID: Record<1|2|3|4|5|6,{cols:number;rows:number}> = {
  1:{cols:1,rows:1}, 2:{cols:1,rows:2}, 3:{cols:1,rows:3},
  4:{cols:2,rows:2}, 5:{cols:2,rows:3}, 6:{cols:2,rows:3},
}
const THERMAL_PRESETS = [
  {label:'4" × 6"',w:4,h:6},{label:'6" × 4"',w:6,h:4},
  {label:'3" × 2"',w:3,h:2},{label:'2" × 3"',w:2,h:3},{label:'4" × 4"',w:4,h:4},
]

// Auto-calculate label width from roll width, columns, and gap
function calcLabelW(rollWidth: number, cols: number, gap: number): number {
  const usable = rollWidth - 0.5
  return Math.max(0.5, (usable - gap * (cols - 1)) / cols)
}

// ─── HTML/CSS sanitizers for print-window string building ──────────────────────
// Label HTML is assembled by string concatenation and opened as a same-origin
// blob: URL, so any unescaped bin/cut field would execute script in the app's
// origin. Escape everything user-controlled before it goes into markup.

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Colors land in CSS/SVG contexts where HTML-escaping is not enough; only allow
// a hex literal, otherwise fall back to black.
function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value ?? '').trim()) ? value.trim() : '#000000'
}

// ─── Cut Contour SVG Overlay ──────────────────────────────────────────────────
// Returns an SVG element that sits on top of the label as an overlay
// Uses a rounded rectangle with the specified stroke

function CutContourOverlay({
  w, h, cut
}: { w: number; h: number; cut: CutContourSettings }) {
  if (!cut.enabled) return null
  const off    = cut.offset  // can be negative
  const radius = Math.max(0, 10 + off * 96)  // 10px base radius, scale with offset
  const inset  = -off * 96   // positive offset means outside (negative inset)
  const sw     = 1.5

  return (
    <svg
      style={{
        position: 'absolute',
        top: `${inset}px`,
        left: `${inset}px`,
        width: `${w * 96 + Math.abs(inset) * 2}px`,
        height: `${h * 96 + Math.abs(inset) * 2}px`,
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 10,
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x={sw / 2}
        y={sw / 2}
        width={w * 96 + Math.abs(inset) * 2 - sw}
        height={h * 96 + Math.abs(inset) * 2 - sw}
        rx={radius}
        ry={radius}
        fill="none"
        stroke={cut.color}
        strokeWidth={sw}
        strokeDasharray="6 3"
      />
    </svg>
  )
}

// Cut contour SVG string for print HTML
function cutContourSvgStr(w: number, h: number, cut: CutContourSettings): string {
  if (!cut.enabled) return ''
  const off    = cut.offset
  const radius = Math.max(0, 10 + off * 96)
  const inset  = -off * 96
  const sw     = 1.5
  const W      = w * 96 + Math.abs(inset) * 2
  const H      = h * 96 + Math.abs(inset) * 2

  return `<svg xmlns="http://www.w3.org/2000/svg"
    style="position:absolute;top:${inset}px;left:${inset}px;width:${W}px;height:${H}px;pointer-events:none;overflow:visible;z-index:10">
    <title>${escapeHtml(cut.swatchName)}</title>
    <rect x="${sw/2}" y="${sw/2}" width="${W-sw}" height="${H-sw}"
      rx="${radius}" ry="${radius}"
      fill="none" stroke="${safeColor(cut.color)}" stroke-width="${sw}" stroke-dasharray="6 3"/>
  </svg>`
}

// ─── Label Card ────────────────────────────────────────────────────────────────

function LabelCard({ bin, w, h, isLayout3=false, cut }: {
  bin: BinData; w: number; h: number; isLayout3?: boolean; cut: CutContourSettings
}) {
  const qrUrl  = `${window.location.origin}/bin/${bin.id}`
  const area   = w * h
  const stripeH= area>20?'18px':area>8?'13px':area>4?'9px':'7px'
  const nameSz = area>30?'3rem':area>15?'2.2rem':area>8?'1.6rem':area>4?'1.1rem':'0.85rem'
  const numSz  = area>30?'2rem':area>15?'1.5rem':area>8?'1.1rem':area>4?'0.85rem':'0.7rem'
  const descSz = area>15?'0.85rem':area>8?'0.72rem':'0.6rem'
  const pad    = area>15?'0.8rem':area>8?'0.55rem':area>4?'0.4rem':'0.3rem'
  const qrFrac = isLayout3?0.74:area>20?0.58:area>8?0.50:0.42
  const qrPx   = Math.round(qrFrac * Math.min(w,h) * 96)

  const textBlock = (
    <>
      <div style={{fontFamily:'monospace',fontSize:numSz,color:'#1e293b',fontWeight:900,lineHeight:1,letterSpacing:'-0.01em'}}>
        #{formatBinNumber(bin.binNumber)}
      </div>
      <div style={{fontWeight:900,fontSize:nameSz,color:'#0f172a',lineHeight:1.1,wordBreak:'break-word',marginTop:'3px'}}>
        {bin.name}
      </div>
      {bin.location&&<div style={{fontSize:descSz,color:'#475569',marginTop:'4px',fontWeight:500}}>{bin.location}</div>}
      {bin.description&&area>8&&(
        <div style={{fontSize:descSz,color:'#94a3b8',marginTop:'3px',overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical' as const}}>
          {bin.description}
        </div>
      )}
    </>
  )

  return (
    <div style={{width:`${w}in`,height:`${h}in`,border:'1.5px solid #cbd5e1',borderRadius:'8px',overflow:'hidden',backgroundColor:'white',display:'flex',flexDirection:'column',pageBreakInside:'avoid',boxSizing:'border-box',position:'relative'}}>
      <CutContourOverlay w={w} h={h} cut={cut} />
      <div style={{height:stripeH,backgroundColor:bin.color,flexShrink:0,WebkitPrintColorAdjust:'exact',printColorAdjust:'exact'} as React.CSSProperties}/>
      {isLayout3?(
        <div style={{flex:1,display:'flex',flexDirection:'row',padding:pad,gap:'0.5rem',overflow:'hidden',alignItems:'center'}}>
          <div style={{flex:1,overflow:'hidden'}}>{textBlock}</div>
          <div style={{flexShrink:0}}><QRCodeSVG value={qrUrl} size={qrPx}/></div>
        </div>
      ):(
        <div style={{flex:1,display:'flex',flexDirection:'column',padding:pad,gap:'3px',overflow:'hidden'}}>
          <div style={{flexShrink:0}}>{textBlock}</div>
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <QRCodeSVG value={qrUrl} size={qrPx}/>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Print HTML Helpers ───────────────────────────────────────────────────────

function buildLabelHtml(bin: BinData, w: number, h: number, cut: CutContourSettings, isLayout3=false): string {
  const qrUrl  = `${window.location.origin}/bin/${bin.id}`
  const area   = w * h
  const stripeH= area>20?'18px':area>8?'13px':area>4?'9px':'7px'
  const nameSz = area>30?'3rem':area>15?'2.2rem':area>8?'1.6rem':area>4?'1.1rem':'0.85rem'
  const numSz  = area>30?'2rem':area>15?'1.5rem':area>8?'1.1rem':area>4?'0.85rem':'0.7rem'
  const descSz = area>15?'0.85rem':area>8?'0.72rem':'0.6rem'
  const pad    = area>15?'0.8rem':area>8?'0.55rem':area>4?'0.4rem':'0.3rem'
  const qrFrac = isLayout3?0.74:area>20?0.58:area>8?0.50:0.42
  const qrPx   = Math.round(qrFrac * Math.min(w,h) * 96)
  const qrSvg  = ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={qrUrl} size={qrPx}/>)
  const numStr = String(bin.binNumber).padStart(3,'0')
  const stripe = safeColor(bin.color)

  const textHtml = `
    <div style="font-family:monospace;font-size:${numSz};color:#1e293b;font-weight:900;line-height:1;letter-spacing:-0.01em">#${numStr}</div>
    <div style="font-weight:900;font-size:${nameSz};color:#0f172a;line-height:1.1;word-break:break-word;margin-top:3px">${escapeHtml(bin.name)}</div>
    ${bin.location?`<div style="font-size:${descSz};color:#475569;margin-top:4px;font-weight:500">${escapeHtml(bin.location)}</div>`:''}
    ${bin.description&&area>8?`<div style="font-size:${descSz};color:#94a3b8;margin-top:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escapeHtml(bin.description)}</div>`:''}
  `
  const inner = isLayout3
    ? `<div style="flex:1;overflow:hidden">${textHtml}</div><div style="flex-shrink:0">${qrSvg}</div>`
    : `<div style="flex-shrink:0">${textHtml}</div><div style="flex:1;display:flex;align-items:center;justify-content:center">${qrSvg}</div>`

  return `
    <div style="width:${w}in;height:${h}in;border:1.5px solid #cbd5e1;border-radius:8px;overflow:hidden;background:white;display:flex;flex-direction:column;page-break-inside:avoid;box-sizing:border-box;position:relative;">
      ${cutContourSvgStr(w,h,cut)}
      <div style="height:${stripeH};background:${stripe};flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact"></div>
      <div style="flex:1;display:flex;flex-direction:${isLayout3?'row':'column'};padding:${pad};gap:${isLayout3?'0.5rem':'3px'};overflow:hidden;${isLayout3?'align-items:center':''}">
        ${inner}
      </div>
    </div>`
}

function printHtmlWrapper(body: string, pageSize: string, margin: string, cut: CutContourSettings): string {
  const swatchComment = String(cut.swatchName ?? '').replace(/[*/<>]/g, '')
  const swatchCss = cut.enabled
    ? `/* Cut contour swatch: ${swatchComment} = ${safeColor(cut.color)} */\n    .cut-contour { stroke: ${safeColor(cut.color)}; }`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>StorageSync Labels</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    @page{size:${pageSize};margin:${margin}}
    ${swatchCss}
  </style></head><body>
  ${body}
  <script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
  </body></html>`
}

function openPrint(html: string) {
  const blob = new Blob([html],{type:'text/html'})
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url,'_blank')
  if(win) setTimeout(()=>URL.revokeObjectURL(url),10000)
}

function buildHomePrint(bins:BinData[], lpp:1|2|3|4|5|6, cut:CutContourSettings) {
  const {cols,rows}=HOME_GRID[lpp], gap=0.12, pw=7.5, ph=10
  const lw=(pw-gap*(cols-1))/cols, lh=(ph-gap*(rows-1))/rows
  const perPage=cols*rows, isL3=lpp===3
  const pages:BinData[][]=[]
  for(let i=0;i<bins.length;i+=perPage) pages.push(bins.slice(i,i+perPage))
  const body=pages.map((pg,pi)=>`
    <div style="display:grid;grid-template-columns:repeat(${cols},${lw}in);grid-template-rows:repeat(${rows},${lh}in);gap:${gap}in;width:${pw}in;height:${ph}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b=>buildLabelHtml(b,lw,lh,cut,isL3)).join('')}
    </div>`).join('')
  return printHtmlWrapper(body,'letter portrait','0.5in',cut)
}

function buildThermalPrint(bins:BinData[], lw:number, lh:number, mH:number, mV:number, cut:CutContourSettings) {
  const isL=lw>lh
  const body=bins.map((b,i)=>`
    <div style="width:${lw}in;height:${lh}in;padding:${mV}in ${mH}in;box-sizing:border-box;${i<bins.length-1?'page-break-after:always':''}">
      ${buildLabelHtml(b,lw-mH*2,lh-mV*2,cut,isL)}
    </div>`).join('')
  return printHtmlWrapper(body,`${lw}in ${lh}in`,'0',cut)
}

function buildWideFormatPrint(bins:BinData[], rollW:number, labelW:number, labelH:number, gap:number, maxLen:number, cut:CutContourSettings) {
  const usable=rollW-0.5
  const cols=Math.max(1,Math.floor((usable+gap)/(labelW+gap)))
  const perStrip=cols*Math.floor((maxLen+gap)/(labelH+gap))
  const pages:BinData[][]=[]
  for(let i=0;i<bins.length;i+=perStrip) pages.push(bins.slice(i,i+perStrip))
  const body=pages.map((pg,pi)=>{
    const pgRows=Math.ceil(pg.length/cols)
    const pgH=pgRows*labelH+(pgRows-1)*gap
    return `<div style="width:${usable}in;height:${pgH}in;display:grid;grid-template-columns:repeat(${cols},${labelW}in);gap:${gap}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b=>buildLabelHtml(b,labelW,labelH,cut)).join('')}
    </div>`
  }).join('')
  return printHtmlWrapper(body,`${rollW}in auto`,'0 0.25in',cut)
}

function buildCustomPrint(bins:BinData[], s:CustomSettings, cut:CutContourSettings) {
  const lw=(s.pageW-s.marginH*2-s.gap*(s.cols-1))/s.cols
  const lh=(s.pageH-s.marginV*2-s.gap*(s.rows-1))/s.rows
  const perPage=s.cols*s.rows
  const pages:BinData[][]=[]
  for(let i=0;i<bins.length;i+=perPage) pages.push(bins.slice(i,i+perPage))
  const body=pages.map((pg,pi)=>`
    <div style="width:${s.pageW-s.marginH*2}in;height:${s.pageH-s.marginV*2}in;display:grid;grid-template-columns:repeat(${s.cols},${lw}in);grid-template-rows:repeat(${s.rows},${lh}in);gap:${s.gap}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b=>buildLabelHtml(b,lw,lh,cut)).join('')}
    </div>`).join('')
  return printHtmlWrapper(body,`${s.pageW}in ${s.pageH}in`,`${s.marginV}in ${s.marginH}in`,cut)
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
              <Label className="text-xs">Contour color</Label>
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
              <strong>Tip:</strong> Common swatch names — <span className="font-mono">CutContour</span> (Onyx, Caldera), <span className="font-mono">Die Cut</span> (Illustrator), <span className="font-mono">RDG_WHITE</span> (Roland). Check your printer software docs.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LabelsPage() {
  const {bins} = useBins()
  const [searchParams] = useSearchParams()
  const [selected,setSelected]       = useState<Set<string>>(() => {
    const preselect = searchParams.get('bin')
    return preselect ? new Set([preselect]) : new Set()
  })
  const [showPreview,setShowPreview] = useState(false)
  const [mode,setMode]               = useState<PrintMode>('home')
  const [scale,setScale]             = useState(1)
  const [settingsOpen,setSettingsOpen] = useState(true)
  const containerRef                 = useRef<HTMLDivElement>(null)

  const [homeLpp,setHomeLpp]   = useState<1|2|3|4|5|6>(2)
  const [thermal,setThermal]   = useState<ThermalSettings>({labelW:4,labelH:6,marginH:0.1,marginV:0.1})
  const [thermalPreset,setThermalPreset] = useState(0)
  const [wide,setWide]         = useState<WideFormatSettings>({
    rollWidth:12.5, colsAcross:3, gap:0.3, labelH:6, maxLength:36,
    labelW: calcLabelW(12.5, 3, 0.3)
  })
  const [custom,setCustom]     = useState<CustomSettings>({pageW:8.5,pageH:11,cols:2,rows:3,marginH:0.5,marginV:0.5,gap:0.15})
  const [cut,setCut]           = useState<CutContourSettings>({enabled:false,offset:0.05,color:'#FF00CC',swatchName:'CutContour'})

  // Keep wide.labelW in sync
  const updateWide = (updates: Partial<WideFormatSettings>) => {
    setWide(prev => {
      const next = {...prev,...updates}
      next.labelW = calcLabelW(next.rollWidth, next.colsAcross, next.gap)
      return next
    })
  }

  const toggleBin   = (id:string) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
  const selectAll   = () => setSelected(new Set(bins.map(b=>b.id)))
  const deselectAll = () => setSelected(new Set())
  const selectedBins = bins.filter(b=>selected.has(b.id))

  // Home
  const {cols:hCols,rows:hRows}=HOME_GRID[homeLpp]
  const hGap=0.12, hLw=(7.5-hGap*(hCols-1))/hCols, hLh=(10-hGap*(hRows-1))/hRows

  // Wide
  const wideRows  = Math.ceil(selectedBins.length / wide.colsAcross)
  const wideStripH= wideRows*wide.labelH+(wideRows-1)*wide.gap

  // Custom
  const cLw = (custom.pageW-custom.marginH*2-custom.gap*(custom.cols-1))/custom.cols
  const cLh = (custom.pageH-custom.marginV*2-custom.gap*(custom.rows-1))/custom.rows

  // Scale preview
  const calcScale = useCallback(()=>{
    let pW=8.5, pH=11
    if(mode==='thermal')    {pW=thermal.labelW; pH=thermal.labelH}
    if(mode==='wideformat') {pW=wide.rollWidth; pH=Math.min(wideStripH,wide.maxLength)}
    if(mode==='custom')     {pW=custom.pageW; pH=custom.pageH}
    const aW=window.innerWidth-48, aH=window.innerHeight-120
    setScale(Math.min(1, aW/(pW*96), aH/(pH*96)))
  },[mode,thermal,wide,wideStripH,custom])

  useEffect(()=>{
    if(!showPreview) return
    calcScale()
    window.addEventListener('resize',calcScale)
    return ()=>window.removeEventListener('resize',calcScale)
  },[showPreview,calcScale])

  const handlePrint = () => {
    let html=''
    if(mode==='home')       html=buildHomePrint(selectedBins,homeLpp,cut)
    if(mode==='thermal')    html=buildThermalPrint(selectedBins,thermal.labelW,thermal.labelH,thermal.marginH,thermal.marginV,cut)
    if(mode==='wideformat') html=buildWideFormatPrint(selectedBins,wide.rollWidth,wide.labelW,wide.labelH,wide.gap,wide.maxLength,cut)
    if(mode==='custom')     html=buildCustomPrint(selectedBins,custom,cut)
    openPrint(html)
  }

  const MODE_LABELS:Record<PrintMode,string>={
    home:'🏠 Home Printer', thermal:'🖨️ Thermal', wideformat:'📏 Wide Format', custom:'⚙️ Custom'
  }

  // Preview pages
  const homePages:BinData[][]=[]
  for(let i=0;i<selectedBins.length;i+=hCols*hRows) homePages.push(selectedBins.slice(i,i+hCols*hRows))
  const customPages:BinData[][]=[]
  for(let i=0;i<selectedBins.length;i+=custom.cols*custom.rows) customPages.push(selectedBins.slice(i,i+custom.cols*custom.rows))

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl md:text-3xl">Labels</h1>
          <p className="text-muted-foreground text-sm mt-1">Select bins and configure print settings</p>
        </div>
        <Button onClick={()=>setShowPreview(true)} disabled={selected.size===0}>
          <Printer className="h-4 w-4"/> Preview & Print ({selected.size})
        </Button>
      </div>

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
                <p className="text-xs text-muted-foreground">Label size: {hLw.toFixed(2)}" × {hLh.toFixed(2)}"</p>
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <NumInput label="Roll width"     value={wide.rollWidth}   onChange={v=>updateWide({rollWidth:v})}   min={4} max={60} step={0.5}/>
                  <NumInput label="Labels across"  value={wide.colsAcross}  onChange={v=>updateWide({colsAcross:Math.max(1,Math.round(v))})} min={1} max={30} step={1} suffix=""/>
                  <NumInput label="Gap between"    value={wide.gap}         onChange={v=>updateWide({gap:v})}         min={0.1} max={2} step={0.05}/>
                  <NumInput label="Label height"   value={wide.labelH}      onChange={v=>updateWide({labelH:v})}      min={1} max={30} step={0.5}/>
                  <NumInput label="Max strip length" value={wide.maxLength} onChange={v=>updateWide({maxLength:v})}   min={6} max={120} step={1}/>
                </div>

                {/* Auto-fit result */}
                <div className={`rounded-lg px-4 py-3 text-sm ${wide.labelW<=0?'bg-destructive/10 text-destructive':'bg-primary/10 text-primary'}`}>
                  {wide.labelW<=0
                    ? '⚠️ Too many labels across for this roll width. Reduce count or gap.'
                    : <>
                        ✓ Auto-fit: <strong>{wide.colsAcross}</strong> labels across ·
                        label width = <strong>{wide.labelW.toFixed(3)}"</strong> ·
                        gap = <strong>{wide.gap}"</strong> ·
                        {selectedBins.length>0&&<> strip = <strong>{wideStripH.toFixed(1)}"</strong> long for {selectedBins.length} labels</>}
                      </>
                  }
                </div>
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
                {cLw>0&&cLh>0&&<p className="text-xs text-muted-foreground">Label size: {cLw.toFixed(2)}" × {cLh.toFixed(2)}" · {custom.cols*custom.rows} per page</p>}
              </div>
            )}

            {/* CUT CONTOUR — available for all modes */}
            <CutContourPanel cut={cut} setCut={setCut}/>
          </div>
        )}
      </div>

      {/* Bin select controls */}
      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={selectAll}>Select all</Button>
        <Button variant="outline" size="sm" onClick={deselectAll}>Deselect all</Button>
      </div>

      {/* Bin list */}
      {bins.length===0?(
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-xl">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-40"/>
          <p className="text-sm">No bins to print labels for</p>
        </div>
      ):(
        <div className="space-y-2">
          {bins.map(bin=>(
            <label key={bin.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${selected.has(bin.id)?'border-primary/50 bg-primary/5':'bg-card hover:bg-accent'}`}>
              <Checkbox checked={selected.has(bin.id)} onCheckedChange={()=>toggleBin(bin.id)}/>
              <div className="h-3 w-3 rounded-full shrink-0" style={{backgroundColor:bin.color}}/>
              <span className="font-mono text-xs text-muted-foreground">#{formatBinNumber(bin.binNumber)}</span>
              <span className="text-sm font-medium flex-1">{bin.name}</span>
              {bin.location&&<span className="text-xs text-muted-foreground hidden sm:block">{bin.location}</span>}
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
              <span style={{color:'#334155',fontSize:'11px'}}>{selectedBins.length} label{selectedBins.length!==1?'s':''}</span>
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <button onClick={handlePrint} style={{display:'flex',alignItems:'center',gap:'6px',backgroundColor:'#3b82f6',color:'white',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:700,fontSize:13}}>
                <Printer size={14}/> Print / Save PDF
              </button>
              <button onClick={()=>setShowPreview(false)} style={{width:32,height:32,borderRadius:7,border:'1px solid #1e293b',backgroundColor:'transparent',color:'#64748b',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <X size={15}/>
              </button>
            </div>
          </div>

          {/* Preview content */}
          <div ref={containerRef} style={{flex:1,overflowY:'auto',overflowX:'hidden',display:'flex',flexDirection:'column',alignItems:'center',gap:'32px',padding:'24px 0'}}>

            {mode==='home'&&homePages.map((pg,pi)=>(
              <div key={pi} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
                <p style={{color:'#475569',fontSize:'11px'}}>Page {pi+1} of {homePages.length}</p>
                <div style={{width:`${8.5*96*scale}px`,height:`${11*96*scale}px`,position:'relative',flexShrink:0}}>
                  <div style={{position:'absolute',top:0,left:0,transformOrigin:'top left',transform:`scale(${scale})`}}>
                    <div style={{width:'8.5in',height:'11in',backgroundColor:'white',padding:'0.5in',boxSizing:'border-box',boxShadow:'0 8px 40px rgba(0,0,0,0.5)',display:'grid',gridTemplateColumns:`repeat(${hCols},${hLw}in)`,gridTemplateRows:`repeat(${hRows},${hLh}in)`,gap:`${hGap}in`}}>
                      {pg.map(bin=><LabelCard key={bin.id} bin={bin} w={hLw} h={hLh} isLayout3={homeLpp===3} cut={cut}/>)}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {mode==='thermal'&&selectedBins.slice(0,3).map((bin,i)=>(
              <div key={i} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
                <p style={{color:'#475569',fontSize:'11px'}}>Label {i+1}{i===2&&selectedBins.length>3?' (first 3 shown)':''}</p>
                <div style={{width:`${thermal.labelW*96*scale}px`,height:`${thermal.labelH*96*scale}px`,position:'relative',flexShrink:0}}>
                  <div style={{position:'absolute',top:0,left:0,transformOrigin:'top left',transform:`scale(${scale})`}}>
                    <div style={{width:`${thermal.labelW}in`,height:`${thermal.labelH}in`,backgroundColor:'white',padding:`${thermal.marginV}in ${thermal.marginH}in`,boxSizing:'border-box',boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}>
                      <LabelCard bin={bin} w={thermal.labelW-thermal.marginH*2} h={thermal.labelH-thermal.marginV*2} isLayout3={thermal.labelW>thermal.labelH} cut={cut}/>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {mode==='wideformat'&&wide.labelW>0&&(()=>{
              const pH=Math.min(wideStripH,wide.maxLength)
              return (
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
                  <p style={{color:'#475569',fontSize:'11px'}}>{wide.rollWidth}" wide · {wideStripH.toFixed(1)}" long · {wide.colsAcross} across · label {wide.labelW.toFixed(3)}" × {wide.labelH}"</p>
                  <div style={{width:`${wide.rollWidth*96*scale}px`,height:`${pH*96*scale}px`,position:'relative',flexShrink:0}}>
                    <div style={{position:'absolute',top:0,left:0,transformOrigin:'top left',transform:`scale(${scale})`}}>
                      <div style={{width:`${wide.rollWidth}in`,height:`${pH}in`,backgroundColor:'white',padding:'0 0.25in 0.1in',boxSizing:'border-box',boxShadow:'0 8px 40px rgba(0,0,0,0.5)',display:'grid',gridTemplateColumns:`repeat(${wide.colsAcross},${wide.labelW}in)`,gap:`${wide.gap}in`,alignContent:'start',paddingTop:'0.1in'}}>
                        {selectedBins.map(bin=><LabelCard key={bin.id} bin={bin} w={wide.labelW} h={wide.labelH} cut={cut}/>)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {mode==='custom'&&cLw>0&&cLh>0&&customPages.map((pg,pi)=>(
              <div key={pi} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
                <p style={{color:'#475569',fontSize:'11px'}}>Page {pi+1} of {customPages.length}</p>
                <div style={{width:`${custom.pageW*96*scale}px`,height:`${custom.pageH*96*scale}px`,position:'relative',flexShrink:0}}>
                  <div style={{position:'absolute',top:0,left:0,transformOrigin:'top left',transform:`scale(${scale})`}}>
                    <div style={{width:`${custom.pageW}in`,height:`${custom.pageH}in`,backgroundColor:'white',padding:`${custom.marginV}in ${custom.marginH}in`,boxSizing:'border-box',boxShadow:'0 8px 40px rgba(0,0,0,0.5)',display:'grid',gridTemplateColumns:`repeat(${custom.cols},${cLw}in)`,gridTemplateRows:`repeat(${custom.rows},${cLh}in)`,gap:`${custom.gap}in`}}>
                      {pg.map(bin=><LabelCard key={bin.id} bin={bin} w={cLw} h={cLh} cut={cut}/>)}
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
