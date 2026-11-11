// Offline harness (not shipped: `files` excludes scripts/): loads the browser half of the Scratchpad bundle with a fake
// module table, React hook runtime, and Cordis client context, then asserts the
// two slot registrations and a rendered panel tree.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const PKG = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(`${PKG}/package.json`, 'utf8'))
const source = readFileSync(`${PKG}/client.js`, 'utf8')

// --- fake DOM -------------------------------------------------------------
const store = new Map()
let clipboard = ''
const win = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  navigator: { clipboard: { writeText: async (v) => { clipboard = v } } },
  setTimeout: () => 1,
  clearTimeout: () => {},
}

// --- fake React -----------------------------------------------------------
let hookSlots = []
let hookIndex = 0
function resetHooks(slots) {
  hookSlots = slots
  hookIndex = 0
}
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState(initial) {
    const i = hookIndex++
    if (hookSlots[i] === undefined) hookSlots[i] = typeof initial === 'function' ? initial() : initial
    const set = (next) => { hookSlots[i] = typeof next === 'function' ? next(hookSlots[i]) : next }
    return [hookSlots[i], set]
  },
  useRef(initial) {
    const i = hookIndex++
    if (hookSlots[i] === undefined) hookSlots[i] = { current: initial }
    return hookSlots[i]
  },
  useEffect(fn) {
    const i = hookIndex++
    const cleanup = fn()
    const entry = hookSlots[i] ?? {}
    if (typeof cleanup === 'function') entry.cleanup = cleanup
    hookSlots[i] = entry
    return undefined
  },
}

// --- module table ---------------------------------------------------------
const loaded = []
win.__ModuleLoader__ = { load: (entry) => loaded.push(entry) }
globalThis.window = win

new Function('window', source)(win)

const check = (label, condition, detail) => {
  if (!condition) {
    console.error(`FAIL  ${label}${detail === undefined ? '' : ` → ${detail}`}`)
    process.exitCode = 1
  } else {
    console.log(`ok    ${label}`)
  }
}

check('loader receives exactly one module', loaded.length === 1, loaded.length)
const entry = loaded[0]
check('factory id equals package name', entry.id === pkg.name, `${entry.id} vs ${pkg.name}`)

const mod = entry.factory((name) => (name === 'react' ? React : (() => { throw new Error(`unexpected require ${name}`) })()))
check('module exports inject', Array.isArray(mod.inject), mod.inject)
check('inject covers slots and locale', mod.inject.includes('slots') && mod.inject.includes('locale'))
check('module exports apply', typeof mod.apply === 'function')

// --- fake client context --------------------------------------------------
const registrations = []
const dictionaries = []
const effects = []
const ctx = {
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
    return dispose
  },
  locale: {
    register(ns, dicts) {
      dictionaries.push({ ns, dicts })
      return () => {}
    },
    bind(ns) {
      return (key, params) => {
        const table = dictionaries.find((d) => d.ns === ns)?.dicts.zh ?? {}
        const template = table[key] ?? key
        return params === undefined
          ? template
          : template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
      }
    },
  },
  slots: {
    inject(slot, install) {
      install()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

mod.apply(ctx)

check('one dictionary namespace registered', dictionaries.length === 1 && dictionaries[0].ns === 'scratchpad')
const dicts = dictionaries[0]?.dicts ?? {}
check('dictionary has en and zh', Boolean(dicts.en && dicts.zh), Object.keys(dicts))
const keySets = Object.values(dicts).map((d) => Object.keys(d).sort().join(','))
check('locale dictionaries share the same keys', new Set(keySets).size === 1)

const panellist = registrations.find((r) => r.options.name === 'sidebar.panellist')
const main = registrations.find((r) => r.options.name === 'main')
check('registers into sidebar.panellist', Boolean(panellist))
check('panellist registration carries id + order + locale', panellist?.options.id === 'scratchpad' && panellist?.options.order === 30 && panellist?.options.locale === 'scratchpad')
check('panellist label is locale-aware', typeof panellist?.options.label === 'function' && panellist.options.label() === '便签', panellist?.options.label?.())
check('registers into main with the same key', main?.options.key === panellist?.options.id, `${main?.options.key} vs ${panellist?.options.id}`)
check('icon component is a function', typeof panellist?.component === 'function')
check('page component is a function', typeof main?.component === 'function')

// --- icon props -----------------------------------------------------------
const icon = panellist.component({ size: 18, active: true })
check('icon renders an svg at the requested size', icon.type === 'svg' && icon.props.width === 18)
check('active icon uses the brand token', String(icon.props.stroke).includes('--dsw-alias-brand-primary'))

// --- rendered page --------------------------------------------------------
store.set('dsh-scratchpad:note', '第一行\n第二行')
resetHooks([])
const t = ctx.locale.bind('scratchpad')
const tree = main.component({ t })
const textarea = tree.children.find((c) => c.type === 'textarea')
const findButtons = (node) => {
  const out = []
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    if (n.type === 'button') out.push(n)
    if (n.children) walk(n.children)
  }
  walk(node)
  return out
}
const buttons = findButtons(tree)
const foot = tree.children.find((c) => c.type === 'div' && c.props.className === 'dshs-foot')
check('page restores the stored note', textarea?.props.value === '第一行\n第二行', JSON.stringify(textarea?.props.value))
check('textarea is labelled and has a placeholder', Boolean(textarea?.props['aria-label'] && textarea?.props.placeholder))
check('two actions render (copy, clear)', buttons.length === 2, buttons.length)
check('actions are enabled with content', buttons.every((b) => b.props.disabled === false))
check('footer shows character and line counts', foot?.children[0].children[0] === '7 字符 · 2 行', foot?.children[0].children[0])
check('style element ships the panel CSS', tree.children.some((c) => c.type === 'style' && String(c.children[0]).includes('.dshs-editor')))

// --- empty state ----------------------------------------------------------
store.delete('dsh-scratchpad:note')
resetHooks([])
const emptyTree = main.component({ t })
const emptyButtons = findButtons(emptyTree)
const emptyFoot = emptyTree.children.find((c) => c.type === 'div' && c.props.className === 'dshs-foot')
check('empty note disables both actions', emptyButtons.every((b) => b.props.disabled === true))
check('empty note reports zero lines', emptyFoot?.children[0].children[0] === '0 字符 · 0 行', emptyFoot?.children[0].children[0])

console.log(process.exitCode === 1 ? '\nharness FAILED' : '\nharness passed')
