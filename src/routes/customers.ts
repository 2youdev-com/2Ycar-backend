import { Router, Response } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { sql } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const customersRouter = Router()

const customerSchema = z.object({
  full_name:  z.string().min(2),
  phone:      z.string().optional(),
  email:      z.string().email(),
  avatar_url: z.string().url().optional(),
})

// GET /api/v1/customers — list customers for the center
customersRouter.get('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const { search, page = '1', limit = '30' } = req.query
  const offset = (+page - 1) * +limit

  try {
    const data = await sql`
      SELECT p.id, p.full_name, p.phone, p.email, p.avatar_url, p.created_at
      FROM profiles p
      WHERE p.role = 'customer'
        AND p.id IN (
          SELECT customer_id FROM vehicles WHERE center_id = ${centerId}
          UNION
          SELECT customer_id FROM maintenance_logs WHERE center_id = ${centerId}
          UNION
          SELECT customer_id FROM appointments WHERE center_id = ${centerId}
        )
        AND (${search || null}::text IS NULL OR p.full_name ILIKE ${'%' + (search || '') + '%'})
      ORDER BY p.full_name ASC
      LIMIT ${+limit} OFFSET ${offset}
    `

    return res.json({ data, page: +page, limit: +limit })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch customers' })
  }
})

// GET /api/v1/customers/:id — full customer profile with vehicles + logs
customersRouter.get('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const [profileRows, vehicles, logs] = await Promise.all([
      sql`SELECT * FROM profiles WHERE id = ${req.params.id}`,
      sql`SELECT * FROM vehicles WHERE customer_id = ${req.params.id} AND center_id = ${centerId}`,
      sql`
        SELECT id, date, service_type, total_cost, status, mileage
        FROM maintenance_logs
        WHERE customer_id = ${req.params.id} AND center_id = ${centerId}
        ORDER BY date DESC
        LIMIT 20
      `,
    ])

    if (profileRows.length === 0) return res.status(404).json({ error: 'Customer not found' })

    return res.json({ profile: profileRows[0], vehicles, logs })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch customer' })
  }
})

// POST /api/v1/customers — create customer profile (admin creates on behalf)
customersRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const parsed = customerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  try {
    const randomPassword = Math.random().toString(36).slice(2, 10) + 'Aa1!'
    const passwordHash = await bcrypt.hash(randomPassword, 10)

    const rows = await sql`
      INSERT INTO profiles (full_name, email, phone, avatar_url, password_hash, role)
      VALUES (${parsed.data.full_name}, ${parsed.data.email}, ${parsed.data.phone ?? null}, ${parsed.data.avatar_url ?? null}, ${passwordHash}, 'customer')
      RETURNING id, full_name, email, phone, avatar_url, role, created_at
    `

    return res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to create customer' })
  }
})

// PATCH /api/v1/customers/:id
customersRouter.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const parsed = customerSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const d = parsed.data
  try {
    const rows = await sql`
      UPDATE profiles SET
        full_name  = COALESCE(${d.full_name ?? null}, full_name),
        phone      = COALESCE(${d.phone ?? null}, phone),
        email      = COALESCE(${d.email ?? null}, email),
        avatar_url = COALESCE(${d.avatar_url ?? null}, avatar_url)
      WHERE id = ${req.params.id}
      RETURNING *
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found' })
    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update customer' })
  }
})
