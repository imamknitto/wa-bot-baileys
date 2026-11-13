const $ = (id) => document.getElementById(id)

const KEY_STORAGE = 'apiKey'
const TOKEN_STORAGE = 'sessionToken'
const DELAY_STORAGE = 'broadcastDelay'

const apiKeyInput = $('apiKey')
const sessionTokenInput = $('sessionToken')
const serviceMeta = $('serviceMeta')
const sessionList = $('sessionList')
const recipientNameInput = $('recipientName')
const recipientPhoneInput = $('recipientPhone')
const addRecipientBtn = $('addRecipientBtn')
const recipientError = $('recipientError')
const sessionForm = $('sessionForm')
const sessionDialog = $('sessionDialog')
const sessionIdInput = $('sessionId')
const sessionSalesIdInput = $('sessionSalesId')
const sessionAgentIdInput = $('sessionAgentId')
const sessionModeSelect = $('sessionMode')
const sessionPhoneInput = $('sessionPhone')
const phoneField = $('phoneField')
const createSessionBtn = $('createSessionBtn')
const sessionError = $('sessionError')
const broadcastForm = $('broadcastForm')
const broadcastText = $('broadcastText')
const broadcastBtn = $('broadcastBtn')
const broadcastError = $('broadcastError')
const selectedCountEl = $('selectedCount')
const selectedChipsEl = $('selectedChips')
const composerEstimate = $('composerEstimate')
const composerDelay = $('composerDelay')
const delayMinInput = $('delayMin')
const delayMaxInput = $('delayMax')
const delayHint = $('delayHint')
const broadcastProgress = $('broadcastProgress')
const jobStatusEl = $('jobStatus')
const jobCountsEl = $('jobCounts')
const jobCountdownEl = $('jobCountdown')
const jobBarEl = $('jobBar')
const jobResultsEl = $('jobResults')
const cancelBroadcastBtn = $('cancelBroadcastBtn')
const historyFilter = $('historyFilter')
const historyList = $('historyList')
const sessionPage = $('sessionPage')
const sessionPageBody = $('sessionPageBody')
const sessionPageMissing = $('sessionPageMissing')
const sessionPageTitle = $('sessionPageTitle')
const sessionPageMeta = $('sessionPageMeta')
const sessionPageStatus = $('sessionPageStatus')
const recipientList = $('recipientList')
const recipientsCount = $('recipientsCount')
const sessionHistoryList = $('sessionHistoryList')
const composerModeHint = $('composerModeHint')
const modeSingleBtn = $('modeSingle')
const modeBroadcastBtn = $('modeBroadcast')
const selectedLabel = $('selectedLabel')
const manualLabel = $('manualLabel')
const manualPhoneInput = $('manualPhone')
const broadcastBtnLabel = $('broadcastBtnLabel')
const templateHint = $('templateHint')

const state = {
  route: { name: 'dashboard', sessionId: null },
  sessions: [],
  sessionsLoaded: false,
  sessionsSignature: '',
  sessionsLoading: false,
  recipients: new Map(),
  activeJob: null,
  lastJob: null,
  jobPolling: false,
  historyLoading: false,
  historySignature: '',
  sessionHistoryLoading: false,
  sessionHistorySignature: '',
  delay: { min: 30, max: 45 },
  sendMode: 'single',
  pingMs: null,
}

const qrCache = new Map()
let jobPollTimer = null
let countdownTimer = null

/* ---------- helpers ---------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.text !== undefined) node.textContent = props.text
  if (props.title) node.title = props.title
  if (props.attrs) {
    for (const [name, value] of Object.entries(props.attrs)) {
      if (value === undefined || value === null || value === false) continue
      node.setAttribute(name, value === true ? '' : String(value))
    }
  }
  if (props.on) {
    for (const [name, handler] of Object.entries(props.on)) {
      node.addEventListener(name, handler)
    }
  }
  for (const child of children) {
    if (child) node.append(child)
  }
  return node
}

const enc = (value) => encodeURIComponent(value)

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function phoneFromJid(jid) {
  const raw = String(jid ?? '')
  return digitsOnly(raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw)
}

function customerNameForJid(jid) {
  return `+${phoneFromJid(jid)}`
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0)
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const time = date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })
  if (date.toDateString() === now.toDateString()) return time
  return `${date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} ${time}`
}

function formatDuration(totalSeconds) {
  if (totalSeconds <= 0) return 'tanpa jeda'
  if (totalSeconds < 60) return `${totalSeconds} dtk`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes} mnt` : `${minutes} mnt ${seconds} dtk`
}

const statusLabels = {
  connected: 'Terhubung',
  connecting: 'Menunggu',
  disconnected: 'Terputus',
  logged_out: 'Logout',
  error: 'Error',
}

function statusBadge(status) {
  const tone =
    status === 'connected' ? 'ok' : status === 'connecting' ? 'warn' : 'err'
  return el('span', {
    class: `badge ${tone}`,
    text: statusLabels[status] ?? status,
  })
}

function errorText(res, body) {
  if (body && typeof body.error === 'string') {
    return body.details ? `${body.error}` : body.error
  }
  return `HTTP ${res.status}`
}

async function api(path, options = {}) {
  const token = sessionTokenInput.value.trim()
  const res = await fetch(path, {
    ...options,
    headers: {
      'x-api-key': apiKeyInput.value.trim(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close()
  else dialog.removeAttribute('open')
}

function showBroadcastError(message) {
  broadcastError.textContent = message ?? ''
  broadcastError.classList.toggle('hidden', !message)
}

function showKeyHint(message) {
  serviceMeta.textContent = message
}

/* ---------- service & stats ---------- */

