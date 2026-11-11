window.__ModuleLoader__.load({
  id: '@local/dsh-scratchpad',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace and the panel key shared by both registrations. */
    const NS = 'scratchpad'
    const PANEL_ID = 'scratchpad'

    /** Browser-local note storage; one note per browser. */
    const STORE_KEY = 'dsh-scratchpad:note'
    const SAVE_DELAY_MS = 350
    const FLASH_MS = 1500
    const CONFIRM_MS = 3000

    const DICTIONARIES = {
      en: {
        panel: 'Scratchpad',
        title: 'Scratchpad',
        subtitle: 'Jot anything down. It stays in this browser and is saved as you type.',
        placeholder: 'Write something to keep for later…',
        copy: 'Copy',
        copied: 'Copied',
        clear: 'Clear',
        confirmClear: 'Click again to clear',
        stats: '{chars} characters · {lines} lines',
        saved: 'Saved in this browser',
        saveFailed: 'This browser refused local storage; the note is not saved',
      },
      zh: {
        panel: '便签',
        title: '便签',
        subtitle: '随手记点什么，内容保存在本机浏览器，边写边存。',
        placeholder: '写下想留到下次的东西…',
        copy: '复制',
        copied: '已复制',
        clear: '清空',
        confirmClear: '再点一次清空',
        stats: '{chars} 字符 · {lines} 行',
        saved: '已保存在本机浏览器',
        saveFailed: '本机浏览器拒绝写入，便签未保存',
      },
    }

    function readNote() {
      try {
        return window.localStorage.getItem(STORE_KEY) ?? ''
      } catch {
        return ''
      }
    }

    function writeNote(value) {
      try {
        window.localStorage.setItem(STORE_KEY, value)
        return true
      } catch {
        return false
      }
    }

    async function copyText(value) {
      try {
        await window.navigator.clipboard.writeText(value)
        return true
      } catch {
        return false
      }
    }

    /** Left-sidebar glyph; `active` marks the currently displayed panel. */
    function ScratchpadIcon(props) {
      const size = props.size ?? 16
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: props.active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M5 4.75h9.5L19 9.25v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1Z' }),
        h('path', { d: 'M14 4.75v4.5h4.5' }),
        h('path', { d: 'M8 13.5h6.5M8 17h4' }),
      )
    }

    const CSS = `
.dshs-page{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:12px;
  padding:calc(var(--dsh-frame-top-clearance,0px) + 24px) clamp(20px,4vw,40px) 28px;
  color:var(--dsw-alias-label-primary)}
.dshs-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
  width:100%;max-width:960px}
.dshs-heading{min-width:0}
.dshs-title{margin:0;font-size:16px;line-height:24px;font-weight:600}
.dshs-sub{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dshs-actions{display:flex;align-items:center;gap:8px;flex:none}
.dshs-btn{height:28px;padding:0 10px;box-sizing:border-box;border-radius:8px;cursor:pointer;
  border:0.5px solid var(--dsw-alias-border-l2);background:transparent;
  color:var(--dsw-alias-label-primary);font-size:12px;line-height:26px;font-family:inherit}
.dshs-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}
.dshs-btn:active:enabled{background:var(--dsw-alias-interactive-bg-active)}
.dshs-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshs-btn:disabled{opacity:.45;cursor:default}
.dshs-btn[data-danger]{color:var(--dsw-alias-state-error-primary)}
.dshs-editor{width:100%;max-width:960px;flex:1;min-height:120px;box-sizing:border-box;resize:none;
  padding:16px;border-radius:12px;border:0.5px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  font-family:inherit;font-size:14px;line-height:22px;
  caret-color:var(--dsw-alias-brand-primary)}
.dshs-editor::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshs-editor:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dshs-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;
  width:100%;max-width:960px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dshs-hint[data-state='failed']{color:var(--dsw-alias-state-error-primary)}
`

    function ScratchpadPage(props) {
      const t = props.t ?? ((key) => key)
      const [text, setText] = React.useState(readNote)
      const [saveState, setSaveState] = React.useState('idle')
      const [copied, setCopied] = React.useState(false)
      const [confirmClear, setConfirmClear] = React.useState(false)
      const copyTimer = React.useRef(0)
      const clearTimer = React.useRef(0)
      const mounted = React.useRef(false)

      React.useEffect(
        () => () => {
          window.clearTimeout(copyTimer.current)
          window.clearTimeout(clearTimer.current)
        },
        [],
      )

      React.useEffect(() => {
        if (!mounted.current) {
          mounted.current = true
          return undefined
        }
        const id = window.setTimeout(() => setSaveState(writeNote(text) ? 'saved' : 'failed'), SAVE_DELAY_MS)
        return () => window.clearTimeout(id)
      }, [text])

      const chars = [...text].length
      const lines = text === '' ? 0 : text.split('\n').length
      const empty = chars === 0

      const onCopy = async () => {
        if (!(await copyText(text))) return
        setCopied(true)
        window.clearTimeout(copyTimer.current)
        copyTimer.current = window.setTimeout(() => setCopied(false), FLASH_MS)
      }

      const onClear = () => {
        if (!confirmClear) {
          setConfirmClear(true)
          window.clearTimeout(clearTimer.current)
          clearTimer.current = window.setTimeout(() => setConfirmClear(false), CONFIRM_MS)
          return
        }
        window.clearTimeout(clearTimer.current)
        setConfirmClear(false)
        setText('')
      }

      const hint = saveState === 'failed' ? t('saveFailed') : saveState === 'saved' ? t('saved') : ''

      return h(
        'div',
        { className: 'dshs-page' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dshs-head' },
          h(
            'div',
            { className: 'dshs-heading' },
            h('h1', { className: 'dshs-title' }, t('title')),
            h('p', { className: 'dshs-sub' }, t('subtitle')),
          ),
          h(
            'div',
            { className: 'dshs-actions' },
            h(
              'button',
              { type: 'button', className: 'dshs-btn', disabled: empty, onClick: onCopy },
              copied ? t('copied') : t('copy'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dshs-btn',
                disabled: empty,
                'data-danger': confirmClear ? '' : undefined,
                onClick: onClear,
              },
              confirmClear ? t('confirmClear') : t('clear'),
            ),
          ),
        ),
        h('textarea', {
          className: 'dshs-editor',
          value: text,
          placeholder: t('placeholder'),
          'aria-label': t('title'),
          spellCheck: false,
          onChange: (event) => setText(event.target.value),
        }),
        h(
          'div',
          { className: 'dshs-foot' },
          h('span', null, t('stats', { chars, lines })),
          h('span', { className: 'dshs-hint', role: 'status', 'data-state': saveState }, hint),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-scratchpad: dictionaries')

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              locale: NS,
              label: () => ctx.locale.bind(NS)('panel'),
            },
            ScratchpadIcon,
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t: ctx.locale.bind(NS) }),
            },
            ScratchpadPage,
          ),
        )
      },
    }
  },
})
