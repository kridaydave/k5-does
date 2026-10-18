"use client"

import { useEffect, useRef } from "react"
import { cn } from "./lib"
import { rgb } from "./palette"
import {
  BAYER4,
  fillOf,
  pixelPrefersReducedMotion,
  type PixelBloom,
  type PixelColor,
  pixelBloomStyle,
} from "./pixel"

// Backing-resolution caps — a background wash never needs more cells than this.
const MAX_COLS = 960
const MAX_ROWS = 600

export type GradientDirection = "up" | "down" | "left" | "right"

export type DitherGradientProps = {
  /** The colour the gradient starts solid as — a palette name or a hue. */
  from: PixelColor
  /** What it dissolves into: another colour for a two-tone dither blend, or
   * "transparent" (default) so the background shows through. */
  to?: PixelColor | "transparent"
  /** Where `to` ends up — "up" reads as a glow rising from the bottom edge. */
  direction?: GradientDirection
  /** CSS px per dither cell — bigger is chunkier. */
  cell?: number
  /** Overall opacity multiplier. */
  opacity?: number
  /** Glow on the dither fill. */
  bloom?: PixelBloom
  /** Hue drift speed in hue-degrees per second. 0 (default) = static.
   * Only applies when `from` is a hue number or "rainbow" — palette names
   * stay fixed. Respects prefers-reduced-motion (never animates). */
  animate?: number
  className?: string
}

type PaintSpec = {
  from: PixelColor
  to: PixelColor | "transparent"
  direction: GradientDirection
  cell: number
  opacity: number
  /** Phase offset 0–1: slides the dither threshold so the pattern shimmers.
   * Applied as a Bayer-matrix offset, not a repaint of the ramp. */
  phase?: number
  /** Travelling-wave offset 0–1: shifts the ramp position itself, so the
   * dense band visibly drifts along `direction` instead of just breathing
   * in place. 0 = pinned (shimmer only). */
  drift?: number
}

/**
 * Paint the ordered-dither ramp onto a low-res backing canvas sized from the
 * wrapper's box. Static — one paint per prop/size change, no animation loop,
 * so it's free to use as a page-wide background.
 */
function paintGradient(
  canvas: HTMLCanvasElement,
  bloomCanvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  spec: PaintSpec
): void {
  const ctx = canvas.getContext("2d")
  if (!ctx || width <= 0 || height <= 0) return
  const cols = Math.min(MAX_COLS, Math.max(4, Math.round(width / spec.cell)))
  const rows = Math.min(MAX_ROWS, Math.max(4, Math.round(height / spec.cell)))
  canvas.width = cols
  canvas.height = rows

  const fromFill = fillOf(spec.from)
  const toFill = spec.to === "transparent" ? null : fillOf(spec.to)
  const o = spec.opacity
  const phase = ((spec.phase ?? 0) % 1 + 1) % 1
  // Drift slides the whole ramp: the dense edge travels along `direction`
  // and wraps, so the band visibly moves instead of breathing in place.
  const drift = ((spec.drift ?? 0) % 1 + 1) % 1

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // t runs 0 at the `from` edge → 1 at the `to` edge, then wraps by
      // drift so the gradient position itself travels.
      const raw =
        spec.direction === "up"
          ? 1 - (y + 0.5) / rows
          : spec.direction === "down"
            ? (y + 0.5) / rows
            : spec.direction === "left"
              ? 1 - (x + 0.5) / cols
              : (x + 0.5) / cols
      const t = (raw + drift) % 1
      const density = 1 - t
      // Phase slides which cells light: the threshold breathes ±1/16 around
      // the static cut, so the pattern shimmers without moving the ramp.
      const lit = density + (phase - 0.5) / 8 > BAYER4[y & 3][x & 3]
      if (toFill) {
        // Two-tone: every cell is painted, the dither decides which colour.
        ctx.fillStyle = rgb(lit ? fromFill : toFill, 1, o)
        ctx.fillRect(x, y, 1, 1)
      } else {
        // Dissolve to transparent: lit cells carry the ramp, off cells keep a
        // faint tint that also fades out, so the falloff reads smooth.
        const alpha = (lit ? 0.35 + 0.65 * density : 0.12 * density) * o
        if (alpha <= 0.004) continue
        ctx.fillStyle = rgb(fromFill, 1, alpha)
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }

  const bloomCtx = bloomCanvas?.getContext("2d") ?? null
  if (bloomCanvas && bloomCtx) {
    bloomCanvas.width = cols
    bloomCanvas.height = rows
    bloomCtx.drawImage(canvas, 0, 0)
  }
}