async function refreshService() {
  const started = performance.now()
  try {
    const res = await fetch('/')
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error('offline')
    state.pingMs = Math.round(performance.now() - started)
    serviceMeta.textContent = `${body.name} v${body.version} · ping ${state.pingMs} ms`
    $('statServer').textContent = 'Online'
    $('statServerHint').textContent = `v${body.version} · ping ${state.pingMs} ms`
  } catch {
    state.pingMs = null
    serviceMeta.textContent = 'Server tidak merespons'
    $('statServer').textContent = 'Offline'
    $('statServerHint').textContent = 'Tidak dapat menghubungi server'
  }
}

async function refreshStats() {
  const { res, body } = await api('/stats')
  if (!res.ok) {
    if (res.status === 401) showKeyHint('API key salah atau belum diisi.')
    return
  }

  const active = body.sessions.connected
  const total = body.sessions.total
  $('statSessions').textContent = `${active} / ${total}`
  $('statSessionsHint').textContent =
    total === 0
      ? 'Belum ada sesi'
      : active === total
        ? 'Semua sesi terhubung'
        : `${total - active} sesi belum tertaut`

  $('statMessages').textContent = formatNumber(body.messages.total)
  $('statMessagesHint').textContent = `${formatNumber(body.messages.today)} hari ini`
}

/* ---------- delay ---------- */

function isValidDelay(min, max) {
  return (
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 10 &&
    max <= 600 &&
    max >= min
  )
}

function loadDelay() {
  try {
    const stored = JSON.parse(localStorage.getItem(DELAY_STORAGE) ?? '')
    if (isValidDelay(stored?.min, stored?.max)) {
      state.delay = { min: stored.min, max: stored.max }
    }
  } catch {
    // ignore corrupt storage
  }
}

function setDelay(min, max, persist = true) {
  state.delay = { min, max }
  delayMinInput.value = String(min)
  delayMaxInput.value = String(max)
  if (persist) localStorage.setItem(DELAY_STORAGE, JSON.stringify(state.delay))
  updateDelayUi()
}

function readCustomDelay() {
  const min = Number(delayMinInput.value)
  const max = Number(delayMaxInput.value)
  if (!isValidDelay(min, max)) {
    delayHint.textContent =
      'Rentang tidak valid: minimal 10 detik, maksimal 600 detik, dan maks ≥ min.'
    delayHint.classList.add('error-text')
    return false
  }
  delayHint.classList.remove('error-text')
  setDelay(Math.round(min), Math.round(max))
  return true
}

function updateDelayUi() {
  const { min, max } = state.delay
  delayMinInput.value = String(min)
  delayMaxInput.value = String(max)
  delayHint.classList.remove('error-text')
  delayHint.textContent = `Rentang jeda ${min}–${max} detik (acak per pesan).`
  $('statDelay').textContent = `${min}–${max} dtk`
  $('statDelayHint').textContent = 'Acak per pesan'

  for (const button of document.querySelectorAll('.preset')) {
    const active =
      Number(button.dataset.min) === min && Number(button.dataset.max) === max
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  }

  composerDelay.textContent = `Jeda acak ${min}–${max} dtk per pesan`
  updateComposer()
}

/* ---------- sessions ---------- */

async function refreshSessions() {
  if (state.sessionsLoading) return
  state.sessionsLoading = true
  try {
    const { res, body } = await api('/sessions')
    if (!res.ok) {
      if (res.status === 401) showKeyHint('API key salah atau belum diisi.')
      return
    }
    state.sessions = Array.isArray(body.sessions) ? body.sessions : []
    state.sessionsLoaded = true
    for (const sessionId of [...qrCache.keys()]) {
      const session = state.sessions.find((item) => item.sessionId === sessionId)
      if (!session || session.status !== 'connecting' || session.mode !== 'qr') {
        qrCache.delete(sessionId)
      }
    }
    const signature = JSON.stringify(
      state.sessions.map((session) => [
        session.sessionId,
        session.status,
        session.me,
        session.sentToday,
      ]),
    )
    if (signature !== state.sessionsSignature) {
      state.sessionsSignature = signature
      renderSessions()
      renderSessionPage()
      updateHistoryFilter()
    }
    await refreshCredentials()
  } catch {
    showKeyHint('Gagal memuat sesi dari server.')
  } finally {
    state.sessionsLoading = false
  }
}

