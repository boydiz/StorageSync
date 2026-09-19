import { formatBinNumber } from '@/lib/utils'
import { qrMatrix } from './qr'

export type FontKey = 'bold' | 'regular'

export interface Measurer {
  width(font: FontKey, text: string, size: number): number
  ascent(font: FontKey): number
  descent(font: FontKey): number
  capHeight(font: FontKey): number
  sanitize(font: FontKey, text: string): string
  ellipsis(font: FontKey): string
}

export interface LabelBin {
  id: string
  binNumber: number
  name: string
  description: string
  color: string
  items: string[]
  url: string
}

export type LabelLayout = 'stack' | 'split'

export type Seg =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z']

export type Prim =
  | { t: 'stripe'; path: Seg[]; fill: string }
  | { t: 'outline'; path: Seg[]; sw: number; stroke: string }
  | { t: 'text'; x: number; y: number; size: number; font: FontKey; text: string }
  | { t: 'qr'; x: number; y: number; size: number; matrix: boolean[][] }
  | { t: 'cut'; path: Seg[]; sw: number }

export interface LabelDraw {
  w: number
  h: number
  prims: Prim[]
  qrSize: number
}

const PX = 1 / 96
export const BORDER = 1.5 * PX
export const LABEL_RADIUS = 8 * PX
export const OUTLINE_COLOR = '#cbd5e1'
export const CUT_STROKE = 0.02

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Colors come from user input; only a hex literal is ever used, otherwise black.
export function safeColor(value: string): string {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value ?? '').trim()) ? value.trim() : '#000000'
}

export function hexToRgb01(value: string): [number, number, number] {
  let h = safeColor(value).slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

export function pickLayout(w: number, h: number): LabelLayout {
  return w / h >= 1.35 ? 'split' : 'stack'
}

export function scanDistanceLabel(qrInches: number): string {
  const ft = (qrInches * 10) / 12
  return ft < 1 ? `~${Math.round(qrInches * 10)}in` : `~${ft.toFixed(1)} ft`
}

const K = 0.5522847498

// Rounded rectangle as path segments. y grows downward. `topOnly` rounds just the top corners.
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number, topOnly = false): Seg[] {
  const rt = clamp(r, 0, Math.min(w, h) / 2)
  const rb = topOnly ? 0 : rt
  const kt = K * rt
  const kb = K * rb
  const segs: Seg[] = [
    ['M', x + rt, y],
    ['L', x + w - rt, y],
    ['C', x + w - rt + kt, y, x + w, y + rt - kt, x + w, y + rt],
    ['L', x + w, y + h - rb],
  ]
  if (rb > 0) segs.push(['C', x + w, y + h - rb + kb, x + w - rb + kb, y + h, x + w - rb, y + h])
  else segs.push(['L', x + w, y + h])
  segs.push(['L', x + rb, y + h])
  if (rb > 0) segs.push(['C', x + rb - kb, y + h, x, y + h - rb + kb, x, y + h - rb])
  else segs.push(['L', x, y + h])
  segs.push(['L', x, y + rt])
  segs.push(['C', x, y + rt - kt, x + rt - kt, y, x + rt, y])
  segs.push(['Z'])
  return segs
}

export function cutContourPrim(w: number, h: number, offset: number): Prim {
  const r = Math.max(0, LABEL_RADIUS + offset)
  return { t: 'cut', path: roundedRectPath(-offset, -offset, w + 2 * offset, h + 2 * offset, r), sw: CUT_STROKE }
}

function baselineIn(font: FontKey, size: number, lineH: number, m: Measurer): number {
  const asc = m.ascent(font)
  const desc = m.descent(font)
  return (lineH - (asc + desc) * size) / 2 + asc * size
}

function ellipsize(text: string, font: FontKey, size: number, maxW: number, m: Measurer): string {
  const dots = m.ellipsis(font)
  let t = text.trimEnd()
  while (t.length > 0 && m.width(font, t + dots, size) > maxW) t = t.slice(0, -1).trimEnd()
  return t + dots
}

