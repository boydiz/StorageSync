import { pickLayout, type LabelBin, type LabelLayout } from './layout'

export interface PlacedLabel {
  bin: LabelBin
  x: number
  y: number
  w: number
  h: number
  layout: LabelLayout
}

export interface PageSpec {
  w: number
  h: number
  labels: PlacedLabel[]
}

export type WideShape = 'qr' | 'wide' | 'square'

// The label shape is locked to one of a few aspect ratios (height = width x ratio).
export const WIDE_SHAPES: Record<WideShape, { label: string; ratio: number; hint: string }> = {
  qr:     { label: 'QR-dominant', ratio: 1.30, hint: 'Tall — big number on top, large QR below' },
  square: { label: 'Square',      ratio: 1.00, hint: 'Balanced — number + text over a large QR' },
  wide:   { label: 'Wide',        ratio: 0.62, hint: 'Landscape — number + text left, QR right' },
}

export interface WideFormatSettings {
  sheetW: number
  sheetLen: number
  colsAcross: number
  gap: number
  margin: number
  shape: WideShape
  autoFit: boolean
}

export interface CustomSettings {
  pageW: number; pageH: number; cols: number; rows: number
  marginH: number; marginV: number; gap: number
}

export const HOME_GRID: Record<1 | 2 | 3 | 4 | 5 | 6, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 }, 2: { cols: 1, rows: 2 }, 3: { cols: 1, rows: 3 },
  4: { cols: 2, rows: 2 }, 5: { cols: 1, rows: 5 }, 6: { cols: 2, rows: 3 },
}
export const HOME_GAP = 0.12
export const HOME_MARGIN = 0.5

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function calcLabelW(sheetW: number, cols: number, gap: number, margin: number): number {
  const usable = sheetW - margin * 2
  return Math.max(0.5, (usable - gap * (cols - 1)) / cols)
}

export function wideRowsPerSheet(sheetLen: number, labelH: number, gap: number, margin: number): number {
  return Math.max(1, Math.floor((sheetLen - margin * 2 + gap) / (labelH + gap)))
}

export function homeLabelSize(lpp: 1 | 2 | 3 | 4 | 5 | 6) {
  const { cols, rows } = HOME_GRID[lpp]
  const pw = 8.5 - HOME_MARGIN * 2
  const ph = 11 - HOME_MARGIN * 2
  return { cols, rows, w: (pw - HOME_GAP * (cols - 1)) / cols, h: (ph - HOME_GAP * (rows - 1)) / rows }
}

function gridPage(
  bins: LabelBin[], pageW: number, pageH: number, offX: number, offY: number,
  cols: number, lw: number, lh: number, gap: number,
): PageSpec {
  return {
    w: pageW,
    h: pageH,
    labels: bins.map((bin, i) => ({
      bin,
      x: offX + (i % cols) * (lw + gap),
      y: offY + Math.floor(i / cols) * (lh + gap),
      w: lw,
      h: lh,
      layout: pickLayout(lw, lh),
    })),
  }
}

export function buildHomePages(bins: LabelBin[], lpp: 1 | 2 | 3 | 4 | 5 | 6): PageSpec[] {
  const { cols, rows, w, h } = homeLabelSize(lpp)
  return chunk(bins, cols * rows).map((pg) => gridPage(pg, 8.5, 11, HOME_MARGIN, HOME_MARGIN, cols, w, h, HOME_GAP))
}

export function buildThermalPages(bins: LabelBin[], lw: number, lh: number, mH: number, mV: number): PageSpec[] {
  const w = lw - mH * 2
  const h = lh - mV * 2
  return bins.map((bin) => ({ w: lw, h: lh, labels: [{ bin, x: mH, y: mV, w, h, layout: pickLayout(w, h) }] }))
}

export function wideLabelSize(s: WideFormatSettings) {
  const rawW = (s.sheetW - s.margin * 2 - s.gap * (s.colsAcross - 1)) / s.colsAcross
  const w = calcLabelW(s.sheetW, s.colsAcross, s.gap, s.margin)
  const h = w * WIDE_SHAPES[s.shape].ratio
  return { w, h, overflow: rawW < 0.5 }
}

export function buildWidePages(bins: LabelBin[], s: WideFormatSettings): PageSpec[] {
  const { w, h } = wideLabelSize(s)
  const perSheet = Math.max(1, s.colsAcross * wideRowsPerSheet(s.sheetLen, h, s.gap, s.margin))
  const groups = bins.length ? chunk(bins, perSheet) : [[]]
  return groups.map((pg) => {
    const rows = Math.max(1, Math.ceil((pg.length || 1) / s.colsAcross))
    const sheetH = s.autoFit ? +(rows * h + (rows - 1) * s.gap + s.margin * 2).toFixed(3) : s.sheetLen
    return gridPage(pg, s.sheetW, sheetH, s.margin, s.margin, s.colsAcross, w, h, s.gap)
  })
}

export function customLabelSize(s: CustomSettings) {
  return {
    w: (s.pageW - s.marginH * 2 - s.gap * (s.cols - 1)) / s.cols,
    h: (s.pageH - s.marginV * 2 - s.gap * (s.rows - 1)) / s.rows,
  }
}

export function buildCustomPages(bins: LabelBin[], s: CustomSettings): PageSpec[] {
  const { w, h } = customLabelSize(s)
  return chunk(bins, s.cols * s.rows).map((pg) => gridPage(pg, s.pageW, s.pageH, s.marginH, s.marginV, s.cols, w, h, s.gap))
}
