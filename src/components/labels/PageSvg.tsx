import { useMemo } from 'react'
import { FONT_FAMILY } from '@/lib/labels/fonts'
import { cutContourPrim, layoutLabel, safeColor, type Measurer, type Prim, type Seg } from '@/lib/labels/layout'
import type { PageSpec } from '@/lib/labels/jobs'

const n = (v: number) => +v.toFixed(4)

function pathD(segs: Seg[]): string {
  return segs
    .map((s) => (s[0] === 'Z' ? 'Z' : `${s[0]}${s.slice(1).map((v) => n(v as number)).join(' ')}`))
    .join(' ')
}

function qrD(x: number, y: number, size: number, matrix: boolean[][]): string {
  const cells = matrix.length
  const ms = size / cells
  let d = ''
  for (let r = 0; r < cells; r++) {
    let c = 0
    while (c < cells) {
      if (!matrix[r][c]) { c++; continue }
      let end = c
      while (end < cells && matrix[r][end]) end++
      d += `M${n(x + c * ms)} ${n(y + r * ms)}h${n((end - c) * ms)}v${n(ms)}h${n(-(end - c) * ms)}z`
      c = end
    }
  }
  return d
}

function PrimSvg({ p, cutColor }: { p: Prim; cutColor: string }) {
  switch (p.t) {
    case 'stripe':
      return <path d={pathD(p.path)} fill={p.fill} />
    case 'outline':
      return <path d={pathD(p.path)} fill="none" stroke={p.stroke} strokeWidth={p.sw} />
    case 'cut':
      return <path d={pathD(p.path)} fill="none" stroke={cutColor} strokeWidth={p.sw} />
    case 'qr':
      return <path d={qrD(p.x, p.y, p.size, p.matrix)} fill="#0f172a" shapeRendering="crispEdges" />
    case 'text':
      return (
        <text
          x={p.x}
          y={p.y}
          fontSize={p.size}
          fill="#0f172a"
          fontFamily={`${FONT_FAMILY[p.font]}, sans-serif`}
          textRendering="geometricPrecision"
          style={{ fontVariantLigatures: 'none', fontKerning: 'none' }}
        >
          {p.text}
        </text>
      )
  }
}

export function PageSvg({ page, measurer, cut }: {
  page: PageSpec
  measurer: Measurer
  cut: { enabled: boolean; offset: number; color: string }
}) {
  const cutColor = safeColor(cut.color)
  const labels = useMemo(
    () => page.labels.map((l) => ({ l, draw: layoutLabel(l.bin, l.w, l.h, l.layout, measurer) })),
    [page, measurer],
  )
  return (
    <svg
      viewBox={`0 0 ${page.w} ${page.h}`}
      style={{ width: '100%', height: 'auto', display: 'block', background: 'white', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
    >
      {labels.map(({ l, draw }) => (
        <g key={l.bin.id} transform={`translate(${n(l.x)} ${n(l.y)})`}>
          {draw.prims.map((p, i) => <PrimSvg key={i} p={p} cutColor={cutColor} />)}
          {cut.enabled && <PrimSvg p={cutContourPrim(l.w, l.h, cut.offset)} cutColor={cutColor} />}
        </g>
      ))}
    </svg>
  )
}
