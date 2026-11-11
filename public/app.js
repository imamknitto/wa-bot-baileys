const $ = (id) => document.getElementById(id)

const KEY_STORAGE = 'apiKey'
const DELAY_STORAGE = 'broadcastDelay'

const apiKeyInput = $('apiKey')
const serviceMeta = $('serviceMeta')
const sessionList = $('sessionList')
const customerList = $('customerList')
const customerSearch = $('customerSearch')
const loadMoreBtn = $('loadMoreCustomers')
const sessionForm = $('sessionForm')
const sessionDialog = $('sessionDialog')
const sessionIdInput = $('sessionId')
const sessionModeSelect = $('sessionMode')
const sessionPhoneInput = $('sessionPhone')
const phoneField = $('phoneField')
const createSessionBtn = $('createSessionBtn')
const sessionError = $('sessionError')
const customerForm = $('customerForm')
const customerDialog = $('customerDialog')
const customerDialogTitle = $('customerDialogTitle')
const customerNameInput = $('customerName')
const customerPhoneInput = $('customerPhone')
const customerNoteInput = $('customerNote')
const customerError = $('customerError')
const saveCustomerBtn = $('saveCustomerBtn')
const broadcastForm = $('broadcastForm')
const broadcastSessionSelect = $('broadcastSession')
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

const state = {
  sessions: [],
  sessionsSignature: '',
  sessionsLoading: false,
  customers: [],
  customersLoading: false,
  customerCursor: null,
  customerQuery: '',
  selected: new Map(),
  editingCustomerId: null,
  activeJob: null,
  lastJob: null,
  jobPolling: false,
  historyLoading: false,
  historySignature: '',
  delay: { min: 30, max: 45 },
  pingMs: null,
}

