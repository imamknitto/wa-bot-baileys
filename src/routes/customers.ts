import { Hono } from 'hono'
import { z } from 'zod'
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerByPhone,
  listCustomers,
  updateCustomer,
} from '../db/app.js'
import {
  customerCreateSchema,
  customerIdSchema,
  customerUpdateSchema,
  customersQuerySchema,
} from '../validation.js'

const app = new Hono()

app.get('/', (c) => {
  const parsed = customersQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  return c.json(
    listCustomers(parsed.data.limit, parsed.data.cursor, parsed.data.q),
  )
})

app.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = customerCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  const { name, phone } = parsed.data
  if (getCustomerByPhone(phone)) {
    return c.json({ error: 'Phone number already registered' }, 409)
  }

  try {
    const customer = createCustomer({
      name,
      phone,
      note: parsed.data.note ?? null,
    })
    return c.json({ ok: true, customer }, 201)
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'Phone number already registered' }, 409)
    }
    console.error('Failed to create customer:', err)
    return c.json({ error: 'Failed to create customer' }, 500)
  }
})

app.patch('/:id', async (c) => {
  const id = customerIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid customer id' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = customerUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: z.treeifyError(parsed.error) },
      400,
    )
  }

  const existing = getCustomer(id.data)
  if (!existing) return c.json({ error: 'Customer not found' }, 404)

  const phone = parsed.data.phone ?? existing.phone
  const duplicate = getCustomerByPhone(phone)
  if (duplicate && duplicate.id !== existing.id) {
    return c.json({ error: 'Phone number already registered' }, 409)
  }

  try {
    const customer = updateCustomer(id.data, {
      name: parsed.data.name ?? existing.name,
      phone,
      note: parsed.data.note === undefined ? existing.note : parsed.data.note,
    })
    if (!customer) return c.json({ error: 'Customer not found' }, 404)
    return c.json({ ok: true, customer })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json({ error: 'Phone number already registered' }, 409)
    }
    console.error(`Failed to update customer ${id.data}:`, err)
    return c.json({ error: 'Failed to update customer' }, 500)
  }
})

app.delete('/:id', (c) => {
  const id = customerIdSchema.safeParse(c.req.param('id'))
  if (!id.success) return c.json({ error: 'Invalid customer id' }, 400)

  if (!deleteCustomer(id.data)) {
    return c.json({ error: 'Customer not found' }, 404)
  }
  return c.json({ ok: true, id: id.data })
})

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed/i.test(err.message)
  )
}

export default app