function renderSessions() {
  sessionList.textContent = ''

  if (state.sessions.length === 0) {
    sessionList.append(
      el('p', {
        class: 'empty',
        text: 'Belum ada nomor tersambung. Klik “Tambah Nomor” untuk pairing atau scan QR.',
      }),
    )
    return
  }

  for (const session of state.sessions) {
    sessionList.append(renderSessionCard(session))
  }
}

function renderSessionCard(session) {
  const card = el('article', { class: `session-card ${session.status}` })

  card.append(
    el('div', { class: 'session-head' }, [
      el('span', { class: `dot ${session.status}` }),
      el('span', { class: 'session-title', text: session.sessionId, title: session.sessionId }),
      state.activeJob?.sessionId === session.sessionId
        ? el('span', { class: 'badge run', text: 'Broadcast berjalan' })
        : null,
      statusBadge(session.status),
    ]),
  )

  card.append(
    el('p', {
      class: 'session-phone',
      text: session.me
        ? `+${phoneFromJid(session.me)}`
        : session.mode === 'qr'
          ? 'Menunggu scan QR'
          : 'Menunggu kode pairing',
    }),
  )

  if (session.salesId) {
    card.append(
      el('p', {
        class: 'hint',
        text: session.agentId
          ? `Sales ${session.salesId} · Agent ${session.agentId}`
          : `Sales ${session.salesId}`,
      }),
    )
  }

  if (session.status === 'connecting') {
    if (session.mode === 'pairing') {
      card.append(
        el('p', {
          class: 'pairing-code',
          text: 'Meminta kode pairing…',
          attrs: { id: `pairing-${session.sessionId}` },
        }),
      )
      card.append(
        el('p', {
          class: 'hint',
          text: 'Buka WhatsApp → Perangkat tertaut → Tautkan dengan nomor telepon.',
        }),
      )
    } else {
      const image = el('img', {
        attrs: {
          id: `qr-${session.sessionId}`,
          alt: `QR WhatsApp sesi ${session.sessionId}`,
          width: '148',
          height: '148',
        },
      })
      if (qrCache.has(session.sessionId)) {
        image.src = qrCache.get(session.sessionId)
      } else {
        image.classList.add('hidden')
      }
      card.append(
        el('div', { class: 'qr-wrap' }, [
          image,
          el('p', {
            class: 'hint',
            text: 'Menunggu QR…',
            attrs: { id: `qr-hint-${session.sessionId}` },
          }),
        ]),
      )
    }
  }

  if (session.status === 'logged_out') {
    card.append(
      el('p', {
        class: 'hint',
        text: 'Sesi logout. Tambah ulang dengan Session ID yang sama untuk pairing.',
      }),
    )
  }

  card.append(
    el('div', { class: 'session-meta' }, [
      el('span', { text: `${formatNumber(session.sentToday ?? 0)} pesan hari ini` }),
      el('span', { text: session.mode === 'qr' ? 'QR' : 'Pairing' }),
    ]),
  )

  const actions = el('div', { class: 'session-actions' })
  const sendBtn = el('button', {
    class: 'btn primary small',
    type: 'button',
    text: session.connected ? 'Kirim Pesan' : 'Belum Terhubung',
    on: { click: () => navigateToSession(session.sessionId) },
  })
  sendBtn.disabled = !session.connected
  actions.append(sendBtn)

  if (session.status === 'connected' || session.status === 'connecting') {
    actions.append(
      el('button', {
        class: 'btn ghost small',
        type: 'button',
        text: 'Logout',
        on: { click: () => logoutSession(session.sessionId) },
      }),
    )
  }

  actions.append(
    el('button', {
      class: 'btn danger small',
      type: 'button',
      text: 'Hapus',
      on: { click: () => deleteSession(session.sessionId) },
    }),
  )

  card.append(actions)
  return card
}

async function refreshCredentials() {
  const connecting = state.sessions.filter(
    (session) => session.status === 'connecting',
  )

  await Promise.allSettled(
    connecting.map(async (session) => {
      if (session.mode === 'qr') {
        const { res, body } = await api(`/sessions/${enc(session.sessionId)}/qr`)
        if (!res.ok) return

        const image = $(`qr-${session.sessionId}`)
        const hint = $(`qr-hint-${session.sessionId}`)
        if (body.qr) {
          qrCache.set(session.sessionId, body.qr)
          if (image) {
            image.src = body.qr
            image.classList.remove('hidden')
          }
          if (hint) hint.classList.add('hidden')
        } else {
          qrCache.delete(session.sessionId)
          if (image) image.classList.add('hidden')
          if (hint) hint.classList.remove('hidden')
        }
        return
      }

      const { res, body } = await api(
        `/sessions/${enc(session.sessionId)}/pairing`,
      )
      if (!res.ok) return
      const code = $(`pairing-${session.sessionId}`)
      if (!code) return
      if (body.pairingCode) {
        code.textContent = body.pairingCode
      } else if (body.error) {
        code.textContent = `Gagal meminta kode: ${body.error}`
      } else {
        code.textContent = 'Meminta kode pairing…'
      }
    }),
  )
}

