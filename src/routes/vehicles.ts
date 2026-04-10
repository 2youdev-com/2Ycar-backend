import { Router, Response } from 'express'
import { z } from 'zod'
import { sql } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const vehiclesRouter = Router()

const vehicleSchema = z.object({
  customer_id:  z.string().uuid(),
  make:         z.string().min(1),
  model:        z.string().min(1),
  year:         z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  color:        z.string().optional(),
  vin:          z.string().optional(),
  plate_number: z.string().optional(),
})

// GET /api/v1/vehicles
vehiclesRouter.get('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const { customer_id, search } = req.query

  try {
    const data = await sql`
      SELECT v.*,
        json_build_object('full_name', p.full_name, 'phone', p.phone) AS customer
      FROM vehicles v
      LEFT JOIN profiles p ON p.id = v.customer_id
      WHERE v.center_id = ${centerId}
        AND (${customer_id || null}::text IS NULL OR v.customer_id = ${customer_id || null})
        AND (${search || null}::text IS NULL OR (
          v.make ILIKE ${'%' + (search || '') + '%'}
          OR v.model ILIKE ${'%' + (search || '') + '%'}
          OR v.plate_number ILIKE ${'%' + (search || '') + '%'}
        ))
      ORDER BY v.created_at DESC
    `

    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch vehicles' })
  }
})

// GET /api/v1/vehicles/:id
vehiclesRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await sql`
      SELECT v.*,
        json_build_object(
          'id', p.id, 'full_name', p.full_name, 'phone', p.phone,
          'email', p.email, 'avatar_url', p.avatar_url, 'role', p.role,
          'center_id', p.center_id, 'created_at', p.created_at, 'updated_at', p.updated_at
        ) AS customer
      FROM vehicles v
      LEFT JOIN profiles p ON p.id = v.customer_id
      WHERE v.id = ${req.params.id}
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' })
    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch vehicle' })
  }
})

// POST /api/v1/vehicles
vehiclesRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const parsed   = vehicleSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const d = parsed.data
  try {
    const rows = await sql`
      INSERT INTO vehicles (customer_id, center_id, make, model, year, color, vin, plate_number)
      VALUES (${d.customer_id}, ${centerId}, ${d.make}, ${d.model}, ${d.year ?? null}, ${d.color ?? null}, ${d.vin ?? null}, ${d.plate_number ?? null})
      RETURNING *
    `

    return res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to create vehicle' })
  }
})

// PATCH /api/v1/vehicles/:id
vehiclesRouter.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const parsed   = vehicleSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const d = parsed.data
  try {
    const rows = await sql`
      UPDATE vehicles SET
        customer_id  = COALESCE(${d.customer_id ?? null}, customer_id),
        make         = COALESCE(${d.make ?? null}, make),
        model        = COALESCE(${d.model ?? null}, model),
        year         = COALESCE(${d.year ?? null}, year),
        color        = COALESCE(${d.color ?? null}, color),
        vin          = COALESCE(${d.vin ?? null}, vin),
        plate_number = COALESCE(${d.plate_number ?? null}, plate_number)
      WHERE id = ${req.params.id} AND center_id = ${centerId}
      RETURNING *
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' })
    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update vehicle' })
  }
})

// DELETE /api/v1/vehicles/:id
vehiclesRouter.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  try {
    await sql`DELETE FROM vehicles WHERE id = ${req.params.id} AND center_id = ${centerId}`
    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to delete vehicle' })
  }
})
