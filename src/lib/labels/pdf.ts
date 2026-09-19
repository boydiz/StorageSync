import {
  PDFDocument, PDFDict, PDFName, PDFNumber, PDFOperator, PDFRef, PDFPage, PDFHexString,
  pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, moveText, showText,
  moveTo, lineTo, appendBezierCurve, closePath, stroke, fill, setLineWidth, rectangle,
  setFillingRgbColor, setStrokingRgbColor, setFillingGrayscaleColor,
} from 'pdf-lib'
import { FONT_FEATURES, type FontkitFont, type LabelFonts } from './fonts'
import { cutContourPrim, hexToRgb01, layoutLabel, type FontKey, type Prim, type Seg } from './layout'
import type { PageSpec } from './jobs'

export interface PdfOptions {
  cut: { enabled: boolean; offset: number; color: string; swatchName: string }
  black: { spot: boolean; swatchName: string }
  outlineText: boolean
}

const PT = 72
const FONT_KEYS: FontKey[] = ['bold', 'regular']
const op = (name: string, args: Array<PDFName | PDFNumber> = []) => PDFOperator.of(name as never, args)

function rgbToCmyk([r, g, b]: [number, number, number]): number[] {
  const k = 1 - Math.max(r, g, b)
  if (k >= 1) return [0, 0, 0, 1]
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k]
}

function addSeparation(doc: PDFDocument, name: string, alt: number[]): PDFRef {
  const ctx = doc.context
  const fn = ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: alt, N: 1 })
  return ctx.register(ctx.obj([PDFName.of('Separation'), PDFName.of(name), PDFName.of('DeviceCMYK'), fn]))
}

function registerColorSpace(doc: PDFDocument, page: PDFPage, key: string, ref: PDFRef) {
  const res = page.node.Resources()!
  let dict = res.lookupMaybe(PDFName.of('ColorSpace'), PDFDict)
  if (!dict) {
    dict = doc.context.obj({})
    res.set(PDFName.of('ColorSpace'), dict)
  }
  dict.set(PDFName.of(key), ref)
}

// ── Windows-1252 ("WinAnsi") text encoding for the un-embedded Arial font ─────────────────────────
const WIN_ANSI = (() => {
  const dec = new TextDecoder('windows-1252')
  const chars: string[] = []
  const toCode = new Map<string, number>()
  for (let c = 32; c <= 255; c++) {
    const ch = dec.decode(Uint8Array.of(c))
    chars[c] = ch
    if (!toCode.has(ch)) toCode.set(ch, c)
  }
  return { chars, toCode }
})()

function winAnsiHex(text: string): PDFHexString {
  let hex = ''
  for (const ch of text) hex += (WIN_ANSI.toCode.get(ch) ?? 63).toString(16).padStart(2, '0')
  return PDFHexString.of(hex)
}

// A TrueType font dictionary that names Arial without embedding it. Windows, macOS and iOS all ship Arial,
// and Illustrator matches it by name, so the text stays live and editable with nothing to install.
// Widths come from Arimo, which has identical metrics.
function addArialReference(doc: PDFDocument, bold: boolean, fk: FontkitFont): PDFRef {
  const ctx = doc.context
  const name = bold ? 'Arial-BoldMT' : 'ArialMT'
  const widths: number[] = []
  for (let c = 32; c <= 255; c++) {
    let width: number
    try {
      width = Math.round((fk.glyphForCodePoint(WIN_ANSI.chars[c].codePointAt(0)!).advanceWidth / fk.unitsPerEm) * 1000)
    } catch {
      width = widths[0] ?? 278
    }
    widths.push(width)
  }
  const descriptor = ctx.register(ctx.obj({
    Type: 'FontDescriptor', FontName: name, Flags: 32,
    FontBBox: bold ? [-628, -376, 2000, 1010] : [-665, -325, 2000, 1006],
    ItalicAngle: 0, Ascent: 905, Descent: -212, CapHeight: 716, StemV: bold ? 136 : 88,
  }))
  return ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'TrueType', BaseFont: name, Encoding: 'WinAnsiEncoding',
    FirstChar: 32, LastChar: 255, Widths: widths, FontDescriptor: descriptor,
  }))
}

function pathOps(segs: Seg[], map: (x: number, y: number) => [number, number]): PDFOperator[] {
  const out: PDFOperator[] = []
  for (const s of segs) {
    if (s[0] === 'M') out.push(moveTo(...map(s[1], s[2])))
    else if (s[0] === 'L') out.push(lineTo(...map(s[1], s[2])))
    else if (s[0] === 'C') {
      const [x1, y1] = map(s[1], s[2])
      const [x2, y2] = map(s[3], s[4])
      const [x, y] = map(s[5], s[6])
      out.push(appendBezierCurve(x1, y1, x2, y2, x, y))
    } else out.push(closePath())
  }
  return out
}

interface RawCommand { command: string; args: number[] }