function updateHistoryFilter() {
  const signature = state.sessions
    .map((session) => `${session.sessionId}:${session.status}`)
    .join('|')

  if (historyFilter.dataset.signature !== signature) {
    const current = historyFilter.value
    historyFilter.dataset.signature = signature
    historyFilter.textContent = ''
    historyFilter.append(el('option', { text: 'Semua sesi', attrs: { value: '' } }))
    for (const session of state.sessions) {
      historyFilter.append(
        el('option', {
          text: session.sessionId,
          attrs: { value: session.sessionId },
        }),
      )
    }
    historyFilter.value = state.sessions.some(
      (session) => session.sessionId === current,
    )
      ? current
      : ''
  }

  updateComposer()
}

async function logoutSession(sessionId) {
  if (!confirm(`Logout sesi "${sessionId}"? Auth sesi ini akan dihapus.`)) return

  const { res, body } = await api(`/sessions/${enc(sessionId)}/logout`, {
    method: 'POST',
  })
  if (!res.ok) {
    alert(errorText(res, body))
    return
  }

  qrCache.delete(sessionId)
  if (state.activeJob?.sessionId === sessionId) stopJobTracking()
  await refreshSessions()
  await refreshStats()
}

async function deleteSession(sessionId) {
  if (!confirm(`Hapus sesi "${sessionId}"? Auth sesi ini akan dihapus.`)) return

  const { res, body } = await api(`/sessions/${enc(sessionId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    alert(errorText(res, body))
    return
  }

  qrCache.delete(sessionId)
  if (state.activeJob?.sessionId === sessionId) stopJobTracking()
  await refreshSessions()
  await refreshStats()
}

/* ---------- router & session page ---------- */

const SESSION_HASH_RE = /^\/session\/([A-Za-z0-9_\-]{1,32})$/

function parseRoute() {
  const match = location.hash.replace(/^#/, '').match(SESSION_HASH_RE)
  if (!match) return { name: 'dashboard', sessionId: null }
  return { name: 'session', sessionId: match[1] }
}

function navigateToSession(sessionId) {
  location.hash = `#/session/${encodeURIComponent(sessionId)}`
}

function applyRoute() {
  state.route = parseRoute()
  const onSession = state.route.name === 'session'

  for (const node of document.querySelectorAll('[data-route="dashboard"]')) {
    node.classList.toggle('hidden', onSession)
  }
  sessionPage.classList.toggle('hidden', !onSession)

  if (onSession) {
    state.sessionHistorySignature = ''
    renderRecipients()
    void refreshSessionHistory()
    syncJobCard()
    void resumeJobTracking(state.route.sessionId)
  }

  renderSessionPage()
  renderSelection()
  updateComposer()
}

function renderSessionPage() {
  if (state.route.name !== 'session') return
  sessionPageStatus.textContent = ''

  const session = state.sessions.find(
    (item) => item.sessionId === state.route.sessionId,
  )

  if (!session) {
    sessionPageTitle.textContent = state.route.sessionId
    sessionPageMeta.textContent = state.sessionsLoaded
      ? 'Sesi tidak ditemukan.'
      : 'Memuat sesi…'
    sessionPageBody.classList.add('hidden')
    sessionPageMissing.classList.remove('hidden')
    return
  }

  sessionPageBody.classList.remove('hidden')
  sessionPageMissing.classList.add('hidden')
  sessionPageTitle.textContent = session.sessionId
  sessionPageMeta.textContent = session.me
    ? `+${phoneFromJid(session.me)} · ${formatNumber(session.sentToday ?? 0)} pesan hari ini`
    : session.mode === 'qr'
      ? 'Menunggu scan QR'
      : 'Menunggu kode pairing'
  sessionPageStatus.append(statusBadge(session.status))
}

function currentRecipients() {
  let map = state.recipients.get(state.route.sessionId)
  if (!map) {
    map = new Map()
    state.recipients.set(state.route.sessionId, map)
  }
  return map
}

function renderRecipients() {
  if (state.route.name !== 'session') return
  recipientList.textContent = ''

  const selected = currentRecipients()
  recipientsCount.textContent = `${selected.size} penerima ditambahkan`

  if (selected.size === 0) {
    recipientList.append(
      el('p', {
        class: 'empty',
        text: 'Belum ada penerima. Tambahkan nama dan nomor WhatsApp di atas.',
      }),
    )
    return
  }

  for (const recipient of selected.values()) {
    recipientList.append(renderRecipientItem(recipient, selected))
  }
}

function renderRecipientItem(recipient, selected) {
  const key = digitsOnly(recipient.phone)
  const item = el('div', { class: 'customer-item selected' })

  const main = el('div', { class: 'customer-main' }, [
    el('div', { class: 'customer-name', text: recipient.name || `+${key}` }),
    el('div', { class: 'customer-phone', text: `+${key}` }),
  ])

  const actions = el('div', { class: 'customer-actions' }, [
    el('button', {
      class: 'icon-btn',
      type: 'button',
      text: '×',
      title: 'Hapus penerima',
      attrs: { 'aria-label': `Hapus ${recipient.name || key}` },
      on: {
        click: () => {
          selected.delete(key)
          renderRecipients()
          renderSelection()
        },
      },
    }),
  ])

  item.append(main, actions)
  return item
}

function showRecipientError(message) {
  recipientError.textContent = message ?? ''
  recipientError.classList.toggle('hidden', !message)
}

function addRecipientFromForm() {
  const name = recipientNameInput.value.trim()
  const phone = digitsOnly(recipientPhoneInput.value)

  if (phone.length < 8 || phone.length > 15) {
    showRecipientError('Nomor WhatsApp harus 8–15 digit.')
    return
  }
  const selected = currentRecipients()
  if (!selected.has(phone) && selected.size >= 100) {
    showRecipientError('Maksimal 100 penerima per broadcast.')
    return
  }

  selected.set(phone, { name, phone })
  showRecipientError('')
  recipientNameInput.value = ''
  recipientPhoneInput.value = ''
  recipientNameInput.focus()
  renderRecipients()
  renderSelection()
}

addRecipientBtn.addEventListener('click', addRecipientFromForm)

recipientPhoneInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  addRecipientFromForm()
})

