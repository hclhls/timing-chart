// Starter examples a novice can load and tweak ("近い例を改造" beats blank).
import type { WaveJson } from './model/wavejson'

export interface Example {
  id: string
  name: string
  model: WaveJson
}

export const EXAMPLES: Example[] = [
  {
    id: 'clk-data',
    name: 'クロック＋データ',
    model: {
      signal: [
        { name: 'クロック', wave: 'P.P.P.P.' },
        { name: 'データ', wave: '0.1.0.1.' },
      ],
      config: { hscale: 1 },
    },
  },
  {
    id: 'handshake',
    name: '要求／応答（ハンドシェイク）',
    model: {
      signal: [
        { name: 'クロック', wave: 'P.....' },
        { name: '要求', wave: '0.1..0', node: '..a..b' },
        { name: '応答', wave: '0..1.0' },
      ],
      edge: ['a~>b'],
      config: { hscale: 1 },
    },
  },
  {
    id: 'bus',
    name: 'バス転送',
    model: {
      signal: [
        { name: 'クロック', wave: 'P.....' },
        { name: 'アドレス', wave: 'x=.=.x', data: ['A0', 'A1'] },
        { name: 'データ', wave: 'x..=.x', data: ['D0'] },
      ],
      config: { hscale: 1 },
    },
  },
  {
    id: 'spi',
    name: 'SPI（通信）',
    // 1クロック＝1ビットで揃えた最小例（CSはアクティブLow）。
    model: {
      signal: [
        { name: 'SCLK', wave: '0pppp0' },
        { name: 'CS', wave: '100001' },
        { name: 'MOSI', wave: 'x====x', data: ['b3', 'b2', 'b1', 'b0'] },
      ],
      config: { hscale: 2 },
    },
  },
]
