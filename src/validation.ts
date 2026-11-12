import { z } from 'zod'

export const sessionIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/)

export const jobIdSchema = z.string().uuid()

export const customerIdSchema = z.coerce.number().int().positive()

export const messageIdSchema = z.coerce.number().int().positive()

export const customerNameSchema = z.string().trim().min(1).max(100)

export const customerPhoneSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ''))
  .refine(
    (value) => value.length >= 8 && value.length <= 15,
    'phone must contain 8-15 digits',
  )

export const customerNoteSchema = z.string().trim().max(500).nullable()

export const customerCreateSchema = z.object({
  name: customerNameSchema,
  phone: customerPhoneSchema,
  note: customerNoteSchema.optional(),
})

export const customerUpdateSchema = z
  .object({
    name: customerNameSchema.optional(),
    phone: customerPhoneSchema.optional(),
    note: customerNoteSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'at least one field is required',
  )

export const customersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.coerce.number().int().positive().optional(),
})

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
  text: z.string().min(1),
})

export const broadcastSchema = z
  .object({
    recipients: z.array(recipientSchema).max(100).optional(),
    customerIds: z.array(z.number().int().positive()).max(100).optional(),
    text: z.string().min(1).max(4000),
    delayMinMs: z.number().int().min(10000).max(600000).default(30000),
    delayMaxMs: z.number().int().min(10000).max(600000).default(60000),
  })
  .superRefine((value, ctx) => {
    const recipientCount = value.recipients?.length ?? 0
    const customerCount = value.customerIds?.length ?? 0
    if (recipientCount + customerCount === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'recipients or customerIds is required',
        path: ['recipients'],
      })
    }
    if (recipientCount + customerCount > 100) {
      ctx.addIssue({
        code: 'custom',
        message: 'total recipients must not exceed 100',
        path: ['recipients'],
      })
    }
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