function isJobVisible() {
  return (
    state.route.name === 'session' &&
    state.activeJob?.sessionId === state.route.sessionId
  )
}

function syncJobCard() {
  const visible = isJobVisible()
  broadcastProgress.classList.toggle('hidden', !visible)
  cancelBroadcastBtn.classList.toggle('hidden', !visible)
}

async function resumeJobTracking(sessionId) {
  if (state.activeJob) return
  try {
    const { res, body } = await api(
      `/sessions/${enc(sessionId)}/broadcast/current`,
    )
    if (!res.ok) return
    if (body && body.jobId && body.status === 'running') {
      startJobTracking(sessionId, body.jobId)
    }
  } catch {
    // ignore resume failures
  }
}

/* ---------- customers ---------- */

function renderSelection() {
  if (state.route.name !== 'session') return

  const chosen = [...currentRecipients().values()]
  const count = chosen.length
  selectedCountEl.textContent = `${count} penerima`
  selectedChipsEl.textContent = ''

  for (const recipient of chosen.slice(0, 4)) {
    selectedChipsEl.append(
      el('span', {
        class: 'chip',
        text: recipient.name || `+${digitsOnly(recipient.phone)}`,
      }),
    )
  }
  if (count > 4) {
    selectedChipsEl.append(
      el('span', { class: 'chip', text: `+${count - 4} lagi` }),
    )
  }

  updateComposer()
}

/* ---------- session dialog ---------- */

function updateModeUi() {
  const pairing = sessionModeSelect.value === 'pairing'
  phoneField.classList.toggle('hidden', !pairing)
  sessionPhoneInput.required = pairing
}

sessionModeSelect.addEventListener('change', updateModeUi)

sessionForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const salesId = sessionSalesIdInput.value.trim()
  const agentId = sessionAgentIdInput.value.trim()
  const sessionId = sessionIdInput.value.trim()
  const mode = sessionModeSelect.value
  const phone = digitsOnly(sessionPhoneInput.value)

  if (!salesId) return showSessionError('Sales ID wajib diisi.')
  if (mode === 'pairing' && (phone.length < 8 || phone.length > 15)) {
    return showSessionError('Nomor WhatsApp harus 8–15 digit.')
  }

  createSessionBtn.disabled = true
  showSessionError('')
  try {
    const { res, body } = await api('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salesId,
        ...(agentId ? { agentId } : {}),
        ...(sessionId ? { sessionId } : {}),
        mode,
        ...(mode === 'pairing' ? { phone } : {}),
      }),
    })

    if (!res.ok) {
      showSessionError(
        res.status === 409
          ? `${errorText(res, body)} — sesi sudah aktif atau batas sesi tercapai.`
          : errorText(res, body),
      )
      return
    }

    if (typeof body.token === 'string') {
      sessionTokenInput.value = body.token
      localStorage.setItem(TOKEN_STORAGE, body.token)
      alert(
        `Token sesi ${body.sessionId}:\n\n${body.token}\n\nSimpan sekarang — token hanya ditampilkan sekali.`,
      )
    }

    closeDialog(sessionDialog)
    sessionForm.reset()
    updateModeUi()
    qrCache.delete(body.sessionId ?? sessionId)
    await refreshSessions()
    await refreshStats()
  } finally {
    createSessionBtn.disabled = false
  }
})

function showSessionError(message) {
  sessionError.textContent = message
  sessionError.classList.toggle('hidden', !message)
}

/* ---------- composer ---------- */

function manualPhoneDigits() {
  return digitsOnly(manualPhoneInput.value)
}

