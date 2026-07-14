import { test } from 'node:test'
import assert from 'node:assert/strict'
import { i18n } from './_bundles/lib.mjs'

test('detectLanguage prefers persisted valid language', () => {
  assert.equal(i18n.resolveLanguage(['zh-TW', 'en-US'], 'en'), 'en')
  assert.equal(i18n.resolveLanguage(['en-US'], 'zh-TW'), 'zh-TW')
  assert.equal(i18n.resolveLanguage(['en-US'], 'ja'), 'ja')
})

test('detectLanguage maps Traditional Chinese browser locales to zh-TW', () => {
  assert.equal(i18n.resolveLanguage(['zh-Hant-TW', 'en-US']), 'zh-TW')
  assert.equal(i18n.resolveLanguage(['zh-HK', 'en-US']), 'zh-TW')
  assert.equal(i18n.resolveLanguage(['zh-TW']), 'zh-TW')
})

test('detectLanguage defaults to Japanese unless Traditional Chinese or persisted language is present', () => {
  assert.equal(i18n.resolveLanguage(['ja-JP']), 'ja')
  assert.equal(i18n.resolveLanguage(['zh-CN', 'en-US']), 'ja')
  assert.equal(i18n.resolveLanguage([]), 'ja')
})

test('dictionaries expose the same key count', () => {
  assert.equal(i18n.dictionaryKeyCount('en'), i18n.dictionaryKeyCount('zh-TW'))
  assert.equal(i18n.dictionaryKeyCount('en'), i18n.dictionaryKeyCount('ja'))
  assert.ok(i18n.dictionaryKeyCount('en') > 100)
})

test('translate formats representative dynamic messages', () => {
  assert.equal(i18n.translate('en', 'toolbar.pngScaled', { scale: '1.5' }), 'Chart was large, so it was exported at 1.5x.')
  assert.equal(i18n.translate('zh-TW', 'toolbar.pngScaled', { scale: '1.5' }), '圖表太大，已改以 1.5x 匯出。')
  assert.equal(i18n.translate('ja', 'toolbar.pngScaled', { scale: '1.5' }), '図が大きいため 1.5× で書き出しました（上限による調整）')
  assert.equal(i18n.translate('en', 'bus.noSegments', { name: 'data' }), '"data" has no bus segments. Paint cells with "Bus value" to create them.')
  assert.equal(i18n.translate('zh-TW', 'bus.noSegments', { name: 'data' }), '「data」沒有匯流排區段。用「匯流排值」狀態塗格即可建立。')
  assert.equal(i18n.translate('ja', 'bus.noSegments', { name: 'data' }), '「data」にバス区間はありません。状態「バス（値）」でマスを塗ると作れます。')
})
