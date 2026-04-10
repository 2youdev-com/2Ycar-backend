import { Router, Response } from 'express'
import { z } from 'zod'
import { sql } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const appointmentsRouter = Router()

const appointmentSchema = z.object({
  vehicle_id:   z.string().uuid(),
  requested_at: z.string().datetime(),
  service_type: z.string().optional(),
  notes:        z.string().optional(),
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

// POST /api/v1/appointments — customer books appointment
appointmentsRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { center_id, ...body } = req.body
  const parsed = appointmentSchema.safeParse(body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const d = parsed.data
  try {
    const rows = await sql`
      INSERT INTO appointments (center_id, customer_id, vehicle_id, requested_at, service_type, notes, status)
      VALUES (${center_id || req.user!.center_id}, ${req.user!.id}, ${d.vehicle_id}, ${d.requested_at}, ${d.service_type ?? null}, ${d.notes ?? null}, 'pending')
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
