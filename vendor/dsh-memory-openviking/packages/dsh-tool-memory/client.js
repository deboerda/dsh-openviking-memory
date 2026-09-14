/**
 * @deepseek-ai/dsh-tool-memory — browser half: the plugin configuration card
 * shown in 设置 → 插件配置 (the `settings.plugin.item` slot).
 *
 * Mirrors the official plugin-card pattern (same structure, CSS-variable
 * theming, zh/en locale and staged-save transport as dsh-vision-primitives).
 * Edits the `section` (profile injection) and `dynamic` (per-input targeted
 * injection) groups of the `tool-memory` row config.
 *
 * Loaded by dsh-client-modules as `/plugins/@deepseek-ai/dsh-tool-memory/client.js`
 * (declared via package.json `dsh.client` + `exports["./client"]`).
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-tool-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useSyncExternalStore = react.useSyncExternalStore

    /** Namespace of the tool-memory settings section. */
    var NS = 'tool-memory'
    var css = ''

    function num(v, dflt) {
      if (v === undefined || v === null || v === '') return dflt
      var n = Number(v)
      return Number.isFinite(n) ? n : dflt
    }

    function field(id, label, hint, value, onChange, opts) {
      return h('label', { className: 'mtm-field', key: id }, [
        h('span', { className: 'mtm-label' }, label),
        h('input', {
          className: 'mtm-input',
          type: opts && opts.secret ? 'password' : 'text',
          value: value == null ? '' : String(value),
          placeholder: opts && opts.placeholder ? opts.placeholder : '',
          disabled: opts && opts.disabled,
          onChange: (e) => onChange(e.target.value)
        }),
        hint ? h('span', { className: 'mtm-hint' }, hint) : null
      ])
    }

    function checkbox(id, label, hint, checked, onChange) {
      return h('label', { className: 'mtm-check', key: id }, [
        h('input', {
          type: 'checkbox',
          checked: !!checked,
          onChange: (e) => onChange(e.target.checked)
        }),
        h('span', { className: 'mtm-label' }, label),
        hint ? h('span', { className: 'mtm-hint' }, hint) : null
      ])
    }

    /** Collapsible subsection grouping related fields. */
    function group(id, title, open, setOpen, children) {
      return h('div', { className: 'mtm-group' + (open ? ' mtm-group-open' : ''), key: id }, [
        h('button', {
          type: 'button',
          className: 'mtm-group-head',
          'aria-expanded': open,
          onClick: () => setOpen(!open)
        }, [
          h('span', { className: 'mtm-group-title' }, title),
          h('span', { className: 'mtm-chevron' + (open ? ' mtm-chevron-open' : '') }, '▾')
        ]),
        open ? h('div', { className: 'mtm-group-body' }, children) : null
      ])
    }

    /**
     * The card: official PluginCard-style collapsible container. Header shows
     * title, description and a defaults/customized badge; the form unfolds on
     * click and one 保存 button commits every field.
     */
    function MemCard(props) {
      var t = props.t
      var snapshot = useSyncExternalStore(props.subscribe, props.getSnapshot)
      var value = snapshot && snapshot.value ? snapshot.value : {}
      var base = snapshot && snapshot.base ? snapshot.base : {}
      var customized = snapshot && snapshot.customized === true

      var [open, setOpen] = useState(false)
      var [secOpen, setSecOpen] = useState(false)
      var [dynOpen, setDynOpen] = useState(false)
      var [ftOpen, setFtOpen] = useState(false)

      // section group
      var secBase = base.section || {}
      var secVal = value.section || {}
      var [enabled, setEnabled] = useState(secVal.enabled != null ? secVal.enabled : (secBase.enabled !== false))
      var [maxChars, setMaxChars] = useState(secVal.maxChars != null ? secVal.maxChars : (secBase.maxChars != null ? secBase.maxChars : 1200))
      var [minScore, setMinScore] = useState(secVal.minScore != null ? secVal.minScore : (secBase.minScore != null ? secBase.minScore : 0.2))
      var [cacheTtlMs, setCacheTtlMs] = useState(secVal.cacheTtlMs != null ? secVal.cacheTtlMs : (secBase.cacheTtlMs != null ? secBase.cacheTtlMs : 300000))
      var [maxTokens, setMaxTokens] = useState(secVal.maxTokens != null ? secVal.maxTokens : (secBase.maxTokens != null ? secBase.maxTokens : 600))
      var [includeSessionOverview, setIncludeSessionOverview] = useState(secVal.includeSessionOverview != null ? secVal.includeSessionOverview : (secBase.includeSessionOverview !== false))
      var [query, setQuery] = useState(secVal.query != null ? secVal.query : (secBase.query || ''))

      // dynamic group
      var dynBase = base.dynamic || {}
      var dynVal = value.dynamic || {}
      var [dynEnabled, setDynEnabled] = useState(dynVal.enabled != null ? dynVal.enabled : (dynBase.enabled !== false))
      var [dynMaxTokens, setDynMaxTokens] = useState(dynVal.maxTokens != null ? dynVal.maxTokens : (dynBase.maxTokens != null ? dynBase.maxTokens : 500))
      var [dynMinScore, setDynMinScore] = useState(dynVal.minScore != null ? dynVal.minScore : (dynBase.minScore != null ? dynBase.minScore : 0.25))
      var [maxEntries, setMaxEntries] = useState(dynVal.maxEntries != null ? dynVal.maxEntries : (dynBase.maxEntries != null ? dynBase.maxEntries : 5))
      var [inputMaxChars, setInputMaxChars] = useState(dynVal.inputMaxChars != null ? dynVal.inputMaxChars : (dynBase.inputMaxChars != null ? dynBase.inputMaxChars : 500))
      var [minInputChars, setMinInputChars] = useState(dynVal.minInputChars != null ? dynVal.minInputChars : (dynBase.minInputChars != null ? dynBase.minInputChars : 4))
      var [projectTagPrefix, setProjectTagPrefix] = useState(dynVal.projectTagPrefix != null ? dynVal.projectTagPrefix : (dynBase.projectTagPrefix || 'project='))

      // firstTurn group
      var ftBase = base.firstTurn || {}
      var ftVal = value.firstTurn || {}
      var [skipAll, setSkipAll] = useState(ftVal.skipAllFirstTurn != null ? ftVal.skipAllFirstTurn : (ftBase.skipAllFirstTurn === true))
      var [skipPresets, setSkipPresets] = useState(
        (ftVal.skipPresets && ftVal.skipPresets.length ? ftVal.skipPresets : (ftBase.skipPresets || [])).join(', ')
      )

      var [saving, setSaving] = useState(false)
      var [message, setMessage] = useState('')

      useEffect(() => {
        if (value.section) {
          var s = value.section
          if (s.enabled != null && s.enabled !== enabled) setEnabled(s.enabled)
          if (s.maxChars != null && s.maxChars !== maxChars) setMaxChars(s.maxChars)
          if (s.minScore != null && s.minScore !== minScore) setMinScore(s.minScore)
          if (s.cacheTtlMs != null && s.cacheTtlMs !== cacheTtlMs) setCacheTtlMs(s.cacheTtlMs)
          if (s.maxTokens != null && s.maxTokens !== maxTokens) setMaxTokens(s.maxTokens)
          if (s.includeSessionOverview != null && s.includeSessionOverview !== includeSessionOverview) setIncludeSessionOverview(s.includeSessionOverview)
          if (s.query != null && s.query !== query) setQuery(s.query)
        }
        if (value.dynamic) {
          var d = value.dynamic
          if (d.enabled != null && d.enabled !== dynEnabled) setDynEnabled(d.enabled)
          if (d.maxTokens != null && d.maxTokens !== dynMaxTokens) setDynMaxTokens(d.maxTokens)
          if (d.minScore != null && d.minScore !== dynMinScore) setDynMinScore(d.minScore)
          if (d.maxEntries != null && d.maxEntries !== maxEntries) setMaxEntries(d.maxEntries)
          if (d.inputMaxChars != null && d.inputMaxChars !== inputMaxChars) setInputMaxChars(d.inputMaxChars)
          if (d.minInputChars != null && d.minInputChars !== minInputChars) setMinInputChars(d.minInputChars)
          if (d.projectTagPrefix != null && d.projectTagPrefix !== projectTagPrefix) setProjectTagPrefix(d.projectTagPrefix)
        }
        if (value.firstTurn) {
          var f = value.firstTurn
          if (f.skipAllFirstTurn != null && f.skipAllFirstTurn !== skipAll) setSkipAll(f.skipAllFirstTurn)
          if (f.skipPresets && f.skipPresets.length) {
            var joined = f.skipPresets.join(', ')
            if (joined !== skipPresets) setSkipPresets(joined)
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [snapshot])

      var writable = snapshot ? snapshot.writable !== false : true

      function save() {
        if (!writable) return
        setSaving(true)
        setMessage('')
        props.save({
          section: {
            enabled: enabled !== false,
            maxChars: num(maxChars, 1200),
            minScore: num(minScore, 0.2),
            cacheTtlMs: num(cacheTtlMs, 300000),
            maxTokens: num(maxTokens, 600),
            includeSessionOverview: includeSessionOverview !== false,
            query: query.trim()
          },
          dynamic: {
            enabled: dynEnabled !== false,
            maxTokens: num(dynMaxTokens, 500),
            minScore: num(dynMinScore, 0.25),
            maxEntries: num(maxEntries, 5),
            inputMaxChars: num(inputMaxChars, 500),
            minInputChars: num(minInputChars, 4),
            projectTagPrefix: projectTagPrefix.trim()
          },
          firstTurn: {
            skipAllFirstTurn: skipAll === true,
            skipPresets: String(skipPresets || '').split(',').map(function (s) { return s.trim() }).filter(function (s) { return s.length > 0 })
          }
        }).then(function (ok) {
          setMessage(ok.ok ? t('saved') : t('saveFailed'))
          setSaving(false)
        })
      }

      return h('li', { className: 'mtm-card' + (open ? ' mtm-card-open' : '') }, [
        h('button', {
          type: 'button',
          className: 'mtm-header',
          'aria-expanded': open,
          'aria-label': (open ? t('collapse') : t('expand')) + ': ' + t('title'),
          onClick: () => setOpen(!open)
        }, [
          h('span', { className: 'mtm-head-text' }, [
            h('span', { className: 'mtm-name' }, t('title')),
            h('span', { className: 'mtm-desc' }, t('description'))
          ]),
          h('span', { className: 'mtm-badge' + (customized ? '' : ' mtm-badge-muted') }, customized ? t('customized') : t('defaults')),
          h('span', { className: 'mtm-chevron' + (open ? ' mtm-chevron-open' : '') }, '▾')
        ]),
        open ? h('div', { className: 'mtm-body' }, [
          group('section', t('section'), secOpen, setSecOpen, [
            checkbox('enabled', t('enabled'), t('enabledHint'), enabled, setEnabled),
            field('maxChars', t('maxChars'), t('maxCharsHint'), String(maxChars), setMaxChars),
            field('minScore', t('minScore'), t('minScoreHint'), String(minScore), setMinScore),
            field('cacheTtlMs', t('cacheTtlMs'), t('cacheTtlMsHint'), String(cacheTtlMs), setCacheTtlMs),
            field('maxTokens', t('maxTokens'), t('maxTokensHint'), String(maxTokens), setMaxTokens),
            checkbox('includeSessionOverview', t('includeSessionOverview'), t('includeSessionOverviewHint'), includeSessionOverview, setIncludeSessionOverview),
            field('query', t('query'), t('queryHint'), query, setQuery)
          ]),
          group('dynamic', t('dynamic'), dynOpen, setDynOpen, [
            checkbox('dynEnabled', t('dynEnabled'), t('dynEnabledHint'), dynEnabled, setDynEnabled),
            field('dynMaxTokens', t('dynMaxTokens'), t('dynMaxTokensHint'), String(dynMaxTokens), setDynMaxTokens),
            field('dynMinScore', t('dynMinScore'), t('dynMinScoreHint'), String(dynMinScore), setDynMinScore),
            field('maxEntries', t('maxEntries'), t('maxEntriesHint'), String(maxEntries), setMaxEntries),
            field('inputMaxChars', t('inputMaxChars'), t('inputMaxCharsHint'), String(inputMaxChars), setInputMaxChars),
            field('minInputChars', t('minInputChars'), t('minInputCharsHint'), String(minInputChars), setMinInputChars),
            field('projectTagPrefix', t('projectTagPrefix'), t('projectTagPrefixHint'), projectTagPrefix, setProjectTagPrefix)
          ]),
          group('firstTurn', t('firstTurn'), ftOpen, setFtOpen, [
            checkbox('skipAll', t('skipAll'), t('skipAllHint'), skipAll, setSkipAll),
            field('skipPresets', t('skipPresets'), t('skipPresetsHint'), skipPresets, setSkipPresets)
          ]),
          h('div', { className: 'mtm-actions' }, [
            h('button', { className: 'mtm-button', disabled: saving || !writable, onClick: save }, saving ? t('saving') : t('save')),
            message ? h('span', { className: 'mtm-message' }, message) : null
          ])
        ]) : null
      ])
    }

    /** Bind the settings scope onto the card. */
    function CardController(ctx, scope) {
      this.ctx = ctx
      this.scope = scope
      var self = this
      this.getSnapshot = function () { return self.scope.getSnapshot() }
      this.subscribe = function (listener) { return self.scope.subscribe(listener) }
      this.save = function (patch) {
        var writes = []
        if (patch.section && typeof patch.section === 'object') writes.push(self.scope.set('section', patch.section))
        if (patch.dynamic && typeof patch.dynamic === 'object') writes.push(self.scope.set('dynamic', patch.dynamic))
        if (patch.firstTurn && typeof patch.firstTurn === 'object') writes.push(self.scope.set('firstTurn', patch.firstTurn))
        if (writes.length === 0) return Promise.resolve({ ok: true })
        return Promise.all(writes).then(function () {
          return { ok: true }
        }).catch(function () {
          return { ok: false }
        })
      }
      this.hooks = {
        getSnapshot: this.getSnapshot,
        subscribe: this.subscribe,
        save: this.save,
        customized: function () {
          var s = self.scope.getSnapshot()
          return !!(s && s.value && Object.keys(s.value).length > 0)
        }
      }
    }

    /**
     * Required services (cordis fiber inject). These are CORDIS SERVICE NAMES —
     * package specifiers belong in package.json `dsh.client.inject`.
     */
    var inject = [
      'slots',
      'locale',
      'connection',
      'remote',
      'settingsScope'
    ]

    function apply(ctx) {
      var t = ctx.locale.bind(NS)
      ctx.effect(function () {
        return ctx.locale.register(NS, {
          zh: {
            title: '记忆工具与画像注入',
            description: 'memory_* 工具的画像段与每轮定向注入配置:控制 <memory_profile> 段内容与每轮 <memory_context> 的召回预算。',
            customized: '已自定义',
            defaults: '默认配置',
            section: '画像段(profile)',
            enabled: '启用画像段',
            enabledHint: '向系统提示注入 <memory_profile>(会话工作记忆 + 跨会话偏好/实体/事件)',
            maxChars: '段字符上限',
            maxCharsHint: '画像段总预算,默认 1200',
            minScore: '最低分数',
            minScoreHint: '注入画像的最低召回分数,默认 0.2',
            cacheTtlMs: '缓存时长(ms)',
            cacheTtlMsHint: '画像缓存 TTL,默认 300000',
            maxTokens: '召回 Token 预算',
            maxTokensHint: '画像召回 token 上限,默认 600',
            includeSessionOverview: '包含会话概览',
            includeSessionOverviewHint: '画像段包含 <session_working_memory> 概览',
            query: '画像查询',
            queryHint: '跨会话召回用的宽泛查询语句',
            dynamic: '每轮定向注入',
            dynEnabled: '启用定向注入',
            dynEnabledHint: '每轮按当前输入语义召回并注入一条 <memory_context>(表面替换,不累积)',
            dynMaxTokens: 'Token 预算',
            dynMaxTokensHint: '单轮定向注入 token 上限,默认 500',
            dynMinScore: '最低分数',
            dynMinScoreHint: '定向注入最低召回分数,默认 0.25',
            maxEntries: '最大条目数',
            maxEntriesHint: '单轮最多注入几条记忆,默认 5',
            inputMaxChars: '输入截断(字符)',
            inputMaxCharsHint: '用于查询的输入长度上限,默认 500',
            minInputChars: '最小输入长度',
            minInputCharsHint: '低于该长度的输入跳过检索(省一次往返),默认 4',
            projectTagPrefix: '项目标签前缀',
            projectTagPrefixHint: '按会话目录生成的 project= 标签前缀,默认 project=',
            firstTurn: '首轮注入控制',
            skipAll: '所有预设首轮不注入',
            skipAllHint: '开启后任何预设的首轮都不注入记忆(更干净的首屏)',
            skipPresets: '首轮跳过注入的预设',
            skipPresetsHint: '逗号分隔的预设名(如 minimal, router-standard, router-spec):这些预设的首轮完全不注入记忆(无 <memory_context> 消息,画像段为空),从第二轮起恢复',
            expand: '展开',
            collapse: '收起',
            save: '保存',
            saving: '保存中…',
            saved: '已保存',
            saveFailed: '保存失败'
          },
          en: {
            title: 'Memory tools & profile injection',
            description: 'Configuration of the memory_* tools profile section and per-input targeted injection: <memory_profile> content and per-turn <memory_context> budgets.',
            customized: 'Customized',
            defaults: 'Defaults',
            section: 'Profile section',
            enabled: 'Enable profile section',
            enabledHint: 'Inject <memory_profile> into the system prompt (working memory + cross-session preferences/entities/events)',
            maxChars: 'Section char cap',
            maxCharsHint: 'Total profile budget, default 1200',
            minScore: 'Min score',
            minScoreHint: 'Minimum recall score for injected entries, default 0.2',
            cacheTtlMs: 'Cache TTL (ms)',
            cacheTtlMsHint: 'Profile cache TTL, default 300000',
            maxTokens: 'Recall token budget',
            maxTokensHint: 'Token cap for profile recall, default 600',
            includeSessionOverview: 'Include session overview',
            includeSessionOverviewHint: 'Include the <session_working_memory> overview block',
            query: 'Profile query',
            queryHint: 'Broad query used for cross-session recall',
            dynamic: 'Per-input injection',
            dynEnabled: 'Enable targeted injection',
            dynEnabledHint: 'Recall per user input and inject one <memory_context> block per turn (surface-replaced, never accumulates)',
            dynMaxTokens: 'Token budget',
            dynMaxTokensHint: 'Per-turn targeted injection token cap, default 500',
            dynMinScore: 'Min score',
            dynMinScoreHint: 'Minimum recall score for targeted injection, default 0.25',
            maxEntries: 'Max entries',
            maxEntriesHint: 'Max memories injected per turn, default 5',
            inputMaxChars: 'Input cap (chars)',
            inputMaxCharsHint: 'Input length cap used for the query, default 500',
            minInputChars: 'Min input length',
            minInputCharsHint: 'Inputs below this length skip retrieval, default 4',
            projectTagPrefix: 'Project tag prefix',
            projectTagPrefixHint: 'Prefix of the project= tag derived from the session cwd, default project=',
            firstTurn: 'First-turn injection control',
            skipAll: 'Skip first turn for every preset',
            skipAllHint: 'When on, no memory is injected on the first turn of any preset (cleaner first prompt)',
            skipPresets: 'Presets to skip injection on turn 1',
            skipPresetsHint: 'Comma-separated preset names (e.g. minimal, router-standard, router-spec): these presets get NO memory injection on their first turn (no <memory_context> message; profile section empty), normal from turn 2 on',
            expand: 'Expand',
            collapse: 'Collapse',
            save: 'Save',
            saving: 'Saving…',
            saved: 'Saved',
            saveFailed: 'Save failed'
          }
        })
      })
      var scope = ctx.settingsScope.bind({ namespace: NS })
      var controller = new CardController(ctx, scope)
      var registered = false
      function renderCard() {
        var hooks = controller.hooks
        return h(MemCard, {
          t: t,
          subscribe: hooks.subscribe,
          getSnapshot: hooks.getSnapshot,
          save: hooks.save,
          customized: hooks.customized()
        })
      }
      ctx.slots.inject('settings.plugin.item', function* () {
        if (registered) return
        registered = true
        yield ctx.slots.register({
          name: 'settings.plugin.item',
          id: 'tool-memory',
          order: 50,
          locale: NS,
          inject: function () {
            var hooks = controller.hooks
            return {
              hooks: {
                mtmCard: {
                  getSnapshot: hooks.getSnapshot,
                  subscribe: hooks.subscribe,
                  save: hooks.save,
                  customized: hooks.customized
                }
              },
              subscribe: hooks.subscribe,
              getSnapshot: hooks.getSnapshot,
              save: hooks.save
            }
          }
        }, renderCard)
      })
      ctx.effect(function () {
        if (typeof document === 'undefined') return function () {}
        if (!css) {
          // 主题安全: 与官方卡片一致的 CSS 变量用法。
          css = '.mtm-card{list-style:none;border:1px solid var(--border-color,rgba(127,127,127,.4));border-radius:8px;background:var(--surface-color,transparent);overflow:hidden}' +
            '.mtm-header{display:flex;align-items:center;gap:10px;width:100%;padding:12px;background:none;border:none;color:inherit;cursor:pointer;text-align:left;font:inherit}' +
            '.mtm-head-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}' +
            '.mtm-name{font-weight:600;font-size:14px}.mtm-desc{font-size:12px;opacity:.75}' +
            '.mtm-badge{flex:none;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--border-color,rgba(127,127,127,.4))}.mtm-badge-muted{opacity:.6}' +
            '.mtm-chevron{flex:none;opacity:.7;transition:transform .15s ease}.mtm-chevron-open{transform:rotate(180deg)}' +
            '.mtm-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 12px}' +
            '.mtm-field{display:flex;flex-direction:column;gap:4px;font-size:13px}' +
            '.mtm-label{opacity:.9}.mtm-input{padding:6px 8px;border:1px solid var(--border-color,rgba(127,127,127,.4));border-radius:6px;background:transparent;color:inherit;font:inherit}' +
            '.mtm-hint{font-size:11px;opacity:.6}.mtm-check{display:flex;align-items:center;gap:8px;font-size:13px}.mtm-check .mtm-hint{display:block;width:100%}' +
            '.mtm-group{border:1px solid var(--border-color,rgba(127,127,127,.4));border-radius:6px;overflow:hidden}' +
            '.mtm-group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:8px 10px;background:none;border:none;color:inherit;cursor:pointer;font:inherit;font-size:13px;font-weight:600}' +
            '.mtm-group-body{display:flex;flex-direction:column;gap:8px;padding:0 10px 10px}' +
            '.mtm-actions{display:flex;align-items:center;gap:10px;margin-top:4px}' +
            '.mtm-button{padding:6px 14px;border-radius:6px;border:1px solid var(--border-color,rgba(127,127,127,.4));background:var(--accent-color,#2d6cdf);color:#fff;cursor:pointer;font:inherit}' +
            '.mtm-button:disabled{opacity:.5;cursor:default}.mtm-message{font-size:12px;opacity:.8}'
          var el = document.createElement('style')
          el.textContent = css
          document.head.append(el)
        }
        return function () {}
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
