import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Printer, Tag, X, ChevronDown, ChevronUp, Scissors } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useBins } from '@/hooks/useBins'
import { useItems } from '@/hooks/useItems'
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

// Wide format: the label shape is locked to one of a few aspect ratios so it
// can't be dragged into a weird sliver. Width comes from the roll math; height
// is width x the shape's ratio.
type WideShape = 'qr' | 'wide' | 'square'
const WIDE_SHAPES: Record<WideShape, { label: string; ratio: number; hint: string }> = {
  qr:     { label: 'QR-dominant', ratio: 1.30, hint: 'Tall — big number on top, large QR below' },
  square: { label: 'Square',      ratio: 1.00, hint: 'Balanced — number + text over a large QR' },
  wide:   { label: 'Wide',        ratio: 0.62, hint: 'Landscape — number + text left, QR right' },
}

interface WideFormatSettings {
  sheetW: number        // sheet boundary width (material width)
  sheetLen: number      // max sheet length; a new sheet starts past this
  colsAcross: number
  gap: number
  margin: number        // inside the sheet edge (room for reg marks later)
  shape: WideShape
  autoFit: boolean      // trim each sheet's length to its content, no blank tail
}
interface CustomSettings {
  pageW: number; pageH: number; cols: number; rows: number
  marginH: number; marginV: number; gap: number
}

