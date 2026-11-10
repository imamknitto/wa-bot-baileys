const $ = (id) => document.getElementById(id)

const apiKeyInput = $('apiKey')
const statusEl = $('status')
const qrWrap = $('qrWrap')
const qrImage = $('qrImage')
const loginBtn = $('loginBtn')
const logoutBtn = $('logoutBtn')
const sendForm = $('sendForm')
const sendBtn = $('sendBtn')
const sendResult = $('sendResult')
const broadcastForm = $('broadcastForm')
const broadcastBtn = $('broadcastBtn')
const broadcastResult = $('broadcastResult')

apiKeyInput.value = localStorage.getItem('apiKey') ?? ''

$('saveKey').addEventListener('click', () => {
  localStorage.setItem('apiKey', apiKeyInput.value.trim())
  refreshStatus()
})

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'x-api-key': apiKeyInput.value.trim(), ...options.headers },
  })
  const body = await res.json().catch(() => ({}))
  return { res, body }
}

function setResult(el, res, body) {
  el.classList.remove('hidden', 'ok', 'err')
  el.classList.add(res.ok ? 'ok' : 'err')
  el.textContent = `${res.status}\n${JSON.stringify(body, null, 2)}`
}

async function refreshStatus() {
  const { res, body } = await api('/status')
  const status = res.ok ? body.status : 'error'
  statusEl.textContent = res.ok ? body.status : `error ${res.status}`
  statusEl.className = `pill ${status}`
  updatePairingUi(status)
  await refreshQr(status)
}

function updatePairingUi(status) {
  const showPairing = status === 'disconnected' || status === 'logged_out' || status === 'error'
  loginBtn.classList.toggle('hidden', !showPairing)
  logoutBtn.classList.toggle('hidden', status !== 'connected')
  qrWrap.classList.toggle('hidden', status !== 'connecting')
}

async function refreshQr(status) {
  if (status !== 'connecting') {
    qrImage.src = ''
    return
  }
  const { res, body } = await api('/qr')
  if (res.ok && body.qr && qrImage.src !== body.qr) {
    qrImage.src = body.qr
  }
}

loginBtn.addEventListener('click', async () => {
  loginBtn.disabled = true
  await api('/login', { method: 'POST' })
  loginBtn.disabled = false
  refreshStatus()
})

logoutBtn.addEventListener('click', async () => {
  if (!confirm('Logout dari WhatsApp? Sesi akan dihapus dan perlu pairing ulang.')) return
  logoutBtn.disabled = true
  await api('/logout', { method: 'POST' })
  logoutBtn.disabled = false
  refreshStatus()
})

sendForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  sendBtn.disabled = true
  setResult(sendResult, { ok: true }, { status: 'Mengirim...' })
  const { res, body } = await api('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: $('to').value.trim(),
      text: $('text').value,
    }),
  })
  setResult(sendResult, res, body)
  if (res.ok) $('text').value = ''
  sendBtn.disabled = false
})

broadcastForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const recipients = $('recipients').value
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (recipients.length === 0) {
    setResult(broadcastResult, { ok: false }, { error: 'Minimal satu nomor tujuan' })
    return
  }
  broadcastBtn.disabled = true
  setResult(broadcastResult, { ok: true }, { status: 'Mengirim...' })
  const { res, body } = await api('/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipients,
      text: $('broadcastText').value,
      delayMs: Number($('delayMs').value) || 3000,
    }),
  })
  setResult(broadcastResult, res, body)
  broadcastBtn.disabled = false
})

setInterval(refreshStatus, 5000)
refreshStatus()
