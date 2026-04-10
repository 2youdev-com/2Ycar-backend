import { Router, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/client'
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
    let query = db
      .from('appointments')
      .select(`
        *,
        customer:profiles!customer_id(full_name, phone),
        vehicle:vehicles(make, model, plate_number)
      `)
      .eq('center_id', centerId)
      .order('requested_at', { ascending: true })

    if (status) query = query.eq('status', status as string)
    if (date)   query = query.gte('requested_at', `${date}T00:00:00`).lte('requested_at', `${date}T23:59:59`)

    const { data, error } = await query
    if (error) throw error
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

  try {
    const { data, error } = await db
      .from('appointments')
      .insert({
        ...parsed.data,
        center_id:   center_id || req.user!.center_id,
        customer_id: req.user!.id,
        status:      'pending',
      })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json(data)
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
    const { data, error } = await db
      .from('appointments')
      .update({ status })
      .eq('id', req.params.id)
      .eq('center_id', req.user!.center_id!)
      .select()
      .single()

    if (error || !data) return res.status(404).json({ error: 'Appointment not found' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update appointment status' })
  }
})