interface BinData {
  id: string; binNumber: number; name: string
  description: string; color: string
  items: string[]   // item names in this bin, printed on the label
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_GRID: Record<1|2|3|4|5|6,{cols:number;rows:number}> = {
  1:{cols:1,rows:1}, 2:{cols:1,rows:2}, 3:{cols:1,rows:3},
  4:{cols:2,rows:2}, 5:{cols:1,rows:5}, 6:{cols:2,rows:3},
}
const THERMAL_PRESETS = [
  {label:'4" × 6"',w:4,h:6},{label:'6" × 4"',w:6,h:4},
  {label:'3" × 2"',w:3,h:2},{label:'2" × 3"',w:2,h:3},{label:'4" × 4"',w:4,h:4},
]

// Label width from sheet width, margins, columns, and gap
function calcLabelW(sheetW: number, cols: number, gap: number, margin: number): number {
  const usable = sheetW - margin * 2
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

// ─── Label geometry ───────────────────────────────────────────────────────────
// One source of truth for label sizing, shared by the on-screen preview
// (LabelCard) and the print HTML (buildLabelHtml). The bin number and the QR
// code are the primary elements — big number to read across a room, big QR to
// scan from a distance. Name/location/description are supporting text.

type LabelLayout = 'stack' | 'split'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Landscape-ish labels put text and QR side by side; otherwise stack them.
function pickLayout(w: number, h: number): LabelLayout {
  return w / h >= 1.35 ? 'split' : 'stack'
}

// Rough QR scan distance: a QR reads from about 10x its width.
function scanDistanceLabel(qrInches: number): string {
  const ft = (qrInches * 10) / 12
  return ft < 1 ? `~${Math.round(qrInches * 10)}in` : `~${ft.toFixed(1)} ft`
}

// The label always carries: name band, big number, description, item list, QR.
// (Location is intentionally NOT printed — it's an app-only field.)
function labelFields(bin: { description: string; items: string[] }) {
  return {
    showDesc: !!bin.description,
    showItems: bin.items.length > 0,
  }
}
type LabelFields = ReturnType<typeof labelFields>

// Label anatomy (both layouts):
//   [stripe] [ NAME band, full width ] [ body ]
//   body — stack:  #number / description / items / QR (fills rest)
//   body — split:  left col (#number / description / items) | QR (full height)
function labelMetrics(w: number, h: number, layout: LabelLayout, f: LabelFields) {
  const pad = clamp(Math.min(w, h) * 0.055, 0.04, 0.24)
  const stripePx = clamp(h * 96 * 0.03, 4, 18)
  const innerW = w - pad * 2
  const innerWpx = innerW * 96
  const innerHpx = (h - pad * 2) * 96 - stripePx

  // Name band across the top — reserve ~1.6 lines for QR sizing.
  const namePx = clamp(innerWpx * 0.15, 9, 42)
  const nameBandPx = namePx * 1.2 * 1.6 + 4

  const bodyHpx = innerHpx - nameBandPx
  const colW = layout === 'split' ? innerW * 0.52 : innerW

  const numPx = clamp(colW * 96 * 0.30, 12, bodyHpx * (layout === 'split' ? 0.5 : 0.42))
  const bodyPx = clamp(numPx * 0.3, 6.5, 18)

  // Text under the number (stack) / in the left column (split).
  const belowNumPx =
    numPx * 1.15 +
    (f.showDesc  ? bodyPx * 1.3 * 2 + 3 : 0) +   // ~2 lines
    (f.showItems ? bodyPx * 1.25 * 3 + 3 : 0)    // ~3 lines

  const qrPx = layout === 'split'
    ? clamp(Math.min(bodyHpx - pad * 8, innerWpx * 0.46), 44, bodyHpx)
    : clamp(bodyHpx - belowNumPx - pad * 20, 44, innerWpx)

  return { pad, stripePx, namePx, numPx, bodyPx, qrPx: Math.round(qrPx) }
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

function LabelCard({ bin, w, h, layout, cut }: {
  bin: BinData; w: number; h: number; layout: LabelLayout; cut: CutContourSettings
}) {
  const qrUrl = `${window.location.origin}/bin/${bin.id}`
  const f = labelFields(bin)
  const m = labelMetrics(w, h, layout, f)

  const nameBand = (
    <div style={{fontWeight:800,fontSize:m.namePx,color:'#0f172a',lineHeight:1.15,wordBreak:'break-word',flexShrink:0,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical' as const}}>
      {bin.name}
    </div>
  )
  const num = (
    <div style={{fontFamily:'monospace',fontSize:m.numPx,color:'#0f172a',fontWeight:900,lineHeight:1.12,letterSpacing:'-0.02em',flexShrink:0,overflow:'hidden'}}>
      #{formatBinNumber(bin.binNumber)}
    </div>
  )
  const detail = (
    <div style={{overflow:'hidden',minHeight:0}}>
      {f.showDesc&&(
        <div style={{fontSize:m.bodyPx,color:'#475569',marginTop:m.bodyPx*0.4,lineHeight:1.25,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical' as const}}>
          {bin.description}
        </div>
      )}
      {f.showItems&&(
        <div style={{fontSize:m.bodyPx,color:'#0f172a',marginTop:m.bodyPx*0.5,lineHeight:1.3,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical' as const}}>
          {bin.items.join(', ')}
        </div>
      )}
    </div>
  )
  const qr = (
    <div style={{width:m.qrPx,height:m.qrPx,maxWidth:'100%',maxHeight:'100%',flexShrink:0}}>
      <QRCodeSVG value={qrUrl} size={m.qrPx} style={{width:'100%',height:'100%',display:'block'}}/>
    </div>
  )

  return (
    // Outer wrapper is NOT clipped so the cut contour (which sits outside the
    // label edge) stays visible; the inner box keeps overflow:hidden for the
    // rounded-corner clip of the color stripe.
    <div style={{position:'relative',width:`${w}in`,height:`${h}in`,pageBreakInside:'avoid',boxSizing:'border-box'}}>
      <div style={{width:'100%',height:'100%',border:'1.5px solid #cbd5e1',borderRadius:'8px',overflow:'hidden',backgroundColor:'white',display:'flex',flexDirection:'column',boxSizing:'border-box'}}>
        <div style={{height:m.stripePx,backgroundColor:bin.color,flexShrink:0,WebkitPrintColorAdjust:'exact',printColorAdjust:'exact'} as React.CSSProperties}/>
        <div style={{flex:1,display:'flex',flexDirection:'column',padding:`${m.pad}in`,overflow:'hidden',minHeight:0}}>
          {nameBand}
          {layout==='split'?(
            <div style={{flex:1,display:'flex',flexDirection:'row',gap:`${m.pad}in`,alignItems:'stretch',overflow:'hidden',minHeight:0,marginTop:m.pad*24}}>
              <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
                {num}
                <div style={{marginTop:m.bodyPx*0.3,overflow:'hidden',minHeight:0}}>{detail}</div>
              </div>
              <div style={{flexShrink:0,alignSelf:'center',maxWidth:'48%',maxHeight:'100%',display:'flex'}}>{qr}</div>
            </div>
          ):(
            <>
              <div style={{flexShrink:0,marginTop:m.pad*20}}>{num}</div>
              <div style={{flexShrink:0,minHeight:0,marginTop:m.bodyPx*0.3}}>{detail}</div>
              <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',minHeight:0,overflow:'hidden',marginTop:m.pad*24}}>{qr}</div>
            </>
          )}
        </div>
      </div>
      <CutContourOverlay w={w} h={h} cut={cut} />
    </div>
  )
}

// ─── Print HTML Helpers ───────────────────────────────────────────────────────

function buildLabelHtml(bin: BinData, w: number, h: number, cut: CutContourSettings, layout: LabelLayout): string {
  const qrUrl  = `${window.location.origin}/bin/${bin.id}`
  const f      = labelFields(bin)
  const m      = labelMetrics(w, h, layout, f)
  const qrSvg  = ReactDOMServer.renderToStaticMarkup(
    <QRCodeSVG value={qrUrl} size={m.qrPx} style={{width:'100%',height:'100%',display:'block'}}/>
  )
  const numStr = String(bin.binNumber).padStart(3,'0')
  const stripe = safeColor(bin.color)

  const clamp2 = 'overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical'
  const nameHtml = `<div style="font-weight:800;font-size:${m.namePx}px;color:#0f172a;line-height:1.15;word-break:break-word;flex-shrink:0;-webkit-line-clamp:2;${clamp2}">${escapeHtml(bin.name)}</div>`
  const numHtml  = `<div style="font-family:monospace;font-size:${m.numPx}px;color:#0f172a;font-weight:900;line-height:1.12;letter-spacing:-0.02em;flex-shrink:0;overflow:hidden">#${numStr}</div>`
  const detailHtml = `<div style="overflow:hidden;min-height:0">
    ${f.showDesc?`<div style="font-size:${m.bodyPx}px;color:#475569;margin-top:${m.bodyPx*0.4}px;line-height:1.25;-webkit-line-clamp:2;${clamp2}">${escapeHtml(bin.description)}</div>`:''}
    ${f.showItems?`<div style="font-size:${m.bodyPx}px;color:#0f172a;margin-top:${m.bodyPx*0.5}px;line-height:1.3;-webkit-line-clamp:3;${clamp2}">${escapeHtml(bin.items.join(', '))}</div>`:''}
  </div>`
  const qrHtml = `<div style="width:${m.qrPx}px;height:${m.qrPx}px;max-width:100%;max-height:100%;flex-shrink:0">${qrSvg}</div>`

  const body = layout === 'split'
    ? `<div style="flex:1;display:flex;flex-direction:row;gap:${m.pad}in;align-items:stretch;overflow:hidden;min-height:0;margin-top:${m.pad*0.5}in">
         <div style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden">
           ${numHtml}
           <div style="margin-top:${m.bodyPx*0.3}px;overflow:hidden;min-height:0">${detailHtml}</div>
         </div>
         <div style="flex-shrink:0;align-self:center;max-width:48%;max-height:100%;display:flex">${qrHtml}</div>
       </div>`
    : `<div style="flex-shrink:0;margin-top:${m.pad*0.42}in">${numHtml}</div>
       <div style="flex-shrink:0;min-height:0;margin-top:${m.bodyPx*0.3}px">${detailHtml}</div>
       <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;overflow:hidden;margin-top:${m.pad*0.5}in">${qrHtml}</div>`

  return `
    <div style="position:relative;width:${w}in;height:${h}in;page-break-inside:avoid;box-sizing:border-box;">
      <div style="width:100%;height:100%;border:1.5px solid #cbd5e1;border-radius:8px;overflow:hidden;background:white;display:flex;flex-direction:column;box-sizing:border-box;">
        <div style="height:${m.stripePx}px;background:${stripe};flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact"></div>
        <div style="flex:1;display:flex;flex-direction:column;padding:${m.pad}in;overflow:hidden;min-height:0">
          ${nameHtml}
          ${body}
        </div>
      </div>
      ${cutContourSvgStr(w,h,cut)}
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
  const perPage=cols*rows, layout=pickLayout(lw,lh)
  const pages:BinData[][]=[]
  for(let i=0;i<bins.length;i+=perPage) pages.push(bins.slice(i,i+perPage))
  const body=pages.map((pg,pi)=>`
    <div style="display:grid;grid-template-columns:repeat(${cols},${lw}in);grid-template-rows:repeat(${rows},${lh}in);gap:${gap}in;width:${pw}in;height:${ph}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b=>buildLabelHtml(b,lw,lh,cut,layout)).join('')}
    </div>`).join('')
  return printHtmlWrapper(body,'letter portrait','0.5in',cut)
}

function buildThermalPrint(bins:BinData[], lw:number, lh:number, mH:number, mV:number, cut:CutContourSettings) {
  const layout=pickLayout(lw-mH*2,lh-mV*2)
  const body=bins.map((b,i)=>`
    <div style="width:${lw}in;height:${lh}in;padding:${mV}in ${mH}in;box-sizing:border-box;${i<bins.length-1?'page-break-after:always':''}">
      ${buildLabelHtml(b,lw-mH*2,lh-mV*2,cut,layout)}
    </div>`).join('')
  return printHtmlWrapper(body,`${lw}in ${lh}in`,'0',cut)
}

function wideRowsPerSheet(sheetLen:number, labelH:number, gap:number, margin:number): number {
  return Math.max(1, Math.floor((sheetLen - margin*2 + gap) / (labelH + gap)))
}

function buildWideFormatPrint(bins:BinData[], sheetW:number, sheetLen:number, cols:number, labelW:number, labelH:number, gap:number, margin:number, autoFit:boolean, cut:CutContourSettings) {
  const perSheet = Math.max(1, cols * wideRowsPerSheet(sheetLen, labelH, gap, margin))
  const sheets:BinData[][]=[]
  for(let i=0;i<bins.length;i+=perSheet) sheets.push(bins.slice(i,i+perSheet))
  if(sheets.length===0) sheets.push([])
  const layout=pickLayout(labelW,labelH)
  const body=sheets.map((pg,si)=>{
    const usedRows=Math.max(1,Math.ceil(pg.length/cols))
    const contentH=usedRows*labelH+(usedRows-1)*gap
    const sheetH=autoFit ? +(contentH+margin*2).toFixed(3) : sheetLen
    return `<div style="width:${sheetW}in;height:${sheetH}in;padding:${margin}in;box-sizing:border-box;position:relative;${si<sheets.length-1?'page-break-after:always':''}">
      <div style="display:grid;grid-template-columns:repeat(${cols},${labelW}in);gap:${gap}in;align-content:start">
        ${pg.map(b=>buildLabelHtml(b,labelW,labelH,cut,layout)).join('')}
      </div>
    </div>`
  }).join('')
  return printHtmlWrapper(body,`${sheetW}in auto`,'0',cut)
}

function buildCustomPrint(bins:BinData[], s:CustomSettings, cut:CutContourSettings) {
  const lw=(s.pageW-s.marginH*2-s.gap*(s.cols-1))/s.cols
  const lh=(s.pageH-s.marginV*2-s.gap*(s.rows-1))/s.rows
  const perPage=s.cols*s.rows, layout=pickLayout(lw,lh)
  const pages:BinData[][]=[]
  for(let i=0;i<bins.length;i+=perPage) pages.push(bins.slice(i,i+perPage))
  const body=pages.map((pg,pi)=>`
    <div style="width:${s.pageW-s.marginH*2}in;height:${s.pageH-s.marginV*2}in;display:grid;grid-template-columns:repeat(${s.cols},${lw}in);grid-template-rows:repeat(${s.rows},${lh}in);gap:${s.gap}in;${pi<pages.length-1?'page-break-after:always':''}">
      ${pg.map(b=>buildLabelHtml(b,lw,lh,cut,layout)).join('')}
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

// ─── Wide Format Diagram ──────────────────────────────────────────────────────
// To-scale sketch of one row of labels across the sheet, with the resulting
// label size and an estimated QR scan distance.

function WideFormatDiagram({sheetW,margin,cols,gap,labelW,labelH,overflow}:{
  sheetW:number;margin:number;cols:number;gap:number;labelW:number;labelH:number;overflow:boolean
}) {
  const VW = 300
  const scale = VW / sheetW                          // px per inch
  const startX = margin * scale
  const boxW = labelW * scale
  const drawH = Math.max(28, Math.min(labelH * scale, 150))
  const gapPx = gap * scale
  const shown = Math.min(cols, 8)
  const lay = pickLayout(labelW, labelH)
  const qrIn = labelMetrics(labelW, labelH, lay, labelFields({description:'x', items:['x']})).qrPx / 96
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
        <span>QR ≈ <strong className="text-foreground">{qrIn.toFixed(1)}"</strong> → scans {scanDistanceLabel(qrIn)}</span>
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
  const {items} = useItems()
  const [searchParams] = useSearchParams()

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
  const [scale,setScale]             = useState(1)
  const [settingsOpen,setSettingsOpen] = useState(true)
  const containerRef                 = useRef<HTMLDivElement>(null)

  const [homeLpp,setHomeLpp]   = useState<1|2|3|4|5|6>(2)
  const [thermal,setThermal]   = useState<ThermalSettings>({labelW:4,labelH:6,marginH:0.1,marginV:0.1})
  const [thermalPreset,setThermalPreset] = useState(0)
  const [wide,setWide]         = useState<WideFormatSettings>({
    sheetW:12.5, sheetLen:30, colsAcross:3, gap:0.3, margin:0.25, shape:'qr', autoFit:true
  })
  const [custom,setCustom]     = useState<CustomSettings>({pageW:8.5,pageH:11,cols:2,rows:3,marginH:0.5,marginV:0.5,gap:0.15})
  const [cut,setCut]           = useState<CutContourSettings>({enabled:false,offset:0.05,color:'#FF00CC',swatchName:'CutContour'})

  const updateWide = (updates: Partial<WideFormatSettings>) => setWide(prev => ({...prev,...updates}))

  const toggleBin   = (id:string) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n})
  const selectAll   = () => setSelected(new Set(bins.map(b=>b.id)))
  const deselectAll = () => setSelected(new Set())
  const selectedBins: BinData[] = bins.filter(b=>selected.has(b.id)).map(b => ({
    id: b.id, binNumber: b.binNumber, name: b.name,
    description: b.description, color: b.color,
    items: itemsByBin[b.id] ?? [],
  }))

  // Home
  const {cols:hCols,rows:hRows}=HOME_GRID[homeLpp]
  const hGap=0.12, hLw=(7.5-hGap*(hCols-1))/hCols, hLh=(10-hGap*(hRows-1))/hRows

  // Wide — label width from the sheet math, height locked to the shape ratio.
  const wideRawW   = (wide.sheetW - wide.margin*2 - wide.gap*(wide.colsAcross-1)) / wide.colsAcross
  const wideOverflow = wideRawW < 0.5
  const wideLabelW = calcLabelW(wide.sheetW, wide.colsAcross, wide.gap, wide.margin)
  const wideLabelH = wideLabelW * WIDE_SHAPES[wide.shape].ratio
  const wideRowsPer = wideRowsPerSheet(wide.sheetLen, wideLabelH, wide.gap, wide.margin)
  const widePerSheet = Math.max(1, wide.colsAcross * wideRowsPer)
  const wideSheets: BinData[][] = []
  for (let i=0;i<selectedBins.length;i+=widePerSheet) wideSheets.push(selectedBins.slice(i,i+widePerSheet))
  const wideSheetHeights = (wideSheets.length ? wideSheets : [[]]).map(pg => {
    const rows = Math.max(1, Math.ceil((pg.length||1)/wide.colsAcross))
    return wide.autoFit ? rows*wideLabelH + (rows-1)*wide.gap + wide.margin*2 : wide.sheetLen
  })

  // Custom
  const cLw = (custom.pageW-custom.marginH*2-custom.gap*(custom.cols-1))/custom.cols
  const cLh = (custom.pageH-custom.marginV*2-custom.gap*(custom.rows-1))/custom.rows

  // Scale preview
  const calcScale = useCallback(()=>{
    let pW=8.5, pH=11
    if(mode==='thermal')    {pW=thermal.labelW; pH=thermal.labelH}
    if(mode==='wideformat') {pW=wide.sheetW; pH=Math.max(1,Math.min(...wideSheetHeights))}
    if(mode==='custom')     {pW=custom.pageW; pH=custom.pageH}
    const aW=window.innerWidth-48, aH=window.innerHeight-120
    setScale(Math.min(1, aW/(pW*96), aH/(pH*96)))
  },[mode,thermal,wide,wideSheetHeights,custom])

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
    if(mode==='wideformat') html=buildWideFormatPrint(selectedBins,wide.sheetW,wide.sheetLen,wide.colsAcross,wideLabelW,wideLabelH,wide.gap,wide.margin,wide.autoFit,cut)
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
                  labelW={wideLabelW} labelH={wideLabelH} overflow={wideOverflow}
                />

                {selectedBins.length>0 && !wideOverflow && (
                  <p className="text-xs text-muted-foreground">
                    {wideSheets.length} sheet{wideSheets.length!==1?'s':''} · {wide.colsAcross} × {wideRowsPer} labels per sheet ·
                    {wide.autoFit
                      ? <> last sheet ≈ <strong className="text-foreground">{Math.max(...wideSheetHeights).toFixed(1)}"</strong> tall</>
                      : <> {wide.sheetLen}" per sheet</>}
                  </p>
                )}
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
              <span className="font-mono text-sm font-bold">#{formatBinNumber(bin.binNumber)}</span>
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
                      {pg.map(bin=><LabelCard key={bin.id} bin={bin} w={hLw} h={hLh} layout={pickLayout(hLw,hLh)} cut={cut}/>)}
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
                      <LabelCard bin={bin} w={thermal.labelW-thermal.marginH*2} h={thermal.labelH-thermal.marginV*2} layout={pickLayout(thermal.labelW-thermal.marginH*2,thermal.labelH-thermal.marginV*2)} cut={cut}/>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {mode==='wideformat'&&!wideOverflow&&(wideSheets.length?wideSheets:[[]]).map((pg,si)=>{
              const sheetH=wideSheetHeights[si]||1
              const lay=pickLayout(wideLabelW,wideLabelH)
              return (
                <div key={si} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
                  <p style={{color:'#475569',fontSize:'11px'}}>Sheet {si+1} of {Math.max(1,wideSheets.length)} · {wide.sheetW}" × {sheetH.toFixed(1)}" · label {wideLabelW.toFixed(2)}" × {wideLabelH.toFixed(2)}" ({WIDE_SHAPES[wide.shape].label})</p>
                  <div style={{width:`${wide.sheetW*96*scale}px`,height:`${sheetH*96*scale}px`,position:'relative',flexShrink:0}}>
                    <div style={{position:'absolute',top:0,left:0,transformOrigin:'top left',transform:`scale(${scale})`}}>
                      <div style={{width:`${wide.sheetW}in`,height:`${sheetH}in`,backgroundColor:'white',padding:`${wide.margin}in`,boxSizing:'border-box',boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}>
                        <div style={{display:'grid',gridTemplateColumns:`repeat(${wide.colsAcross},${wideLabelW}in)`,gap:`${wide.gap}in`,alignContent:'start'}}>
                          {pg.map(bin=><LabelCard key={bin.id} bin={bin} w={wideLabelW} h={wideLabelH} layout={lay} cut={cut}/>)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {mode==='custom'&&cLw>0&&cLh>0&&customPages.map((pg,pi)=>(
              <div key={pi} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'8px'}}>
                <p style={{color:'#475569',fontSize:'11px'}}>Page {pi+1} of {customPages.length}</p>
                <div style={{width:`${custom.pageW*96*scale}px`,height:`${custom.pageH*96*scale}px`,position:'relative',flexShrink:0}}>
                  <div style={{position:'absolute',top:0,left:0,transformOrigin:'top left',transform:`scale(${scale})`}}>
                    <div style={{width:`${custom.pageW}in`,height:`${custom.pageH}in`,backgroundColor:'white',padding:`${custom.marginV}in ${custom.marginH}in`,boxSizing:'border-box',boxShadow:'0 8px 40px rgba(0,0,0,0.5)',display:'grid',gridTemplateColumns:`repeat(${custom.cols},${cLw}in)`,gridTemplateRows:`repeat(${custom.rows},${cLh}in)`,gap:`${custom.gap}in`}}>
                      {pg.map(bin=><LabelCard key={bin.id} bin={bin} w={cLw} h={cLh} layout={pickLayout(cLw,cLh)} cut={cut}/>)}
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
