// Test fixture: re-export the pure model/state modules under test so the
// `pretest` esbuild step can bundle them (with their TS deps) into a single
// .mjs that the node:test runner imports. Keeps the core logic under CI without
// a TS test-runner dependency.
export * as codec from '../../src/model/wave-codec'
export * as actions from '../../src/state/actions'
export * as wj from '../../src/model/wavejson'
export * as pwl from '../../src/model/pwl'
export * as i18n from '../../src/i18n'
