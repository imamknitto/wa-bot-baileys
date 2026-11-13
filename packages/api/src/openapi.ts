import { z } from 'zod'
import {
  broadcastSchema,
  createSessionSchema,
  jobIdSchema,
  messageIdSchema,
  messagesQuerySchema,
  recentMessagesQuerySchema,
  sendSchema,
  sessionIdSchema,
} from './validation.js'

/**
 * OpenAPI 3.1 document served by `GET /docs/openapi.json` and rendered by Scalar.
 *
 * Request bodies and path params are derived from the Zod schemas in
 * `validation.ts`, so the docs cannot drift from what the routes validate.
 * Response shapes are described here because the routes return plain objects.
 */

type JsonSchema = Record<string, unknown>

const jsonSchema = (schema: z.ZodType): JsonSchema => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as JsonSchema & { $schema?: string }
  return rest
}

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` })

const jsonBody = (schema: JsonSchema, description = 'OK'): JsonSchema => ({
  description,
  content: { 'application/json': { schema } },
})

const errorResponse = (description: string): JsonSchema => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
})

const validationErrorResponse = (): JsonSchema => ({
  description: 'Validasi gagal',
  content: { 'application/json': { schema: ref('ValidationError') } },
})

/** Flattens a Zod object schema into OpenAPI query parameters. */
const queryParams = (schema: z.ZodObject, descriptions: Record<string, string> = {}) => {
  const { properties = {}, required = [] } = jsonSchema(schema) as {
    properties?: Record<string, JsonSchema>
    required?: string[]
  }
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: 'query' as const,
    required: required.includes(name),
    ...(descriptions[name] ? { description: descriptions[name] } : {}),
    schema: propertySchema,
  }))
}

const sessionIdParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'ID sesi',
  schema: jsonSchema(sessionIdSchema),
} as const

const jobIdParam = {
  name: 'jobId',
  in: 'path',
  required: true,
  description: 'ID job broadcast',
  schema: jsonSchema(jobIdSchema),
} as const

const sessionSchemas = {
  Session: {
    type: 'object',
    required: ['sessionId', 'mode', 'status', 'connected'],
    properties: {
      sessionId: { type: 'string' },
      mode: { type: 'string', enum: ['pairing', 'qr'] },
      status: {
        type: 'string',
        enum: ['connecting', 'connected', 'disconnected', 'logged_out'],
      },
      connected: { type: 'boolean' },
      me: { type: ['string', 'null'] },
      hasQr: { type: 'boolean' },
      hasPairingCode: { type: 'boolean' },
      pairingError: { type: ['string', 'null'] },
    },
  },
  SessionWithMeta: {
    allOf: [
      ref('Session'),
      {
        type: 'object',
        properties: {
          salesId: { type: ['string', 'null'] },
          agentId: { type: ['string', 'null'] },
        },
      },
    ],
  },
  SessionListItem: {
    allOf: [
      ref('SessionWithMeta'),
      {
        type: 'object',
        properties: { sentToday: { type: 'integer' } },
      },
    ],
  },
  BroadcastResult: {
    type: 'object',
    required: ['to', 'ok'],
    properties: {
      to: { type: 'string' },
      customerId: { type: ['string', 'null'] },
      customerName: { type: ['string', 'null'] },
      ok: { type: 'boolean' },
      messageId: { type: ['string', 'null'] },
      sentAt: { type: ['integer', 'null'] },
      error: { type: 'string' },
    },
  },
  BroadcastJob: {
    type: 'object',
    required: ['jobId', 'status', 'total', 'sent', 'failed'],
    properties: {
      jobId: { type: 'string', format: 'uuid' },
      status: {
        type: 'string',
        enum: ['running', 'completed', 'cancelled', 'failed'],
      },
      total: { type: 'integer' },
      sent: { type: 'integer' },
      failed: { type: 'integer' },
      nextSendAt: { type: ['integer', 'null'] },
      results: { type: 'array', items: ref('BroadcastResult') },
      createdAt: { type: 'integer' },
      delayMinMs: { type: 'integer' },
      delayMaxMs: { type: 'integer' },
      referenceId: { type: ['string', 'null'] },
      error: { type: ['string', 'null'] },
    },
  },
  MessageLog: {
    type: 'object',
    required: ['id', 'sessionId', 'source', 'to', 'status'],
    properties: {
      id: { type: 'integer' },
      sessionId: { type: 'string' },
      source: { type: 'string', enum: ['send', 'broadcast'] },
      to: { type: 'string' },
      text: { type: ['string', 'null'] },
      broadcastJobId: { type: ['string', 'null'] },
      messageId: { type: ['string', 'null'] },
      status: { type: 'string', enum: ['sent', 'failed'] },
      error: { type: ['string', 'null'] },
      createdAt: { type: 'integer' },
      salesId: { type: ['string', 'null'] },
      agentId: { type: ['string', 'null'] },
      customerId: { type: ['string', 'null'] },
      customerName: { type: ['string', 'null'] },
      referenceId: { type: ['string', 'null'] },
    },
  },
  RecentMessage: {
    type: 'object',
    required: ['id', 'sessionId', 'source', 'to', 'status', 'createdAt'],
    properties: {
      id: { type: 'integer' },
      sessionId: { type: 'string' },
      source: { type: 'string', enum: ['send', 'broadcast'] },
      to: { type: 'string' },
      salesId: { type: ['string', 'null'] },
      customerId: { type: ['string', 'null'] },
      customerName: { type: ['string', 'null'] },
      text: { type: ['string', 'null'] },
      status: { type: 'string', enum: ['sent', 'failed'] },
      error: { type: ['string', 'null'] },
      createdAt: { type: 'integer' },
    },
  },
  Error: {
    type: 'object',
    required: ['error'],
    properties: { error: { type: 'string' } },
  },
  ValidationError: {
    type: 'object',
    required: ['error', 'details'],
    properties: {
      error: { type: 'string' },
      details: {
        type: 'object',
        description: 'Hasil `z.treeifyError()`',
        additionalProperties: true,
      },
    },
  },
}

const paths = {
  '/': {
    get: {
      tags: ['Service'],
      summary: 'Info service',
      description: 'Publik, tidak memerlukan kredensial.',
      operationId: 'getServiceInfo',
      security: [],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            status: { type: 'string', enum: ['ok'] },
          },
        }),
      },
    },
  },
  '/sessions': {
    get: {
      tags: ['Sesi'],
      summary: 'Daftar sesi',
      description: 'Admin melihat semua sesi; token sales hanya sesinya sendiri.',
      operationId: 'listSessions',
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            sessions: { type: 'array', items: ref('SessionListItem') },
          },
        }),
        '401': errorResponse('Kredensial tidak ada atau salah'),
      },
    },
    post: {
      tags: ['Sesi'],
      summary: 'Buat sesi',
      description:
        'Admin only. Menjalankan socket WhatsApp baru lalu menerbitkan token sesi.',
      operationId: 'createSession',
      requestBody: jsonBody(jsonSchema(createSessionSchema)),
      responses: {
        '202': jsonBody({
          allOf: [
            ref('SessionWithMeta'),
            {
              type: 'object',
              properties: { ok: { type: 'boolean' }, token: { type: 'string' } },
            },
          ],
        }),
        '400': validationErrorResponse(),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Memakai token sales'),
        '409': errorResponse('Sesi aktif, batas sesi, atau dimiliki sales lain'),
        '500': errorResponse('Gagal memulai sesi'),
      },
    },
  },
  '/sessions/{id}/status': {
    get: {
      tags: ['Sesi'],
      summary: 'Status sesi',
      operationId: 'getSessionStatus',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody(ref('SessionWithMeta')),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}/qr': {
    get: {
      tags: ['Sesi'],
      summary: 'QR aktif (data-URL PNG)',
      operationId: 'getSessionQr',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: { qr: { type: ['string', 'null'] } },
        }),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}/pairing': {
    get: {
      tags: ['Sesi'],
      summary: 'Kode pairing terakhir',
      operationId: 'getSessionPairing',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            pairingCode: { type: ['string', 'null'] },
            error: { type: ['string', 'null'] },
          },
        }),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}/token': {
    post: {
      tags: ['Sesi'],
      summary: 'Putar token sesi',
      description: 'Admin only. Token lama langsung tidak berlaku.',
      operationId: 'rotateSessionToken',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            sessionId: { type: 'string' },
            token: { type: 'string' },
          },
        }),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Memakai token sales'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}/login': {
    post: {
      tags: ['Sesi'],
      summary: 'Tautkan ulang perangkat',
      description:
        'Admin only. Menjalankan sesi yang sudah logout dalam mode `qr` tanpa menerbitkan token baru.',
      operationId: 'loginSession',
      parameters: [sessionIdParam],
      responses: {
        '202': jsonBody({
          allOf: [
            ref('SessionWithMeta'),
            { type: 'object', properties: { ok: { type: 'boolean' } } },
          ],
        }),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Memakai token sales'),
        '404': errorResponse('Sesi tidak ada'),
        '409': errorResponse('Sesi masih aktif atau batas sesi penuh'),
        '500': errorResponse('Gagal memulai sesi'),
      },
    },
  },
  '/sessions/{id}/logout': {
    post: {
      tags: ['Sesi'],
      summary: 'Logout sesi',
      description:
        'Admin only. Menghapus auth sesi dari SQLite, me-revoke token, dan menandai job broadcast berjalan `failed`.',
      operationId: 'logoutSession',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            sessionId: { type: 'string' },
            status: { type: 'string' },
          },
        }),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Memakai token sales'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}': {
    delete: {
      tags: ['Sesi'],
      summary: 'Hapus sesi',
      description:
        'Admin only. Logout jika perlu, lalu hapus auth, `session_meta`, dan token. Riwayat pesan tidak dihapus.',
      operationId: 'deleteSession',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            sessionId: { type: 'string' },
          },
        }),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Memakai token sales'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}/send': {
    post: {
      tags: ['Pesan'],
      summary: 'Kirim satu pesan teks',
      description:
        '`referenceId` yang sudah dipakai di sesi yang sama tidak dikirim ulang; respons memakai hasil lama dengan `duplicate: true`.',
      operationId: 'sendMessage',
      parameters: [sessionIdParam],
      requestBody: jsonBody(jsonSchema(sendSchema)),
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            id: { type: ['string', 'null'] },
            referenceId: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['sent', 'failed'] },
            duplicate: { type: 'boolean' },
          },
        }),
        '400': validationErrorResponse(),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Sesi tidak ada'),
        '502': errorResponse('WhatsApp gagal mengirim pesan'),
        '503': errorResponse('Sesi belum `connected`'),
      },
    },
  },
  '/sessions/{id}/messages': {
    get: {
      tags: ['Pesan'],
      summary: 'Riwayat pesan keluar satu sesi',
      description: 'Terbaru dulu. Pesan masuk tidak disimpan.',
      operationId: 'listSessionMessages',
      parameters: [
        sessionIdParam,
        ...queryParams(messagesQuerySchema, {
          limit: 'Jumlah baris per halaman',
          cursor: '`id` terakhir dari halaman sebelumnya',
        }),
      ],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            messages: { type: 'array', items: ref('MessageLog') },
            nextCursor: { type: ['integer', 'null'] },
          },
        }),
        '400': validationErrorResponse(),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Sesi tidak ada'),
      },
    },
  },
  '/sessions/{id}/broadcast': {
    post: {
      tags: ['Broadcast'],
      summary: 'Mulai job broadcast',
      description:
        'Respons langsung `202`; pengiriman berjalan di background. Satu job `running` per sesi. Nomor duplikat (setelah normalisasi JID) diabaikan.',
      operationId: 'createBroadcast',
      parameters: [sessionIdParam],
      requestBody: jsonBody(jsonSchema(broadcastSchema)),
      responses: {
        '202': jsonBody({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            jobId: { type: 'string', format: 'uuid' },
            referenceId: { type: ['string', 'null'] },
            duplicate: { type: 'boolean' },
            status: { type: ['string', 'null'] },
          },
        }),
        '400': validationErrorResponse(),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Sesi tidak ada'),
        '409': errorResponse('Masih ada job `running` untuk sesi ini'),
        '500': errorResponse('Gagal membuat job'),
        '503': errorResponse('Sesi belum `connected`'),
      },
    },
  },
  '/sessions/{id}/broadcast/current': {
    get: {
      tags: ['Broadcast'],
      summary: 'Job broadcast yang sedang berjalan',
      operationId: 'getCurrentBroadcast',
      parameters: [sessionIdParam],
      responses: {
        '200': jsonBody(ref('BroadcastJob')),
        '400': errorResponse('`sessionId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Tidak ada job berjalan'),
      },
    },
  },
  '/sessions/{id}/broadcast/{jobId}': {
    get: {
      tags: ['Broadcast'],
      summary: 'Status dan progres job',
      operationId: 'getBroadcast',
      parameters: [sessionIdParam, jobIdParam],
      responses: {
        '200': jsonBody(ref('BroadcastJob')),
        '400': errorResponse('`sessionId`/`jobId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Job tidak ada'),
      },
    },
  },
  '/sessions/{id}/broadcast/{jobId}/cancel': {
    post: {
      tags: ['Broadcast'],
      summary: 'Batalkan job broadcast',
      description:
        'Delay langsung berhenti; pengiriman yang sedang in-flight tetap dicatat. Webhook `broadcast.cancelled` diantrekan.',
      operationId: 'cancelBroadcast',
      parameters: [sessionIdParam, jobIdParam],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            jobId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['cancelled'] },
          },
        }),
        '400': errorResponse('`sessionId`/`jobId` tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '403': errorResponse('Token milik sesi lain'),
        '404': errorResponse('Job tidak ada'),
        '409': errorResponse('Job sudah berakhir'),
      },
    },
  },
  '/stats': {
    get: {
      tags: ['Statistik'],
      summary: 'Ringkasan dashboard',
      description: 'Admin only.',
      operationId: 'getStats',
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            sessions: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                connected: { type: 'integer' },
              },
            },
            messages: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                today: { type: 'integer' },
              },
            },
          },
        }),
        '401': errorResponse('Kredensial tidak ada atau salah'),
      },
    },
  },
  '/messages': {
    get: {
      tags: ['Statistik'],
      summary: 'Riwayat pesan semua sesi',
      description: 'Admin only. Terbaru dulu.',
      operationId: 'listRecentMessages',
      parameters: queryParams(recentMessagesQuerySchema, {
        limit: 'Jumlah baris',
        sessionId: 'Filter satu sesi',
      }),
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: {
            messages: { type: 'array', items: ref('RecentMessage') },
          },
        }),
        '400': validationErrorResponse(),
        '401': errorResponse('Kredensial tidak ada atau salah'),
      },
    },
  },
  '/messages/{id}': {
    delete: {
      tags: ['Statistik'],
      summary: 'Hapus satu baris riwayat',
      description:
        'Hanya menghapus catatan di database; pesan yang sudah terkirim di WhatsApp tidak terpengaruh.',
      operationId: 'deleteMessage',
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: jsonSchema(messageIdSchema),
        },
      ],
      responses: {
        '200': jsonBody({
          type: 'object',
          properties: { ok: { type: 'boolean' }, id: { type: 'integer' } },
        }),
        '400': errorResponse('ID tidak valid'),
        '401': errorResponse('Kredensial tidak ada atau salah'),
        '404': errorResponse('Pesan tidak ada'),
      },
    },
  },
}

export const openApiDocument = {
  openapi: '3.1.0' as const,
  info: {
    title: 'wa-bot-service API',
    version: '1.0.0',
    description:
      'Kontrak HTTP wa-bot-service. Auth: `x-api-key` (admin) atau `Authorization: Bearer <token sesi>` untuk `/sessions/*`. Seluruh timestamp memakai epoch milliseconds.',
  },
  servers: [{ url: '/', description: 'Server ini' }],
  tags: [
    { name: 'Service', description: 'Info service' },
    { name: 'Sesi', description: 'Lifecycle sesi WhatsApp' },
    { name: 'Pesan', description: 'Kirim pesan dan riwayat per sesi' },
    { name: 'Broadcast', description: 'Job broadcast asinkron' },
    { name: 'Statistik', description: 'Agregat dan riwayat lintas sesi' },
  ],
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey' as const, in: 'header' as const, name: 'x-api-key' },
      bearer: { type: 'http' as const, scheme: 'bearer' as const },
    },
    schemas: sessionSchemas,
  },
  security: [{ apiKey: [] }],
  paths,
}

export default openApiDocument