function setSendMode(mode) {
  if (mode !== 'single' && mode !== 'broadcast') return
  state.sendMode = mode
  const single = mode === 'single'

  modeSingleBtn.classList.toggle('active', single)
  modeSingleBtn.setAttribute('aria-pressed', String(single))
  modeBroadcastBtn.classList.toggle('active', !single)
  modeBroadcastBtn.setAttribute('aria-pressed', String(!single))

  selectedLabel.classList.toggle('hidden', single)
  selectedChipsEl.classList.toggle('hidden', single)
  manualLabel.classList.toggle('hidden', !single)

  composerModeHint.textContent = single
    ? 'Masukkan nomor WhatsApp, lalu kirim langsung tanpa jeda.'
    : 'Tambahkan penerima, lalu kirim dengan delay acak sesuai preset.'

  broadcastBtnLabel.textContent = single ? 'Kirim Pesan' : 'Kirim Broadcast'
  broadcastText.placeholder = single
    ? 'Tulis pesan…'
    : 'Halo, ada promo khusus hari ini…'
  templateHint.classList.toggle('hidden', single)
  showBroadcastError('')
  if (state.route.name === 'session') renderRecipients()
  renderSelection()
  updateComposer()
}

function updateComposer() {
  const { min, max } = state.delay
  const onSession = state.route.name === 'session'
  const single = state.sendMode === 'single'
  const count = onSession ? currentRecipients().size : 0
  const session = onSession
    ? state.sessions.find((item) => item.sessionId === state.route.sessionId)
    : null
  const eligible = Boolean(session?.connected)

  if (single) {
    composerEstimate.textContent =
      manualPhoneDigits().length >= 8
        ? 'Kirim langsung ke 1 nomor, tanpa jeda.'
        : 'Masukkan nomor WhatsApp dulu.'
  } else if (count === 0) {
    composerEstimate.textContent = 'Tambahkan penerima dulu.'
  } else if (count === 1) {
    composerEstimate.textContent = '1 penerima · tanpa jeda awal.'
  } else {
    composerEstimate.textContent = `Estimasi total ${formatDuration((count - 1) * min)} – ${formatDuration((count - 1) * max)} untuk ${count} penerima.`
  }

  composerDelay.textContent = single
    ? 'Mode 1 orang: tanpa delay'
    : `Jeda acak ${min}–${max} dtk per pesan`

  const ready = single
    ? manualPhoneDigits().length >= 8 &&
      manualPhoneDigits().length <= 15 &&
      broadcastText.value.trim().length > 0 &&
      eligible &&
      !state.activeJob
    : count > 0 &&
      broadcastText.value.trim().length > 0 &&
      eligible &&
      !state.activeJob
  broadcastBtn.disabled = !ready
}

broadcastText.addEventListener('input', updateComposer)
manualPhoneInput.addEventListener('input', updateComposer)

modeSingleBtn.addEventListener('click', () => setSendMode('single'))
modeBroadcastBtn.addEventListener('click', () => setSendMode('broadcast'))

for (const button of document.querySelectorAll('.preset')) {
  button.addEventListener('click', () => {
    setDelay(Number(button.dataset.min), Number(button.dataset.max))
  })
}

delayMinInput.addEventListener('change', readCustomDelay)
delayMaxInput.addEventListener('change', readCustomDelay)

broadcastForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const sessionId = state.route.sessionId
  const session = state.sessions.find((item) => item.sessionId === sessionId)
  if (state.route.name !== 'session' || !sessionId || !session) {
    return showBroadcastError('Sesi tidak ditemukan.')
  }

  const text = broadcastText.value.trim()
  if (!text) return showBroadcastError('Isi pesan belum diisi.')

  if (!session.connected) {
    return showBroadcastError(
      'Sesi belum terhubung. Selesaikan pairing/QR dulu.',
    )
  }

  const single = state.sendMode === 'single'

  if (single) {
    const phone = manualPhoneDigits()
    if (phone.length < 8 || phone.length > 15) {
      return showBroadcastError('Nomor WhatsApp harus 8–15 digit.')
    }
  } else {
    if (currentRecipients().size === 0) {
      return showBroadcastError('Tambahkan minimal satu penerima.')
    }
    if (currentRecipients().size > 100) {
      return showBroadcastError('Maksimal 100 penerima per broadcast.')
    }
    if (!readCustomDelay()) {
      return showBroadcastError('Rentang delay tidak valid (10–600 detik).')
    }
    const { min, max } = state.delay
    if (!isValidDelay(min, max)) {
      return showBroadcastError('Rentang delay tidak valid (10–600 detik).')
    }
  }

  showBroadcastError('')
  broadcastBtn.disabled = true
  try {
    if (single) {
      const { res, body } = await api(
        `/sessions/${enc(sessionId)}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: manualPhoneDigits(), text }),
        },
      )

      if (!res.ok) {
        showBroadcastError(errorText(res, body))
        updateComposer()
        return
      }

      showBroadcastError('')
      broadcastText.value = ''
      updateComposer()
      void refreshStats()
      void refreshHistory()
      void refreshSessionHistory()
      return
    }

    const recipients = [...currentRecipients().values()].map((recipient) => ({
      to: recipient.phone,
      ...(recipient.name ? { name: recipient.name } : {}),
    }))
    const { min, max } = state.delay
    const { res, body } = await api(
      `/sessions/${enc(sessionId)}/broadcast`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients,
          text,
          delayMinMs: min * 1000,
          delayMaxMs: max * 1000,
        }),
      },
    )

    if (!res.ok) {
      showBroadcastError(errorText(res, body))
      updateComposer()
      return
    }

    startJobTracking(sessionId, body.jobId)
  } catch (err) {
    showBroadcastError(
      err instanceof Error ? err.message : 'Gagal mengirim pesan.',
    )
    updateComposer()
  }
})

/* ---------- job tracking ---------- */

function startJobTracking(sessionId, jobId) {
  state.activeJob = { sessionId, jobId }
  state.lastJob = null

  broadcastProgress.classList.remove('hidden')
  jobResultsEl.textContent = ''
  jobStatusEl.textContent = 'Berjalan'
  jobCountsEl.textContent = 'Menyiapkan pengiriman…'
  jobCountdownEl.textContent = 'Menunggu status…'
  jobBarEl.style.width = '0%'
  cancelBroadcastBtn.classList.remove('hidden')
  cancelBroadcastBtn.disabled = false

  stopJobTimers()
  renderSessions()
  void pollJob()
  jobPollTimer = setInterval(pollJob, 2000)
  countdownTimer = setInterval(updateCountdown, 1000)
  updateComposer()
}

async function pollJob() {
  if (!state.activeJob || state.jobPolling) return
  state.jobPolling = true
  try {
    const { sessionId, jobId } = state.activeJob
    const { res, body } = await api(
      `/sessions/${enc(sessionId)}/broadcast/${enc(jobId)}`,
    )

    if (!res.ok) {
      if (isJobVisible()) showBroadcastError(errorText(res, body))
      if (res.status === 404) stopJobTracking()
      return
    }

    state.lastJob = body
    if (isJobVisible()) renderJob(body)

    if (body.status !== 'running') {
      stopJobTimers()
      state.activeJob = null
      cancelBroadcastBtn.classList.add('hidden')
      renderSessions()
      updateComposer()
      void refreshSessions()
      void refreshStats()
      void refreshHistory()
      void refreshSessionHistory()
    }
  } catch (err) {
    showBroadcastError(
      err instanceof Error ? err.message : 'Gagal memantau broadcast.',
    )
  } finally {
    state.jobPolling = false
  }
}

function renderJob(job) {
  const labels = {
    running: 'Berjalan',
    completed: 'Selesai',
    cancelled: 'Dibatalkan',
    failed: 'Gagal',
  }
  jobStatusEl.textContent = labels[job.status] ?? job.status
  jobCountsEl.textContent = `Terkirim ${job.sent} · Gagal ${job.failed} · Total ${job.total}`

  const processed = job.sent + job.failed
  const percent = job.total > 0 ? Math.min(100, (processed / job.total) * 100) : 0
  jobBarEl.style.width = `${percent}%`

  jobResultsEl.textContent = ''
  const shown = Array.isArray(job.results) ? job.results.slice(-6) : []
  for (const result of shown) {
    jobResultsEl.append(
      el('li', {}, [
        el('span', { text: result.customerName || customerNameForJid(result.to) }),
        el('span', {
          text: result.ok ? 'terkirim' : result.error ?? 'gagal',
          class: result.ok ? '' : 'error-text',
        }),
      ]),
    )
  }

  updateCountdown()
}

function updateCountdown() {
  if (!isJobVisible()) return
  const job = state.lastJob
  if (!job) return
  if (job.status !== 'running') {
    jobCountdownEl.textContent = `Job ${job.status}.`
    return
  }
  if (job.nextSendAt) {
    const seconds = Math.max(0, Math.ceil((job.nextSendAt - Date.now()) / 1000))
    jobCountdownEl.textContent = `Kirim berikutnya dalam ${seconds} detik.`
  } else {
    jobCountdownEl.textContent = 'Mengirim pesan…'
  }
}

function stopJobTimers() {
  if (jobPollTimer) clearInterval(jobPollTimer)
  if (countdownTimer) clearInterval(countdownTimer)
  jobPollTimer = null
  countdownTimer = null
}

function stopJobTracking() {
  stopJobTimers()
  state.activeJob = null
  state.lastJob = null
  broadcastProgress.classList.add('hidden')
  cancelBroadcastBtn.classList.add('hidden')
  renderSessions()
  updateComposer()
}

cancelBroadcastBtn.addEventListener('click', async () => {
  if (!state.activeJob) return
  cancelBroadcastBtn.disabled = true

  const { sessionId, jobId } = state.activeJob
  const { res, body } = await api(
    `/sessions/${enc(sessionId)}/broadcast/${enc(jobId)}/cancel`,
    { method: 'POST' },
  )

  if (!res.ok) {
    if (isJobVisible()) showBroadcastError(errorText(res, body))
    cancelBroadcastBtn.disabled = false
    return
  }

  await pollJob()
})

/* ---------- history ---------- */

async function refreshHistory() {
  if (state.historyLoading) return
  state.historyLoading = true
  try {
    const filter = historyFilter.value
    const params = new URLSearchParams({ limit: '15' })
    if (filter) params.set('sessionId', filter)

    const { res, body } = await api(`/messages?${params.toString()}`)
    if (!res.ok) return
    const messages = Array.isArray(body.messages) ? body.messages : []
    const signature = JSON.stringify(messages)
    if (signature !== state.historySignature) {
      state.historySignature = signature
      renderHistory(historyList, messages, true)
    }
  } catch {
    // keep previous history on network errors
  } finally {
    state.historyLoading = false
  }
}

async function refreshSessionHistory() {
  if (state.route.name !== 'session' || state.sessionHistoryLoading) return
  state.sessionHistoryLoading = true
  try {
    const params = new URLSearchParams({
      limit: '15',
      sessionId: state.route.sessionId,
    })

    const { res, body } = await api(`/messages?${params.toString()}`)
    if (!res.ok) return
    const messages = Array.isArray(body.messages) ? body.messages : []
    const signature = JSON.stringify(messages)
    if (signature !== state.sessionHistorySignature) {
      state.sessionHistorySignature = signature
      renderHistory(sessionHistoryList, messages, false)
    }
  } catch {
    // keep previous history on network errors
  } finally {
    state.sessionHistoryLoading = false
  }
}

function renderHistory(target, messages, withSession) {
  target.textContent = ''

  if (messages.length === 0) {
    target.append(
      el('li', { class: 'empty', text: 'Belum ada riwayat pengiriman.' }),
    )
    return
  }

  for (const message of messages) {
    const name = message.customerName ?? `+${phoneFromJid(message.to)}`
    const preview = message.text ? message.text.replace(/\s+/g, ' ') : '—'
    target.append(
      el('li', { class: 'history-item' }, [
        el('span', {
          class: `dot ${message.status === 'sent' ? 'connected' : 'error'}`,
        }),
        el('div', { class: 'history-who' }, [
          el('strong', {
            text: withSession ? `${message.sessionId} → ${name}` : name,
          }),
          el('div', { class: 'history-text', text: preview, title: preview }),
        ]),
        el('div', { class: 'history-time' }, [
          el('div', { text: formatDateTime(message.createdAt) }),
          el('div', {
            text: message.status === 'sent' ? 'terkirim' : 'gagal',
            class: message.status === 'sent' ? '' : 'error-text',
          }),
        ]),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          text: '×',
          attrs: { 'aria-label': `Hapus pesan ke ${name}` },
          on: { click: () => deleteHistoryMessage(message.id) },
        }),
      ]),
    )
  }
}

async function deleteHistoryMessage(id) {
  if (!confirm('Hapus pesan ini dari riwayat?')) return

  const { res, body } = await api(`/messages/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    alert(errorText(res, body))
    return
  }

  state.historySignature = ''
  state.sessionHistorySignature = ''
  await refreshHistory()
  await refreshSessionHistory()
  await refreshStats()
}

historyFilter.addEventListener('change', () => {
  void refreshHistory()
})

$('backToDashboard').addEventListener('click', () => {
  location.hash = '#/'
})

window.addEventListener('hashchange', applyRoute)

/* ---------- global events ---------- */

$('saveKey').addEventListener('click', () => {
  localStorage.setItem(KEY_STORAGE, apiKeyInput.value.trim())
  localStorage.setItem(TOKEN_STORAGE, sessionTokenInput.value.trim())
  void refreshSessions()
  void refreshStats()
  void refreshHistory()
})

apiKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    $('saveKey').click()
  }
})

sessionTokenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    $('saveKey').click()
  }
})

$('addSessionBtn').addEventListener('click', () => openDialog(sessionDialog))
$('addSessionBtn2').addEventListener('click', () => openDialog(sessionDialog))

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => closeDialog(button.closest('dialog')))
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog)
  })
}

/* ---------- init ---------- */

apiKeyInput.value = localStorage.getItem(KEY_STORAGE) ?? ''
sessionTokenInput.value = localStorage.getItem(TOKEN_STORAGE) ?? ''

loadDelay()
setDelay(state.delay.min, state.delay.max, false)
updateModeUi()
setSendMode('single')
applyRoute()

void refreshService()
void refreshStats()
void refreshSessions()
void refreshHistory()

setInterval(() => void refreshService(), 15000)
setInterval(() => void refreshStats(), 8000)
setInterval(() => void refreshSessions(), 3000)
setInterval(() => {
  void refreshHistory()
  void refreshSessionHistory()
}, 6000)