import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import jsQR from 'jsqr'
import { X, AlertCircle } from 'lucide-react'

function extractBinId(data: string): string | null {
  try {
    const url = new URL(data)
    if (url.origin !== window.location.origin) return null
    const match = url.pathname.match(/^\/bin\/([^/]+)$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export default function ScanPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>()
  const lastInvalidRef = useRef<{ data: string; at: number } | null>(null)
  const [error, setError] = useState('')

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    function tick() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { rafRef.current = requestAnimationFrame(tick); return }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height)

      if (code?.data) {
        const binId = extractBinId(code.data)
        if (binId) {
          stopCamera()
          navigate(`/bin/${binId}`)
          return
        }
        const now = Date.now()
        if (lastInvalidRef.current?.data !== code.data || now - lastInvalidRef.current.at > 2000) {
          lastInvalidRef.current = { data: code.data, at: now }
          setError("That doesn't look like a StorageSync bin label.")
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is not supported in this browser.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch {
        if (!cancelled) setError('Camera access was denied. Enable it in your browser settings to scan labels.')
      }
    }

    start()
    return () => { cancelled = true; stopCamera() }
  }, [navigate, stopCamera])

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="font-display font-semibold">Scan a bin label</span>
        <button onClick={() => { stopCamera(); navigate(-1) }} className="p-2 -mr-2" aria-label="Close scanner">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-56 w-56 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>

        {error && (
          <div className="absolute bottom-6 left-4 right-4 flex items-start gap-2 bg-destructive/90 text-destructive-foreground rounded-lg px-4 py-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