/**
 * Dithered gradient wash — the charts' ordered-dither texture as a background.
 * Fills its nearest positioned ancestor (footer glows, section fades, card
 * backdrops). Dissolves to transparent by default, or dither-blends between
 * two colours when `to` is set. Pass `animate` for a slow shimmer: the Bayer
 * threshold breathes via requestAnimationFrame, off when the tab is hidden
 * or the user prefers reduced motion.
 */
export function DitherGradient({
  from,
  to = "transparent",
  direction = "up",
  cell = 3,
  opacity = 1,
  bloom = "off",
  animate = 0,
  drift = 0,
  className,
}: DitherGradientProps & {
  /** Ramp travel speed in ramp-lengths per second. 0 (default) = pinned —
   * the pattern shimmers in place. Set with `animate` for a visibly
   * travelling band. Also gated on prefers-reduced-motion. */
  drift?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)
  // Mutable paint args the rAF loop reads without re-subscribing. Written in
  // an effect so render stays pure (no ref write during render).
  const specRef = useRef({ from, to, direction, cell, opacity, animate, drift })
  useEffect(() => {
    specRef.current = { from, to, direction, cell, opacity, animate, drift }
  })

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    let box = wrap.getBoundingClientRect()
    let raf = 0
    let last = performance.now()

    const paint = (phase: number, drift: number) => {
      const s = specRef.current
      const hue =
        typeof s.from === "number"
          ? s.from + phase * 360
          : s.from === ("rainbow" as PixelColor)
            ? phase * 360
            : null
      paintGradient(canvas, bloomRef.current, box.width, box.height, {
        from: hue ?? (s.from as PixelColor),
        to: s.to,
        direction: s.direction,
        cell: s.cell,
        opacity: s.opacity,
        phase,
        drift,
      })
    }

    // Static path: one paint per prop/size change, no loop — same as before.
    if (!animate || pixelPrefersReducedMotion()) {
      paint(0, 0)
      if (typeof ResizeObserver === "undefined") return
      const ro = new ResizeObserver(() => {
        box = wrap.getBoundingClientRect()
        paint(0, 0)
      })
      ro.observe(wrap)
      return () => ro.disconnect()
    }

    // Animated path: phase advances at `animate` cycles/sec and drift travels
    // the ramp at `drift` ramp-lengths/sec. Backing canvas is tiny (cell 4
    // over a 40px-tall strip ≈ 100×10), so 30fps repaints are cheap.
    // Pauses when the tab hides via rAF semantics; never runs when the user
    // prefers reduced motion.
    const FRAME_MS = 1000 / 30
    let phase = 0
    let travel = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      phase = (phase + dt * animate) % 1
      travel = (travel + dt * drift) % 1
      box = wrap.getBoundingClientRect()
      if (box.width > 0 && box.height > 0) paint(phase, travel)
      raf = window.setTimeout(() => requestAnimationFrame(tick), FRAME_MS) as unknown as number
    }
    raf = requestAnimationFrame(tick) as unknown as number
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(raf)
    }
    // Mount-only: the loop reads live props via specRef, so re-subscribing
    // on prop change would just restart the phase for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bloomStyle = pixelBloomStyle(bloom)

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
      {bloomStyle && (
        <canvas
          ref={bloomRef}
          className="absolute inset-0 h-full w-full"
          style={bloomStyle}
        />
      )}
    </div>
  )
}
