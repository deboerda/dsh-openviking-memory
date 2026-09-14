/**
 * @deepseek-ai/dsh-memory-openviking — browser half: the plugin configuration
 * card shown in 设置 → 插件配置 (the `settings.plugin.item` slot).
 *
 * Mirrors the official plugin-card pattern (same structure, CSS-variable
 * theming, zh/en locale and staged-save transport as dsh-vision-primitives).
 * Every field of the `memory-openviking` row config is editable; nested
 * `capture` / `recall` groups are collapsible subsections.
 *
 * Loaded by dsh-client-modules as `/plugins/@deepseek-ai/dsh-memory-openviking/client.js`
 * (declared via package.json `dsh.client` + `exports["./client"]`).
 */
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-memory-openviking',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useSyncExternalStore = react.useSyncExternalStore

    /** Namespace of the memory-openviking settings section. */
    var NS = 'memory-openviking'
    var css = ''

    function num(v, dflt) {
      if (v === undefined || v === null || v === '') return dflt
      var n = Number(v)
      return Number.isFinite(n) ? n : dflt
    }

    function field(id, label, hint, value, onChange, opts) {
      return h('label', { className: 'mvc-field', key: id }, [
        h('span', { className: 'mvc-label' }, label),
        h('input', {
          className: 'mvc-input',
          type: opts && opts.secret ? 'password' : 'text',
          value: value == null ? '' : String(value),
          placeholder: opts && opts.placeholder ? opts.placeholder : '',
          disabled: opts && opts.disabled,
          onChange: (e) => onChange(e.target.value)
        }),
        hint ? h('span', { className: 'mvc-hint' }, hint) : null
      ])
    }

    function checkbox(id, label, hint, checked, onChange) {
      return h('label', { className: 'mvc-check', key: id }, [
        h('input', {
          type: 'checkbox',
          checked: !!checked,
          onChange: (e) => onChange(e.target.checked)
        }),
        h('span', { className: 'mvc-label' }, label),
        hint ? h('span', { className: 'mvc-hint' }, hint) : null
      ])
    }

    function selectField(id, label, hint, value, options, onChange) {
      return h('label', { className: 'mvc-field', key: id }, [
        h('span', { className: 'mvc-label' }, label),
        h('select', {
          className: 'mvc-input',
          value: value == null ? '' : String(value),
          onChange: (e) => onChange(e.target.value)
        }, options.map(function (o) {
          return h('option', { key: o, value: o }, o)
        })),
        hint ? h('span', { className: 'mvc-hint' }, hint) : null
      ])
    }

    /** Collapsible subsection grouping related fields. */
    function group(id, title, open, setOpen, children) {
      return h('div', { className: 'mvc-group' + (open ? ' mvc-group-open' : ''), key: id }, [
        h('button', {
          type: 'button',
          className: 'mvc-group-head',
          'aria-expanded': open,
          onClick: () => setOpen(!open)
        }, [
          h('span', { className: 'mvc-group-title' }, title),
          h('span', { className: 'mvc-chevron' + (open ? ' mvc-chevron-open' : '') }, '▾')
        ]),
        open ? h('div', { className: 'mvc-group-body' }, children) : null
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
      var [capOpen, setCapOpen] = useState(false)
      var [recOpen, setRecOpen] = useState(false)

      // Connection
      var [baseUrl, setBaseUrl] = useState(value.baseUrl != null ? value.baseUrl : (base.baseUrl || ''))
      var [apiKey, setApiKey] = useState('')
      var [account, setAccount] = useState(value.account != null ? value.account : (base.account || ''))
      var [user, setUser] = useState(value.user != null ? value.user : (base.user || ''))
      var [timeoutMs, setTimeoutMs] = useState(value.timeoutMs != null ? value.timeoutMs : (base.timeoutMs != null ? base.timeoutMs : 15000))
      var [deadLetterDir, setDeadLetterDir] = useState(value.deadLetterDir != null ? value.deadLetterDir : (base.deadLetterDir || ''))
      // Isolation
      var [peerPerSession, setPeerPerSession] = useState(value.peerPerSession != null ? value.peerPerSession : (base.peerPerSession === true))
      var [peerScope, setPeerScope] = useState(value.peerScope != null ? value.peerScope : (base.peerScope || 'all'))
      // Capture group
      var capBase = base.capture || {}
      var capVal = value.capture || {}
      var [toolResults, setToolResults] = useState(capVal.toolResults != null ? capVal.toolResults : (capBase.toolResults === true))
      var [nonUserSources, setNonUserSources] = useState(capVal.nonUserSources != null ? capVal.nonUserSources : (capBase.nonUserSources === true))
      var [subagentSessions, setSubagentSessions] = useState(capVal.subagentSessions != null ? capVal.subagentSessions : (capBase.subagentSessions === true))
      var [flushThresholdBytes, setFlushThresholdBytes] = useState(capVal.flushThresholdBytes != null ? capVal.flushThresholdBytes : (capBase.flushThresholdBytes != null ? capBase.flushThresholdBytes : 4096))
      var [commitIntervalMessages, setCommitIntervalMessages] = useState(capVal.commitIntervalMessages != null ? capVal.commitIntervalMessages : (capBase.commitIntervalMessages != null ? capBase.commitIntervalMessages : 16))
      var [commitIntervalMs, setCommitIntervalMs] = useState(capVal.commitIntervalMs != null ? capVal.commitIntervalMs : (capBase.commitIntervalMs != null ? capBase.commitIntervalMs : 60000))
      var [keepRecentMessages, setKeepRecentMessages] = useState(capVal.keepRecentMessages != null ? capVal.keepRecentMessages : (capBase.keepRecentMessages != null ? capBase.keepRecentMessages : 4))
      var [maxBufferBytes, setMaxBufferBytes] = useState(capVal.maxBufferBytes != null ? capVal.maxBufferBytes : (capBase.maxBufferBytes != null ? capBase.maxBufferBytes : 262144))
      var [flushTimeoutMs, setFlushTimeoutMs] = useState(capVal.flushTimeoutMs != null ? capVal.flushTimeoutMs : (capBase.flushTimeoutMs != null ? capBase.flushTimeoutMs : 2000))
      var [retryMaxAttempts, setRetryMaxAttempts] = useState(capVal.retryMaxAttempts != null ? capVal.retryMaxAttempts : (capBase.retryMaxAttempts != null ? capBase.retryMaxAttempts : 8))
      var [retryBaseDelayMs, setRetryBaseDelayMs] = useState(capVal.retryBaseDelayMs != null ? capVal.retryBaseDelayMs : (capBase.retryBaseDelayMs != null ? capBase.retryBaseDelayMs : 1000))
      var [retryMaxDelayMs, setRetryMaxDelayMs] = useState(capVal.retryMaxDelayMs != null ? capVal.retryMaxDelayMs : (capBase.retryMaxDelayMs != null ? capBase.retryMaxDelayMs : 60000))
      // Recall group
      var recBase = base.recall || {}
      var recVal = value.recall || {}
      var [maxTokens, setMaxTokens] = useState(recVal.maxTokens != null ? recVal.maxTokens : (recBase.maxTokens != null ? recBase.maxTokens : 1600))
      var [scoreThreshold, setScoreThreshold] = useState(recVal.scoreThreshold != null ? recVal.scoreThreshold : (recBase.scoreThreshold != null ? recBase.scoreThreshold : ''))
      var [cacheTtlMs, setCacheTtlMs] = useState(recVal.cacheTtlMs != null ? recVal.cacheTtlMs : (recBase.cacheTtlMs != null ? recBase.cacheTtlMs : 300000))
      var [purpose, setPurpose] = useState(recVal.purpose != null ? recVal.purpose : (recBase.purpose || 'chat'))

      var [saving, setSaving] = useState(false)
      var [message, setMessage] = useState('')

      useEffect(() => {
        if (value.baseUrl != null && value.baseUrl !== baseUrl) setBaseUrl(value.baseUrl)
        if (value.account != null && value.account !== account) setAccount(value.account)
        if (value.user != null && value.user !== user) setUser(value.user)
        if (value.timeoutMs != null && value.timeoutMs !== timeoutMs) setTimeoutMs(value.timeoutMs)
        if (value.deadLetterDir != null && value.deadLetterDir !== deadLetterDir) setDeadLetterDir(value.deadLetterDir)
        if (value.peerPerSession != null && value.peerPerSession !== peerPerSession) setPeerPerSession(value.peerPerSession)
        if (value.peerScope != null && value.peerScope !== peerScope) setPeerScope(value.peerScope)
        if (value.capture) {
          var c = value.capture
          if (c.toolResults != null && c.toolResults !== toolResults) setToolResults(c.toolResults)
          if (c.nonUserSources != null && c.nonUserSources !== nonUserSources) setNonUserSources(c.nonUserSources)
          if (c.subagentSessions != null && c.subagentSessions !== subagentSessions) setSubagentSessions(c.subagentSessions)
          if (c.flushThresholdBytes != null && c.flushThresholdBytes !== flushThresholdBytes) setFlushThresholdBytes(c.flushThresholdBytes)
          if (c.commitIntervalMessages != null && c.commitIntervalMessages !== commitIntervalMessages) setCommitIntervalMessages(c.commitIntervalMessages)
          if (c.commitIntervalMs != null && c.commitIntervalMs !== commitIntervalMs) setCommitIntervalMs(c.commitIntervalMs)
          if (c.keepRecentMessages != null && c.keepRecentMessages !== keepRecentMessages) setKeepRecentMessages(c.keepRecentMessages)
          if (c.maxBufferBytes != null && c.maxBufferBytes !== maxBufferBytes) setMaxBufferBytes(c.maxBufferBytes)
          if (c.flushTimeoutMs != null && c.flushTimeoutMs !== flushTimeoutMs) setFlushTimeoutMs(c.flushTimeoutMs)
          if (c.retryMaxAttempts != null && c.retryMaxAttempts !== retryMaxAttempts) setRetryMaxAttempts(c.retryMaxAttempts)
          if (c.retryBaseDelayMs != null && c.retryBaseDelayMs !== retryBaseDelayMs) setRetryBaseDelayMs(c.retryBaseDelayMs)
          if (c.retryMaxDelayMs != null && c.retryMaxDelayMs !== retryMaxDelayMs) setRetryMaxDelayMs(c.retryMaxDelayMs)
        }
        if (value.recall) {
          var r = value.recall
          if (r.maxTokens != null && r.maxTokens !== maxTokens) setMaxTokens(r.maxTokens)
          if (r.scoreThreshold != null && r.scoreThreshold !== scoreThreshold) setScoreThreshold(r.scoreThreshold)
          if (r.cacheTtlMs != null && r.cacheTtlMs !== cacheTtlMs) setCacheTtlMs(r.cacheTtlMs)
          if (r.purpose != null && r.purpose !== purpose) setPurpose(r.purpose)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [snapshot])

      var writable = snapshot ? snapshot.writable !== false : true

      function save() {
        if (!writable) return
        setSaving(true)
        setMessage('')
        var patch = {
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          account: account.trim(),
          user: user.trim(),
          timeoutMs: num(timeoutMs, 15000),
          deadLetterDir: deadLetterDir.trim(),
          peerPerSession: peerPerSession === true,
          peerScope: peerScope === 'actor' ? 'actor' : 'all',
          capture: {
            toolResults: toolResults === true,
            nonUserSources: nonUserSources === true,
            subagentSessions: subagentSessions === true,
            flushThresholdBytes: num(flushThresholdBytes, 4096),
            commitIntervalMessages: num(commitIntervalMessages, 16),
            commitIntervalMs: num(commitIntervalMs, 60000),
            keepRecentMessages: num(keepRecentMessages, 4),
            maxBufferBytes: num(maxBufferBytes, 262144),
            flushTimeoutMs: num(flushTimeoutMs, 2000),
            retryMaxAttempts: num(retryMaxAttempts, 8),
            retryBaseDelayMs: num(retryBaseDelayMs, 1000),
            retryMaxDelayMs: num(retryMaxDelayMs, 60000)
          },
          recall: {
            maxTokens: num(maxTokens, 1600),
            scoreThreshold: scoreThreshold === '' ? undefined : num(scoreThreshold, undefined),
            cacheTtlMs: num(cacheTtlMs, 300000),
            purpose: purpose === 'coding' ? 'coding' : 'chat'
          }
        }
        props.save(patch).then(function (ok) {
          setApiKey('')
          setMessage(ok.ok ? t('saved') : t('saveFailed'))
          setSaving(false)
        })
      }

      return h('li', { className: 'mvc-card' + (open ? ' mvc-card-open' : '') }, [
        h('button', {
          type: 'button',
          className: 'mvc-header',
          'aria-expanded': open,
          'aria-label': (open ? t('collapse') : t('expand')) + ': ' + t('title'),
          onClick: () => setOpen(!open)
        }, [
          h('span', { className: 'mvc-head-text' }, [
            h('span', { className: 'mvc-name' }, t('title')),
            h('span', { className: 'mvc-desc' }, t('description'))
          ]),
          h('span', { className: 'mvc-badge' + (customized ? '' : ' mvc-badge-muted') }, customized ? t('customized') : t('defaults')),
          h('span', { className: 'mvc-chevron' + (open ? ' mvc-chevron-open' : '') }, '▾')
        ]),
        open ? h('div', { className: 'mvc-body' }, [
          h('div', { className: 'mvc-section-title' }, t('connection')),
          field('baseUrl', t('baseUrl'), t('baseUrlHint'), baseUrl, setBaseUrl),
          field('apiKey', t('apiKey'), t('apiKeyHint'), apiKey, setApiKey, { secret: true, placeholder: '••••••••' }),
          field('account', t('account'), t('accountHint'), account, setAccount),
          field('user', t('user'), t('userHint'), user, setUser),
          field('timeoutMs', t('timeoutMs'), t('timeoutMsHint'), String(timeoutMs), setTimeoutMs),
          field('deadLetterDir', t('deadLetterDir'), t('deadLetterDirHint'), deadLetterDir, setDeadLetterDir),
          h('div', { className: 'mvc-section-title' }, t('isolation')),
          checkbox('peerPerSession', t('peerPerSession'), t('peerPerSessionHint'), peerPerSession, setPeerPerSession),
          selectField('peerScope', t('peerScope'), t('peerScopeHint'), peerScope, ['all', 'actor'], setPeerScope),
          group('capture', t('capture'), capOpen, setCapOpen, [
            checkbox('toolResults', t('toolResults'), t('toolResultsHint'), toolResults, setToolResults),
            checkbox('nonUserSources', t('nonUserSources'), t('nonUserSourcesHint'), nonUserSources, setNonUserSources),
            checkbox('subagentSessions', t('subagentSessions'), t('subagentSessionsHint'), subagentSessions, setSubagentSessions),
            field('flushThresholdBytes', t('flushThresholdBytes'), t('flushThresholdBytesHint'), String(flushThresholdBytes), setFlushThresholdBytes),
            field('commitIntervalMessages', t('commitIntervalMessages'), t('commitIntervalMessagesHint'), String(commitIntervalMessages), setCommitIntervalMessages),
            field('commitIntervalMs', t('commitIntervalMs'), t('commitIntervalMsHint'), String(commitIntervalMs), setCommitIntervalMs),
            field('keepRecentMessages', t('keepRecentMessages'), t('keepRecentMessagesHint'), String(keepRecentMessages), setKeepRecentMessages),
            field('maxBufferBytes', t('maxBufferBytes'), t('maxBufferBytesHint'), String(maxBufferBytes), setMaxBufferBytes),
            field('flushTimeoutMs', t('flushTimeoutMs'), t('flushTimeoutMsHint'), String(flushTimeoutMs), setFlushTimeoutMs),
            field('retryMaxAttempts', t('retryMaxAttempts'), t('retryMaxAttemptsHint'), String(retryMaxAttempts), setRetryMaxAttempts),
            field('retryBaseDelayMs', t('retryBaseDelayMs'), t('retryBaseDelayMsHint'), String(retryBaseDelayMs), setRetryBaseDelayMs),
            field('retryMaxDelayMs', t('retryMaxDelayMs'), t('retryMaxDelayMsHint'), String(retryMaxDelayMs), setRetryMaxDelayMs)
          ]),
          group('recall', t('recall'), recOpen, setRecOpen, [
            field('maxTokens', t('maxTokens'), t('maxTokensHint'), String(maxTokens), setMaxTokens),
            field('scoreThreshold', t('scoreThreshold'), t('scoreThresholdHint'), String(scoreThreshold), setScoreThreshold),
            field('cacheTtlMs', t('cacheTtlMs'), t('cacheTtlMsHint'), String(cacheTtlMs), setCacheTtlMs),
            selectField('purpose', t('purpose'), t('purposeHint'), purpose, ['chat', 'coding'], setPurpose)
          ]),
          h('div', { className: 'mvc-actions' }, [
            h('button', { className: 'mvc-button', disabled: saving || !writable, onClick: save }, saving ? t('saving') : t('save')),
            message ? h('span', { className: 'mvc-message' }, message) : null
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
        if (typeof patch.baseUrl === 'string' && patch.baseUrl.length > 0) writes.push(self.scope.set('baseUrl', patch.baseUrl))
        if (typeof patch.apiKey === 'string' && patch.apiKey.length > 0) writes.push(self.scope.set('apiKey', patch.apiKey))
        if (typeof patch.account === 'string' && patch.account.length > 0) writes.push(self.scope.set('account', patch.account))
        if (typeof patch.user === 'string' && patch.user.length > 0) writes.push(self.scope.set('user', patch.user))
        if (Number.isFinite(patch.timeoutMs) && patch.timeoutMs > 0) writes.push(self.scope.set('timeoutMs', patch.timeoutMs))
        if (typeof patch.deadLetterDir === 'string') writes.push(self.scope.set('deadLetterDir', patch.deadLetterDir))
        if (typeof patch.peerPerSession === 'boolean') writes.push(self.scope.set('peerPerSession', patch.peerPerSession))
        if (patch.peerScope === 'all' || patch.peerScope === 'actor') writes.push(self.scope.set('peerScope', patch.peerScope))
        if (patch.capture && typeof patch.capture === 'object') writes.push(self.scope.set('capture', patch.capture))
        if (patch.recall && typeof patch.recall === 'object') writes.push(self.scope.set('recall', patch.recall))
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
            title: 'OpenViking 长期记忆',
            description: '自动捕获会话到 OpenViking 服务器并蒸馏为长期记忆;配置服务器地址与认证、捕获与召回参数。',
            customized: '已自定义',
            defaults: '默认配置',
            connection: '连接',
            baseUrl: 'Base URL',
            baseUrlHint: 'OpenViking 服务地址,默认 http://127.0.0.1:18770',
            apiKey: 'API Key',
            apiKeyHint: '账户下的用户/管理员 API key(root key 无法访问数据 API)。留空使用行配置或默认值',
            account: 'Account',
            accountHint: '多租户账户 ID(留空为单账户模式)',
            user: 'User',
            userHint: '账户下的用户 ID(留空为单账户模式)',
            timeoutMs: '超时(毫秒)',
            timeoutMsHint: '单次 OpenViking 调用超时,默认 15000',
            deadLetterDir: 'Dead Letter 目录',
            deadLetterDirHint: '重试耗尽后消息落盘的目录;留空则仅告警丢弃',
            isolation: '会话隔离',
            peerPerSession: '每会话独立 Peer',
            peerPerSessionHint: '每个 DSH 会话映射到独立 OpenViking actor peer(生产多租户)',
            peerScope: 'Peer 召回范围',
            peerScopeHint: 'all=全部 peer,actor=仅当前 actor',
            capture: '自动捕获',
            toolResults: '捕获工具结果',
            toolResultsHint: '把工具结果消息也写入记忆(默认关)',
            nonUserSources: '捕获注入消息',
            nonUserSourcesHint: '捕获 skill 内容/通知等非用户消息(记忆上下文注入始终排除)',
            subagentSessions: '捕获子代理会话',
            subagentSessionsHint: 'delegationDepth>0 的子代理会话也捕获(默认关)',
            flushThresholdBytes: '排空阈值(字节)',
            flushThresholdBytesHint: '缓冲超过该字节数提前排空,默认 4096',
            commitIntervalMessages: '提交消息阈值',
            commitIntervalMessagesHint: '累计多少条消息触发一次 commit,默认 16',
            commitIntervalMs: '提交最小间隔(ms)',
            commitIntervalMsHint: '即使未达消息阈值,间隔到期也提交,默认 60000',
            keepRecentMessages: '保留近期消息数',
            keepRecentMessagesHint: '每次 commit 保留的尾部消息数;会话结束时用 0 全部归档',
            maxBufferBytes: '缓冲上限(字节)',
            maxBufferBytesHint: '服务器长时间不可达时的保留上限,超出丢弃最旧,默认 262144',
            flushTimeoutMs: 'flush 等待上限(ms)',
            flushTimeoutMsHint: 'session/flush 有界等待窗口,0=一直等,默认 2000',
            retryMaxAttempts: '最大重试次数',
            retryMaxAttemptsHint: '连续失败多少次后 dead-letter/丢弃,默认 8',
            retryBaseDelayMs: '重试基础延迟(ms)',
            retryBaseDelayMsHint: '指数退避基数,默认 1000',
            retryMaxDelayMs: '重试最大延迟(ms)',
            retryMaxDelayMsHint: '退避上限,默认 60000',
            recall: '召回',
            maxTokens: '召回 Token 预算',
            maxTokensHint: '单次召回/画像的 token 上限,默认 1600',
            scoreThreshold: '最低分数',
            scoreThresholdHint: '低于该相似度的记忆不返回(留空=不限制)',
            cacheTtlMs: '画像缓存(ms)',
            cacheTtlMsHint: '会话画像概览缓存时长,默认 300000',
            purpose: '召回用途',
            purposeHint: 'chat 或 coding(影响服务端排序)',
            expand: '展开',
            collapse: '收起',
            save: '保存',
            saving: '保存中…',
            saved: '已保存',
            saveFailed: '保存失败'
          },
          en: {
            title: 'OpenViking long-term memory',
            description: 'Auto-captures sessions into an OpenViking server and distills long-term memories; configure server, auth, capture and recall.',
            customized: 'Customized',
            defaults: 'Defaults',
            connection: 'Connection',
            baseUrl: 'Base URL',
            baseUrlHint: 'OpenViking server, default http://127.0.0.1:18770',
            apiKey: 'API Key',
            apiKeyHint: 'A user/admin API key of an account (root keys cannot access data APIs). Leave empty to use row config',
            account: 'Account',
            accountHint: 'Tenant account id (leave empty for single-account mode)',
            user: 'User',
            userHint: 'User id within the account (leave empty for single-account mode)',
            timeoutMs: 'Timeout (ms)',
            timeoutMsHint: 'Per-call timeout, default 15000',
            deadLetterDir: 'Dead-letter dir',
            deadLetterDirHint: 'Directory for dead-lettered batches after retries are exhausted; empty = warn-only drop',
            isolation: 'Session isolation',
            peerPerSession: 'Per-session peer',
            peerPerSessionHint: 'Map each DSH session to its own OpenViking actor peer (production multi-tenant)',
            peerScope: 'Recall peer scope',
            peerScopeHint: 'all = every peer, actor = current actor only',
            capture: 'Auto capture',
            toolResults: 'Capture tool results',
            toolResultsHint: 'Also capture tool-result messages (default off)',
            nonUserSources: 'Capture injected messages',
            nonUserSourcesHint: 'Capture skill content/notices etc. (memory-context injection is always excluded)',
            subagentSessions: 'Capture subagent sessions',
            subagentSessionsHint: 'Capture delegated sessions (default off)',
            flushThresholdBytes: 'Flush threshold (bytes)',
            flushThresholdBytesHint: 'Early drain above this buffer size, default 4096',
            commitIntervalMessages: 'Commit message threshold',
            commitIntervalMessagesHint: 'Commit after this many added messages, default 16',
            commitIntervalMs: 'Commit min interval (ms)',
            commitIntervalMsHint: 'Commit on interval even below the message threshold, default 60000',
            keepRecentMessages: 'Keep recent messages',
            keepRecentMessagesHint: 'Tail messages kept live after each commit; final commit uses 0',
            maxBufferBytes: 'Buffer cap (bytes)',
            maxBufferBytesHint: 'Retention cap while the server is down, default 262144',
            flushTimeoutMs: 'Flush wait cap (ms)',
            flushTimeoutMsHint: 'Bounded window for session/flush, 0 = wait, default 2000',
            retryMaxAttempts: 'Max retry attempts',
            retryMaxAttemptsHint: 'Consecutive failures before dead-letter/drop, default 8',
            retryBaseDelayMs: 'Retry base delay (ms)',
            retryBaseDelayMsHint: 'Exponential backoff base, default 1000',
            retryMaxDelayMs: 'Retry max delay (ms)',
            retryMaxDelayMsHint: 'Backoff ceiling, default 60000',
            recall: 'Recall',
            maxTokens: 'Recall token budget',
            maxTokensHint: 'Token cap per recall/profile, default 1600',
            scoreThreshold: 'Min score',
            scoreThresholdHint: 'Memories below this similarity are not returned (empty = no limit)',
            cacheTtlMs: 'Profile cache (ms)',
            cacheTtlMsHint: 'Session profile overview cache TTL, default 300000',
            purpose: 'Recall purpose',
            purposeHint: 'chat or coding (affects server-side ranking)',
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
          id: 'memory-openviking',
          order: 40,
          locale: NS,
          inject: function () {
            var hooks = controller.hooks
            return {
              hooks: {
                mvcCard: {
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
          // 主题安全: 边框/背景 fallback 一律用中性值, 文字 color:inherit —
          // 与官方卡片一致, 避免浅色主题下深色 fallback 造成黑底黑字。
          css = '.mvc-card{list-style:none;border:1px solid var(--border-color,rgba(127,127,127,.4));border-radius:8px;background:var(--surface-color,transparent);overflow:hidden}' +
            '.mvc-header{display:flex;align-items:center;gap:10px;width:100%;padding:12px;background:none;border:none;color:inherit;cursor:pointer;text-align:left;font:inherit}' +
            '.mvc-head-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}' +
            '.mvc-name{font-weight:600;font-size:14px}.mvc-desc{font-size:12px;opacity:.75}' +
            '.mvc-badge{flex:none;font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--border-color,rgba(127,127,127,.4))}.mvc-badge-muted{opacity:.6}' +
            '.mvc-chevron{flex:none;opacity:.7;transition:transform .15s ease}.mvc-chevron-open{transform:rotate(180deg)}' +
            '.mvc-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 12px}' +
            '.mvc-section-title{font-size:12px;font-weight:600;opacity:.7;margin-top:6px}' +
            '.mvc-field{display:flex;flex-direction:column;gap:4px;font-size:13px}' +
            '.mvc-label{opacity:.9}.mvc-input{padding:6px 8px;border:1px solid var(--border-color,rgba(127,127,127,.4));border-radius:6px;background:transparent;color:inherit;font:inherit}' +
            '.mvc-hint{font-size:11px;opacity:.6}.mvc-check{display:flex;align-items:center;gap:8px;font-size:13px}.mvc-check .mvc-hint{display:block;width:100%}' +
            '.mvc-group{border:1px solid var(--border-color,rgba(127,127,127,.4));border-radius:6px;overflow:hidden}' +
            '.mvc-group-head{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:8px 10px;background:none;border:none;color:inherit;cursor:pointer;font:inherit;font-size:13px;font-weight:600}' +
            '.mvc-group-body{display:flex;flex-direction:column;gap:8px;padding:0 10px 10px}' +
            '.mvc-actions{display:flex;align-items:center;gap:10px;margin-top:4px}' +
            '.mvc-button{padding:6px 14px;border-radius:6px;border:1px solid var(--border-color,rgba(127,127,127,.4));background:var(--accent-color,#2d6cdf);color:#fff;cursor:pointer;font:inherit}' +
            '.mvc-button:disabled{opacity:.5;cursor:default}.mvc-message{font-size:12px;opacity:.8}'
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
