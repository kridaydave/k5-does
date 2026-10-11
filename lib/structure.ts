// The AI seam. Today this is a dumb heuristic so the app works with zero API keys.
// Later, swap `structureCapture` for an ACP session or a direct LLM call —
// everything else in the app stays the same, because everything talks to this
// one function. That's the whole trick of an "AI-native" app: one seam.
//
// Swap plan (when you're ready):
//   1. ACP: open a session, send the raw text with a structuring prompt,
//      parse the JSON reply. (Your instinct — keeps all AI logic out of the app.)
//   2. Or a direct model API call from the server route, same prompt, same shape.
// Either way, keep the returned shape: { kind, title, body }.

export type Structured = {
  kind: 'task' | 'doc' | 'note' | 'unknown'
  title: string
  body: string
}

const TASK_WORDS = ['todo', 'task', 'remind', 'buy', 'call', 'email', 'fix', 'ship', 'pay', 'book']

export function structureCapture(raw: string): Structured {
  const text = raw.trim()
  const lower = text.toLowerCase()

  const kind: Structured['kind'] = TASK_WORDS.some((w) => lower.includes(w)) ? 'task' : 'note'

  // First sentence or ~60 chars, whichever is shorter, as the title.
  const firstSentence = text.split(/(?<=[.!?])\s/)[0]
  const title = (firstSentence.length > 60 ? firstSentence.slice(0, 57) + '…' : firstSentence) || 'Untitled'

  return { kind, title, body: text }
}
