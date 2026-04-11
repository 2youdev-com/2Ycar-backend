import { Router, Response } from 'express'
import { z } from 'zod'
import { sql } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const appointmentsRouter = Router()

const appointmentSchema = z.object({
  vehicle_id:     z.string().uuid().optional(),
  requested_at:   z.string().datetime(),
  service_type:   z.string().optional(),
  notes:          z.string().optional(),
  branch:         z.string().optional(),
  vehicle_make:   z.string().optional(),
  vehicle_model:  z.string().optional(),
  vehicle_year:   z.number().int().optional(),
  vehicle_plate:  z.string().optional(),
  customer_name:  z.string().optional(),
  customer_phone: z.string().optional(),
})

// GET /api/v1/appointments
appointmentsRouter.get('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const { status, date } = req.query

  try {
    const data = await sql`
      SELECT a.*,
        json_build_object('full_name', cp.full_name, 'phone', cp.phone) AS customer,
        json_build_object('make', v.make, 'model', v.model, 'plate_number', v.plate_number) AS vehicle
      FROM appointments a
      LEFT JOIN profiles cp ON cp.id = a.customer_id
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.center_id = ${centerId}
        AND (${status || null}::text IS NULL OR a.status = ${status || null})
        AND (${date || null}::text IS NULL OR (
          a.requested_at >= (${date || null} || 'T00:00:00')::timestamptz
          AND a.requested_at <= (${date || null} || 'T23:59:59')::timestamptz
        ))
      ORDER BY a.requested_at ASC
    `

    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch appointments' })
  }
})

// GET /api/v1/appointments/my — customer's own appointments
appointmentsRouter.get('/my', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await sql`
      SELECT * FROM appointments
      WHERE customer_id = ${req.user!.id}
      ORDER BY requested_at DESC
    `
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch appointments' })
  }
})

// POST /api/v1/appointments — customer books appointment
appointmentsRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = appointmentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const d = parsed.data
  const centerId = req.body.center_id || req.user!.center_id || 'a1b2c3d4-0000-0000-0000-000000000001'

  try {
    const rows = await sql`
      INSERT INTO appointments (center_id, customer_id, vehicle_id, requested_at, service_type, notes, status, branch, vehicle_make, vehicle_model, vehicle_year, vehicle_plate, customer_name, customer_phone)
      VALUES (${centerId}, ${req.user!.id}, ${d.vehicle_id ?? null}, ${d.requested_at}, ${d.service_type ?? null}, ${d.notes ?? null}, 'pending', ${d.branch ?? null}, ${d.vehicle_make ?? null}, ${d.vehicle_model ?? null}, ${d.vehicle_year ?? null}, ${d.vehicle_plate ?? null}, ${d.customer_name ?? null}, ${d.customer_phone ?? null})
      RETURNING *
    `
    return res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to create appointment' })
  }
})

// PATCH /api/v1/appointments/:id/status — admin confirms/cancels
appointmentsRouter.patch('/:id/status', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { status } = req.body
  const allowed = ['pending', 'confirmed', 'cancelled', 'completed']
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` })
  }

  try {
    const rows = await sql`
      UPDATE appointments SET status = ${status}
      WHERE id = ${req.params.id} AND center_id = ${req.user!.center_id!}
      RETURNING *
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Appointment not found' })
    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update appointment status' })
  }
})
