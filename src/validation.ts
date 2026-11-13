import { z } from 'zod'

export const sessionIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/)

export const jobIdSchema = z.string().uuid()

export const messageIdSchema = z.coerce.number().int().positive()

export const salesIdSchema = z.string().trim().min(1).max(64)

export const agentIdSchema = z.string().trim().min(1).max(64)

export const externalIdSchema = z.string().trim().min(1).max(128)

export const recipientNameSchema = z.string().trim().min(1).max(100)

export const recentMessagesQuerySchema = z.object({
  sessionId: sessionIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const recipientSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (value.includes('@')) return /^[^@\s]+@[^@\s]+$/.test(value)
    const digits = value.replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15
  }, 'recipient must be a phone number (8-15 digits) or a JID')

export const sendSchema = z.object({
  to: recipientSchema,
  text: z.string().min(1).max(4000),
  customerId: externalIdSchema.optional(),
  customerName: recipientNameSchema.optional(),
  referenceId: externalIdSchema.optional(),
})

export const broadcastRecipientSchema = z.object({
  to: recipientSchema,
  customerId: externalIdSchema.optional(),
  name: recipientNameSchema.optional(),
  text: z.string().min(1).max(4000).optional(),
})

export const broadcastSchema = z
  .object({
    recipients: z.array(broadcastRecipientSchema).min(1).max(100),
    text: z.string().min(1).max(4000),
    delayMinMs: z.number().int().min(10000).max(600000).default(30000),
    delayMaxMs: z.number().int().min(10000).max(600000).default(60000),
    referenceId: externalIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.delayMaxMs < value.delayMinMs) {
      ctx.addIssue({
        code: 'custom',
        message: 'delayMaxMs must be greater than or equal to delayMinMs',
        path: ['delayMaxMs'],
      })
    }
  })

export const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().positive().optional(),
})

export const createSessionSchema = z
  .object({
    sessionId: sessionIdSchema.optional(),
    salesId: salesIdSchema,
    agentId: agentIdSchema.optional(),
    mode: z.enum(['pairing', 'qr']).default('pairing'),
    phone: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== 'pairing') return
    const digits = digitsOnly(value.phone ?? '')
    if (digits.length < 8 || digits.length > 15) {
      ctx.addIssue({
        code: 'custom',
        message: 'phone must contain 8-15 digits',
        path: ['phone'],
      })
    }
  })

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}
