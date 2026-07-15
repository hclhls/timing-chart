import type { WaveJson } from '../model/wavejson'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  message: string
  model: WaveJson
  history?: ChatMessage[]
}

export interface ChatProposal {
  message: string
  model: WaveJson
  warnings: string[]
}
