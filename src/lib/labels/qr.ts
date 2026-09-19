import qrcode from 'qrcode-generator'

const cache = new Map<string, boolean[][]>()

export function qrMatrix(text: string): boolean[][] {
  const hit = cache.get(text)
  if (hit) return hit
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const rows: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c))
    rows.push(row)
  }
  cache.set(text, rows)
  return rows
}