// Greedy word wrap. If the text needs more than maxLines, the last line is ellipsized.
function wrap(text: string, font: FontKey, size: number, maxW: number, maxLines: number, m: Measurer): string[] {
  if (maxLines <= 0) return []
  const words = m.sanitize(font, text).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const lines: string[] = []
  let cur = ''
  const pushWord = (word: string) => {
    let w = word
    while (m.width(font, w, size) > maxW && w.length > 1) {
      let cut = w.length - 1
      while (cut > 1 && m.width(font, w.slice(0, cut), size) > maxW) cut--
      if (cur) { lines.push(cur); cur = '' }
      lines.push(w.slice(0, cut))
      w = w.slice(cut)
    }
    const trial = cur ? `${cur} ${w}` : w
    if (cur && m.width(font, trial, size) > maxW) {
      lines.push(cur)
      cur = w
    } else {
      cur = trial
    }
  }
  for (const word of words) pushWord(word)
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1], font, size, maxW, m)
  return kept
}

// Fit a single line by shrinking the font; ellipsize only if it still overflows at the floor size.
function fitLine(text: string, font: FontKey, maxSize: number, minSize: number, maxW: number, m: Measurer) {
  const clean = m.sanitize(font, text).replace(/\s+/g, ' ').trim()
  const w = m.width(font, clean, maxSize)
  if (w <= maxW) return { text: clean, size: maxSize }
  const size = maxSize * (maxW / w)
  if (size >= minSize) return { text: clean, size }
  return { text: ellipsize(clean, font, minSize, maxW, m), size: minSize }
}

interface TextAlloc { desc: string[]; items: string[] }

// Spend a line budget in priority order: description line 1, items line 1, description line 2, items lines 2-4.
function allocText(desc: string, items: string, size: number, width: number, budget: number, m: Measurer): TextAlloc {
  if (budget <= 0) return { desc: [], items: [] }
  const dFull = wrap(desc, 'regular', size, width, 2, m)
  const iFull = wrap(items, 'regular', size, width, 4, m)
  const order: Array<['d' | 'i', number]> = [['d', 0], ['i', 0], ['d', 1], ['i', 1], ['i', 2], ['i', 3]]
  let dN = 0
  let iN = 0
  let used = 0
  for (const [k, idx] of order) {
    if (used >= budget) break
    if (k === 'd' && idx === dN && dN < dFull.length) { dN++; used++ }
    if (k === 'i' && idx === iN && iN < iFull.length) { iN++; used++ }
  }
  return { desc: wrap(desc, 'regular', size, width, dN, m), items: wrap(items, 'regular', size, width, iN, m) }
}

