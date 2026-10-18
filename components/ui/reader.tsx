'use client'

import { useRef, type ReactNode } from 'react'
import {
  GlassScene,
  GlassContent,
  GlassButton,
  GlassScrollEdges,
} from '@glass-sdk/liquid-glass'
import '@glass-sdk/liquid-glass/styles.css'

export function Reader({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <GlassScene material="clear" appearance="dark" style={{ height: 390, overflow: 'hidden' }}>
      <GlassContent layout="scroll" ref={scrollRef} tabIndex={0} role="region"
        aria-label="Article" style={{ scrollPaddingBlock: 110 }}>
        {children}
      </GlassContent>
      <GlassScrollEdges target={scrollRef} size={110} blur={20} />
      <GlassButton size="icon" aria-label="Back"
        style={{ position: 'absolute', top: 14, left: 16 }}>‹</GlassButton>
    </GlassScene>
  )
}
