import boldUrl from '@fontsource/arimo/files/arimo-latin-700-normal.woff?url'
import regularUrl from '@fontsource/arimo/files/arimo-latin-400-normal.woff?url'
import type { FontKey, Measurer } from './layout'

// Arimo has exactly the same metrics as Arial. Layout and the preview use Arimo; the PDF names real Arial
// (already on every Windows PC and iPhone) or, if requested, draws the glyph outlines directly.
export interface LabelFonts {
  bytes: Record<FontKey, ArrayBuffer>
  fk: Record<FontKey, FontkitFont>
  measurer: Measurer
}

export type FontkitFont = import('@pdf-lib/fontkit').Font

// Distinct family names so the label fonts never collide with the app's own fonts.
export const FONT_FAMILY: Record<FontKey, string> = {
  bold: 'SSLabelBold',
  regular: 'SSLabelRegular',
}

const URLS: Record<FontKey, string> = { bold: boldUrl, regular: regularUrl }
const WEIGHT: Record<FontKey, string> = { bold: '700', regular: '400' }
const KEYS: FontKey[] = ['bold', 'regular']

// Ligatures are off in both the PDF and the preview so measured widths match what is drawn.
export const FONT_FEATURES = { liga: false, clig: false }

let cached: Promise<LabelFonts> | null = null

export function loadLabelFonts(): Promise<LabelFonts> {
  if (!cached) {
    cached = build().catch((err) => {
      cached = null
      throw err
    })
  }
  return cached
}

async function build(): Promise<LabelFonts> {
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const buffers = await Promise.all(
    KEYS.map(async (k) => {
      const res = await fetch(URLS[k])
      if (!res.ok) throw new Error(`Could not load label font (${k})`)
      return res.arrayBuffer()
    }),
  )
  const bytes = { bold: buffers[0], regular: buffers[1] } as Record<FontKey, ArrayBuffer>
  const fk = {} as Record<FontKey, FontkitFont>
  KEYS.forEach((k) => { fk[k] = fontkit.create(new Uint8Array(bytes[k])) })

  await Promise.all(
    KEYS.map(async (k) => {
      try {
        const face = new FontFace(FONT_FAMILY[k], bytes[k].slice(0), { weight: WEIGHT[k] })
        await face.load()
        document.fonts.add(face)
      } catch {
        // preview falls back to a system font; the PDF is unaffected
      }
    }),
  )

  const emCache = new Map<string, number>()
  const emWidth = (font: FontKey, text: string) => {
    const key = `${font}|${text}`
    const hit = emCache.get(key)
    if (hit !== undefined) return hit
    const f = fk[font]
    let adv = 0
    for (const g of f.layout(text, FONT_FEATURES as never).glyphs) adv += g.advanceWidth
    const em = adv / f.unitsPerEm
    emCache.set(key, em)
    return em
  }

  const measurer: Measurer = {
    width: (font, text, size) => emWidth(font, text) * size,
    ascent: (font) => fk[font].ascent / fk[font].unitsPerEm,
    descent: (font) => -fk[font].descent / fk[font].unitsPerEm,
    capHeight: (font) => fk[font].capHeight / fk[font].unitsPerEm,
    sanitize: (font, text) => {
      const f = fk[font]
      let out = ''
      for (const ch of String(text ?? '').replace(/[\r\n\t]+/g, ' ')) {
        const cp = ch.codePointAt(0)!
        out += cp < 32 ? '' : f.hasGlyphForCodePoint(cp) ? ch : '?'
      }
      return out
    },
    ellipsis: (font) => (fk[font].hasGlyphForCodePoint(0x2026) ? '…' : '...'),
  }

  return { bytes, fk, measurer }
}