export function layoutLabel(bin: LabelBin, w: number, h: number, kind: LabelLayout, m: Measurer): LabelDraw {
  const prims: Prim[] = []
  const pad = clamp(Math.min(w, h) * 0.05, 0.04, 0.22)
  const stripeH = clamp(h * 96 * 0.028, 4, 16) * PX
  const x0 = BORDER + pad
  const innerW = Math.max(0.3, w - 2 * x0)
  const top = BORDER + stripeH + pad * 0.55
  const bottom = h - BORDER - pad
  const gap = clamp(Math.min(w, h) * 0.03, 0.03, 0.1)
  const gapSm = gap * 0.5
  const capB = m.capHeight('bold')

  prims.push({ t: 'stripe', path: roundedRectPath(BORDER, BORDER, w - 2 * BORDER, stripeH, LABEL_RADIUS - BORDER, true), fill: safeColor(bin.color) })

  // Name: one line, shrinks to fit across the top. The block is only as tall as the text itself,
  // so a shrunk name gives its space back to everything below.
  const nameMax = clamp(innerW * 0.14, 8 * PX, 40 * PX)
  const name = fitLine(bin.name, 'bold', nameMax, 5 / 72, innerW, m)
  const nameBase = top + capB * name.size * 1.04
  const nameEnd = nameBase + 0.2 * name.size
  prims.push({ t: 'text', x: x0, y: nameBase, size: name.size, font: 'bold', text: name.text })

  const bodyTop = nameEnd + gap * 0.8
  const bodyH = Math.max(0.2, bottom - bodyTop)
  const numText = `#${formatBinNumber(bin.binNumber)}`
  const numWidthPerSize = Math.max(0.01, m.width('bold', numText, 1))
  const itemsText = bin.items.join(', ')
  let qrSize = 0

  const placeText = (alloc: TextAlloc, x: number, yStart: number, size: number, lineH: number) => {
    let y = yStart
    const push = (line: string) => {
      prims.push({ t: 'text', x, y: y + baselineIn('regular', size, lineH, m), size, font: 'regular', text: line })
      y += lineH
    }
    alloc.desc.forEach(push)
    if (alloc.desc.length > 0 && alloc.items.length > 0) y += lineH * 0.2
    alloc.items.forEach(push)
    return y
  }
  const blockHeight = (a: TextAlloc, lineH: number) =>
    (a.desc.length + a.items.length) * lineH + (a.desc.length > 0 && a.items.length > 0 ? lineH * 0.2 : 0)

  if (kind === 'stack') {
    const numBase = Math.min(clamp(innerW * 0.3, 11 * PX, bodyH * 0.4), innerW / numWidthPerSize)
    const qrMin = clamp(innerW * 0.32, 0.55, 1.1)

    // Give the QR its minimum size first, then as much text as fits. If that leaves fewer than
    // two lines of text, shrink the bin number a step at a time to make room.
    let numSize = numBase
    let bodySize = 0
    let lineH = 0
    let alloc: TextAlloc = { desc: [], items: [] }
    let qrAvail = 0
    let numEnd = 0
    for (const s of [1, 0.9, 0.8, 0.7, 0.6]) {
      numSize = numBase * s
      numEnd = bodyTop + capB * numSize
      const remaining = bottom - numEnd
      bodySize = clamp(numSize * 0.3, 6 * PX, 15 * PX)
      lineH = bodySize * 1.2
      const wanted = allocText(bin.description, itemsText, bodySize, innerW, 6, m)
      const wantedLines = Math.min(2, wanted.desc.length + wanted.items.length)
      let placed = 0
      for (let n = 6; n >= 0; n--) {
        alloc = allocText(bin.description, itemsText, bodySize, innerW, n, m)
        const th = blockHeight(alloc, lineH)
        qrAvail = remaining - (th > 0 ? gapSm + th : 0) - gapSm
        placed = alloc.desc.length + alloc.items.length
        if (qrAvail >= qrMin) break
      }
      if (placed >= wantedLines && qrAvail >= qrMin) break
    }

    prims.push({ t: 'text', x: x0, y: bodyTop + capB * numSize, size: numSize, font: 'bold', text: numText })
    const textEnd = blockHeight(alloc, lineH) > 0 ? placeText(alloc, x0, numEnd + gapSm, bodySize, lineH) : numEnd
    qrSize = Math.max(0.3, Math.min(innerW, qrAvail))
    const qrTop = textEnd + Math.max(0, (bottom - textEnd - qrSize) / 2)
    prims.push({ t: 'qr', x: (w - qrSize) / 2, y: qrTop, size: qrSize, matrix: qrMatrix(bin.url) })
  } else {
    // Landscape: number and text on the left, QR on the right. The QR is capped at 40% of the width
    // so the text column stays wide enough to hold several lines.
    qrSize = Math.max(0.3, Math.min(bodyH, innerW * 0.4))
    const colW = Math.max(0.3, innerW - qrSize - pad * 0.5)
    const numSize = Math.min(clamp(colW * 0.34, 11 * PX, bodyH * 0.4), colW / numWidthPerSize)
    const numEnd = bodyTop + capB * numSize
    prims.push({ t: 'text', x: x0, y: numEnd, size: numSize, font: 'bold', text: numText })

    const bodySize = clamp(numSize * 0.3, 6 * PX, 15 * PX)
    const lineH = bodySize * 1.2
    const textTop = numEnd + gapSm
    const avail = bottom - textTop
    let alloc: TextAlloc = { desc: [], items: [] }
    for (let n = 8; n >= 0; n--) {
      alloc = allocText(bin.description, itemsText, bodySize, colW, n, m)
      if (blockHeight(alloc, lineH) <= avail) break
    }
    placeText(alloc, x0, textTop, bodySize, lineH)
    prims.push({ t: 'qr', x: w - x0 - qrSize, y: bodyTop + (bodyH - qrSize) / 2, size: qrSize, matrix: qrMatrix(bin.url) })
  }

  prims.push({
    t: 'outline',
    path: roundedRectPath(BORDER / 2, BORDER / 2, w - BORDER, h - BORDER, LABEL_RADIUS - BORDER / 2),
    sw: BORDER,
    stroke: OUTLINE_COLOR,
  })

  return { w, h, prims, qrSize }
}