const qrCache = new Map()
let jobPollTimer = null
let countdownTimer = null
let searchTimer = null

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
  const phone = phoneFromJid(jid)
  const found = state.customers.find((customer) => customer.phone === phone)
  return found ? found.name : `+${phone}`
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
  const res = await fetch(path, {
    ...options,
    headers: {
      'x-api-key': apiKeyInput.value.trim(),
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
  $('statMessagesHint').textContent = `${formatNumber(body.messages.today)} hari ini · ${formatNumber(body.customers)} customer`
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
      updateSessionSelectors()
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
    on: { click: () => focusComposer(session.sessionId) },
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

function updateSessionSelectors() {
  const signature = state.sessions
    .map((session) => `${session.sessionId}:${session.status}`)
    .join('|')

  if (broadcastSessionSelect.dataset.signature !== signature) {
    const current = broadcastSessionSelect.value
    broadcastSessionSelect.dataset.signature = signature
    broadcastSessionSelect.textContent = ''

    if (state.sessions.length === 0) {
      broadcastSessionSelect.append(
        el('option', {
          text: 'Tidak ada sesi',
          attrs: { value: '', disabled: true, selected: true },
        }),
      )
      broadcastSessionSelect.disabled = true
    } else {
      broadcastSessionSelect.disabled = false
      for (const session of state.sessions) {
        broadcastSessionSelect.append(
          el('option', {
            text: `${session.sessionId}${session.connected ? '' : ` · ${statusLabels[session.status] ?? session.status}`}`,
            attrs: { value: session.sessionId },
          }),
        )
      }
      const stillExists = state.sessions.some(
        (session) => session.sessionId === current,
      )
      const preferred =
        (stillExists && current) ||
        state.sessions.find((session) => session.connected)?.sessionId ||
        state.sessions[0]?.sessionId
      broadcastSessionSelect.value = preferred
    }
  }

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

function focusComposer(sessionId) {
  if (state.sessions.some((session) => session.sessionId === sessionId)) {
    broadcastSessionSelect.value = sessionId
  }
  broadcastForm.scrollIntoView({ behavior: 'smooth', block: 'center' })
  broadcastText.focus({ preventScroll: true })
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

/* ---------- customers ---------- */

async function loadCustomers(append = false) {
  if (state.customersLoading) return
  state.customersLoading = true
  try {
    const params = new URLSearchParams({ limit: '50' })
    if (state.customerQuery) params.set('q', state.customerQuery)
    if (append && state.customerCursor) {
      params.set('cursor', String(state.customerCursor))
    }

    const { res, body } = await api(`/customers?${params.toString()}`)
    if (!res.ok) return

    const rows = Array.isArray(body.customers) ? body.customers : []
    state.customers = append ? [...state.customers, ...rows] : rows
    state.customerCursor = body.nextCursor ?? null

    for (const customer of rows) {
      if (state.selected.has(customer.id)) {
        state.selected.set(customer.id, customer)
      }
    }

    renderCustomers()
  } catch {
    // keep previous list on network errors
  } finally {
    state.customersLoading = false
  }
}

function renderCustomers() {
  customerList.textContent = ''

  const suffix = state.customerCursor ? '+' : ''
  $('customerCount').textContent = state.customerQuery
    ? `${state.customers.length} hasil untuk “${state.customerQuery}”`
    : `${state.customers.length}${suffix} customer terdaftar`

  if (state.customers.length === 0) {
    customerList.append(
      el('p', {
        class: 'empty',
        text: state.customerQuery
          ? 'Customer tidak ditemukan.'
          : 'Belum ada customer. Tambahkan nomor WhatsApp customer dulu.',
      }),
    )
  }

  for (const customer of state.customers) {
    customerList.append(renderCustomerItem(customer))
  }

  loadMoreBtn.classList.toggle('hidden', !state.customerCursor)
  renderSelection()
}

function renderCustomerItem(customer) {
  const item = el('div', {
    class: `customer-item${state.selected.has(customer.id) ? ' selected' : ''}`,
  })

  const checkbox = el('input', {
    attrs: {
      type: 'checkbox',
      'aria-label': `Pilih ${customer.name}`,
    },
  })
  checkbox.checked = state.selected.has(customer.id)
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selected.set(customer.id, customer)
    else state.selected.delete(customer.id)
    item.classList.toggle('selected', checkbox.checked)
    renderSelection()
  })

  const main = el('div', { class: 'customer-main' }, [
    el('div', { class: 'customer-name', text: customer.name }),
    el('div', { class: 'customer-phone', text: `+${customer.phone}` }),
    customer.note
      ? el('div', { class: 'customer-note', text: customer.note, title: customer.note })
      : null,
  ])

  const actions = el('div', { class: 'customer-actions' }, [
    el('button', {
      class: 'icon-btn',
      type: 'button',
      text: '✎',
      title: 'Edit customer',
      attrs: { 'aria-label': `Edit ${customer.name}` },
      on: { click: () => openCustomerEditor(customer) },
    }),
    el('button', {
      class: 'icon-btn',
      type: 'button',
      text: '🗑',
      title: 'Hapus customer',
      attrs: { 'aria-label': `Hapus ${customer.name}` },
      on: { click: () => removeCustomer(customer) },
    }),
  ])

  item.append(checkbox, main, actions)
  return item
}

function renderSelection() {
  const count = state.selected.size
  selectedCountEl.textContent = `${count} customer`
  selectedChipsEl.textContent = ''

  const chosen = [...state.selected.values()]
  for (const customer of chosen.slice(0, 4)) {
    selectedChipsEl.append(el('span', { class: 'chip', text: customer.name }))
  }
  if (count > 4) {
    selectedChipsEl.append(
      el('span', { class: 'chip', text: `+${count - 4} lagi` }),
    )
  }

  updateComposer()
}

function openCustomerEditor(customer = null) {
  state.editingCustomerId = customer ? customer.id : null
  customerDialogTitle.textContent = customer ? 'Edit Customer' : 'Tambah Customer'
  customerNameInput.value = customer?.name ?? ''
  customerPhoneInput.value = customer?.phone ?? ''
  customerNoteInput.value = customer?.note ?? ''
  customerError.classList.add('hidden')
  customerError.textContent = ''
  openDialog(customerDialog)
  customerNameInput.focus()
}

async function removeCustomer(customer) {
  if (!confirm(`Hapus customer "${customer.name}"?`)) return

  const { res, body } = await api(`/customers/${customer.id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    alert(errorText(res, body))
    return
  }

  state.selected.delete(customer.id)
  await loadCustomers()
  await refreshStats()
}

function showCustomerError(message) {
  customerError.textContent = message
  customerError.classList.toggle('hidden', !message)
}

customerForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const name = customerNameInput.value.trim()
  const phone = digitsOnly(customerPhoneInput.value)
  const note = customerNoteInput.value.trim()

  if (!name) return showCustomerError('Nama customer wajib diisi.')
  if (phone.length < 8 || phone.length > 15) {
    return showCustomerError('Nomor WhatsApp harus 8–15 digit.')
  }

  saveCustomerBtn.disabled = true
  showCustomerError('')
  try {
    const payload = { name, phone, note: note || null }
    const path = state.editingCustomerId
      ? `/customers/${state.editingCustomerId}`
      : '/customers'
    const { res, body } = await api(path, {
      method: state.editingCustomerId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      showCustomerError(
        res.status === 409
          ? 'Nomor ini sudah terdaftar sebagai customer.'
          : errorText(res, body),
      )
      return
    }

    closeDialog(customerDialog)
    await loadCustomers()
    await refreshStats()
  } finally {
    saveCustomerBtn.disabled = false
  }
})

customerSearch.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    state.customerQuery = customerSearch.value.trim()
    state.customerCursor = null
    loadCustomers()
  }, 250)
})

loadMoreBtn.addEventListener('click', () => loadCustomers(true))

/* ---------- session dialog ---------- */

function updateModeUi() {
  const pairing = sessionModeSelect.value === 'pairing'
  phoneField.classList.toggle('hidden', !pairing)
  sessionPhoneInput.required = pairing
}

sessionModeSelect.addEventListener('change', updateModeUi)

sessionForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const sessionId = sessionIdInput.value.trim()
  const mode = sessionModeSelect.value
  const phone = digitsOnly(sessionPhoneInput.value)

  if (!sessionId) return showSessionError('Session ID wajib diisi.')
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
        sessionId,
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

    closeDialog(sessionDialog)
    sessionForm.reset()
    updateModeUi()
    qrCache.delete(sessionId)
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

function updateComposer() {
  const { min, max } = state.delay
  const count = state.selected.size
  const eligible = state.sessions.some((session) => session.connected)

  if (count === 0) {
    composerEstimate.textContent = 'Pilih customer dulu.'
  } else if (count === 1) {
    composerEstimate.textContent = '1 penerima · tanpa jeda awal.'
  } else {
    composerEstimate.textContent = `Estimasi total ${formatDuration((count - 1) * min)} – ${formatDuration((count - 1) * max)} untuk ${count} penerima.`
  }

  composerDelay.textContent = `Jeda acak ${min}–${max} dtk per pesan`

  const ready =
    count > 0 &&
    broadcastText.value.trim().length > 0 &&
    eligible &&
    !state.activeJob
  broadcastBtn.disabled = !ready
}

broadcastText.addEventListener('input', updateComposer)
broadcastSessionSelect.addEventListener('change', updateComposer)

for (const button of document.querySelectorAll('.preset')) {
  button.addEventListener('click', () => {
    setDelay(Number(button.dataset.min), Number(button.dataset.max))
  })
}

delayMinInput.addEventListener('change', readCustomDelay)
delayMaxInput.addEventListener('change', readCustomDelay)

broadcastForm.addEventListener('submit', async (event) => {
  event.preventDefault()

  const sessionId = broadcastSessionSelect.value
  const session = state.sessions.find((item) => item.sessionId === sessionId)
  if (!sessionId || !session) return showBroadcastError('Pilih sesi pengirim.')

  const customerIds = [...state.selected.keys()]
  if (customerIds.length === 0) {
    return showBroadcastError('Pilih minimal satu customer.')
  }
  if (customerIds.length > 100) {
    return showBroadcastError('Maksimal 100 penerima per broadcast.')
  }
  if (!session.connected) {
    return showBroadcastError(
      'Sesi belum terhubung. Selesaikan pairing/QR dulu.',
    )
  }

  const text = broadcastText.value.trim()
  if (!text) return showBroadcastError('Isi pesan belum diisi.')

  if (!readCustomDelay()) {
    return showBroadcastError('Rentang delay tidak valid (10–600 detik).')
  }

  const { min, max } = state.delay
  if (!isValidDelay(min, max)) {
    return showBroadcastError('Rentang delay tidak valid (10–600 detik).')
  }

  showBroadcastError('')
  broadcastBtn.disabled = true
  try {
    const { res, body } = await api(
      `/sessions/${enc(sessionId)}/broadcast`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerIds,
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
      err instanceof Error ? err.message : 'Gagal memulai broadcast.',
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
      showBroadcastError(errorText(res, body))
      if (res.status === 404) stopJobTracking()
      return
    }

    state.lastJob = body
    renderJob(body)

    if (body.status !== 'running') {
      stopJobTimers()
      state.activeJob = null
      cancelBroadcastBtn.classList.add('hidden')
      updateComposer()
      void refreshSessions()
      void refreshStats()
      void refreshHistory()
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
        el('span', { text: customerNameForJid(result.to) }),
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
    showBroadcastError(errorText(res, body))
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
      renderHistory(messages)
    }
  } catch {
    // keep previous history on network errors
  } finally {
    state.historyLoading = false
  }
}

function renderHistory(messages) {
  historyList.textContent = ''

  if (messages.length === 0) {
    historyList.append(
      el('li', { class: 'empty', text: 'Belum ada riwayat pengiriman.' }),
    )
    return
  }

  for (const message of messages) {
    const name = message.customerName ?? `+${phoneFromJid(message.to)}`
    const preview = message.text ? message.text.replace(/\s+/g, ' ') : '—'
    historyList.append(
      el('li', { class: 'history-item' }, [
        el('span', {
          class: `dot ${message.status === 'sent' ? 'connected' : 'error'}`,
        }),
        el('div', { class: 'history-who' }, [
          el('strong', { text: `${message.sessionId} → ${name}` }),
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
  await refreshHistory()
  await refreshStats()
}

historyFilter.addEventListener('change', () => {
  void refreshHistory()
})

/* ---------- global events ---------- */

$('saveKey').addEventListener('click', () => {
  localStorage.setItem(KEY_STORAGE, apiKeyInput.value.trim())
  void refreshSessions()
  void refreshStats()
  void loadCustomers()
  void refreshHistory()
})

apiKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    $('saveKey').click()
  }
})

$('addSessionBtn').addEventListener('click', () => openDialog(sessionDialog))
$('addSessionBtn2').addEventListener('click', () => openDialog(sessionDialog))
$('addCustomerBtn').addEventListener('click', () => openCustomerEditor(null))

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => closeDialog(button.closest('dialog')))
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog)
  })
  dialog.addEventListener('close', () => {
    if (dialog === customerDialog) state.editingCustomerId = null
  })
}

/* ---------- init ---------- */

apiKeyInput.value = localStorage.getItem(KEY_STORAGE) ?? ''

loadDelay()
setDelay(state.delay.min, state.delay.max, false)
updateModeUi()
updateComposer()

void refreshService()
void refreshStats()
void refreshSessions()
void loadCustomers()
void refreshHistory()

setInterval(() => void refreshService(), 15000)
setInterval(() => void refreshStats(), 8000)
setInterval(() => void refreshSessions(), 3000)
setInterval(() => void refreshHistory(), 6000)