// Text as filled glyph outlines, for the "Outline text" option (no fonts needed at all).
function outlineOps(
  fk: FontkitFont, text: string, size: number, x: number, y: number,
  map: (x: number, y: number) => [number, number],
): PDFOperator[] {
  const scale = size / fk.unitsPerEm
  const ops: PDFOperator[] = []
  let pen = 0
  for (const g of fk.layout(text, FONT_FEATURES as never).glyphs) {
    const pt = (fx: number, fy: number) => map(x + pen + fx * scale, y - fy * scale)
    let cx = 0
    let cy = 0
    for (const c of (g.path as unknown as { commands: RawCommand[] }).commands) {
      const a = c.args
      if (c.command === 'moveTo') { ops.push(moveTo(...pt(a[0], a[1]))); cx = a[0]; cy = a[1] }
      else if (c.command === 'lineTo') { ops.push(lineTo(...pt(a[0], a[1]))); cx = a[0]; cy = a[1] }
      else if (c.command === 'quadraticCurveTo') {
        const [qx, qy, ex, ey] = a
        const c1 = pt(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy))
        const c2 = pt(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey))
        const e = pt(ex, ey)
        ops.push(appendBezierCurve(c1[0], c1[1], c2[0], c2[1], e[0], e[1]))
        cx = ex; cy = ey
      } else if (c.command === 'bezierCurveTo') {
        const c1 = pt(a[0], a[1])
        const c2 = pt(a[2], a[3])
        const e = pt(a[4], a[5])
        ops.push(appendBezierCurve(c1[0], c1[1], c2[0], c2[1], e[0], e[1]))
        cx = a[4]; cy = a[5]
      } else if (c.command === 'closePath') ops.push(closePath())
    }
    pen += g.advanceWidth * scale
  }
  return ops
}

export async function buildPdf(pages: PageSpec[], fonts: LabelFonts, opts: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('StorageSync labels')
  doc.setCreator('StorageSync')

  const fontRefs = {} as Record<FontKey, PDFRef>
  if (!opts.outlineText) {
    for (const k of FONT_KEYS) fontRefs[k] = addArialReference(doc, k === 'bold', fonts.fk[k])
  }

  const cutRef = opts.cut.enabled
    ? addSeparation(doc, opts.cut.swatchName || 'CutContour', rgbToCmyk(hexToRgb01(opts.cut.color)))
    : null
  const inkRef = opts.black.spot ? addSeparation(doc, opts.black.swatchName || 'RVW-BK22A', [0, 0, 0, 1]) : null

  const inkFill = (): PDFOperator[] =>
    inkRef ? [op('cs', [PDFName.of('CSInk')]), op('scn', [PDFNumber.of(1)])] : [setFillingGrayscaleColor(0)]

  for (const spec of pages) {
    const page = doc.addPage([spec.w * PT, spec.h * PT])
    if (cutRef) registerColorSpace(doc, page, 'CSCut', cutRef)
    if (inkRef) registerColorSpace(doc, page, 'CSInk', inkRef)
    const fontKeys = {} as Record<FontKey, PDFName>
    if (!opts.outlineText) {
      for (const k of FONT_KEYS) fontKeys[k] = page.node.newFontDictionary(k === 'bold' ? 'ArialB' : 'ArialR', fontRefs[k])
    }

    const ops: PDFOperator[] = []
    for (const placed of spec.labels) {
      const draw = layoutLabel(placed.bin, placed.w, placed.h, placed.layout, fonts.measurer)
      const prims: Prim[] = [...draw.prims]
      if (cutRef) prims.push(cutContourPrim(placed.w, placed.h, opts.cut.offset))
      const map = (x: number, y: number): [number, number] => [(placed.x + x) * PT, (spec.h - (placed.y + y)) * PT]

      for (const p of prims) {
        if (p.t === 'stripe') {
          ops.push(pushGraphicsState(), setFillingRgbColor(...hexToRgb01(p.fill)), ...pathOps(p.path, map), fill(), popGraphicsState())
        } else if (p.t === 'outline') {
          ops.push(
            pushGraphicsState(), setStrokingRgbColor(...hexToRgb01(p.stroke)), setLineWidth(p.sw * PT),
            ...pathOps(p.path, map), stroke(), popGraphicsState(),
          )
        } else if (p.t === 'cut') {
          ops.push(
            pushGraphicsState(), op('CS', [PDFName.of('CSCut')]), op('SCN', [PDFNumber.of(1)]), setLineWidth(p.sw * PT),
            ...pathOps(p.path, map), stroke(), popGraphicsState(),
          )
        } else if (p.t === 'text') {
          if (opts.outlineText) {
            ops.push(pushGraphicsState(), ...inkFill(), ...outlineOps(fonts.fk[p.font], p.text, p.size, p.x, p.y, map), fill(), popGraphicsState())
          } else {
            const [tx, ty] = map(p.x, p.y)
            ops.push(
              pushGraphicsState(), ...inkFill(),
              beginText(), setFontAndSize(fontKeys[p.font], p.size * PT), moveText(tx, ty),
              showText(winAnsiHex(p.text)), endText(),
              popGraphicsState(),
            )
          }
        } else if (p.t === 'qr') {
          const n = p.matrix.length
          const ms = p.size / n
          ops.push(pushGraphicsState(), ...inkFill())
          for (let r = 0; r < n; r++) {
            let c = 0
            while (c < n) {
              if (!p.matrix[r][c]) { c++; continue }
              let end = c
              while (end < n && p.matrix[r][end]) end++
              const [x, y] = map(p.x + c * ms, p.y + (r + 1) * ms)
              ops.push(rectangle(x, y, (end - c) * ms * PT, ms * PT))
              c = end
            }
          }
          ops.push(fill(), popGraphicsState())
        }
      }
    }
    page.pushOperators(...ops)
  }

  return doc.save({ useObjectStreams: false })
}
