import { Router, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const maintenanceRouter = Router()

// ── Validation Schema ─────────────────────────────────────────
const logSchema = z.object({
  vehicle_id:        z.string().uuid(),
  customer_id:       z.string().uuid(),
  technician_id:     z.string().uuid().optional(),
  date:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mileage:           z.number().int().min(0).optional(),
  next_service_km:   z.number().int().min(0).optional(),
  next_service_date: z.string().optional(),
  service_type:      z.enum(['oil_change','brake_service','full_service','repair','inspection','tyre_change','other']),
  description:       z.string().optional(),
  notes:             z.string().optional(),
  total_cost:        z.number().min(0),
  status:            z.enum(['pending','in_progress','completed','cancelled']).default('completed'),
  parts: z.array(z.object({
    part_id:       z.string().uuid().optional(),
    part_name:     z.string().min(1),
    quantity_used: z.number().int().min(1),
    unit_price:    z.number().min(0),
  })).optional().default([]),
})

// GET /api/v1/maintenance — list all logs for center
maintenanceRouter.get('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const { page = '1', limit = '20', vehicle_id, customer_id, status } = req.query

  try {
    let query = db
      .from('maintenance_logs')
      .select(`
        *,
        vehicle:vehicles(make, model, year, plate_number),
        customer:profiles!customer_id(full_name, phone),
        technician:profiles!technician_id(full_name),
        parts:maintenance_log_parts(*)
      `)
      .eq('center_id', centerId)
      .order('date', { ascending: false })
      .range((+page - 1) * +limit, +page * +limit - 1)

    if (vehicle_id)  query = query.eq('vehicle_id', vehicle_id as string)
    if (customer_id) query = query.eq('customer_id', customer_id as string)
    if (status)      query = query.eq('status', status as string)

    const { data, error, count } = await query
    if (error) throw error

    return res.json({ data, total: count, page: +page, limit: +limit })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch maintenance logs' })
  }
})

// GET /api/v1/maintenance/:id
maintenanceRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await db
      .from('maintenance_logs')
      .select(`
        *,
        vehicle:vehicles(*),
        customer:profiles!customer_id(*),
        technician:profiles!technician_id(full_name, phone),
        parts:maintenance_log_parts(*, part:spare_parts(name, sku))
      `)
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Log not found' })

    // Customers can only see their own logs
    if (req.user!.role === 'customer' && data.customer_id !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch log' })
  }
})

// POST /api/v1/maintenance — create new log
maintenanceRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  const parsed = logSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const { parts, ...logData } = parsed.data

  try {
    // Insert log
    const { data: log, error: logErr } = await db
      .from('maintenance_logs')
      .insert({ ...logData, center_id: centerId })
      .select()
      .single()

    if (logErr || !log) throw logErr

    // Insert parts (trigger handles inventory deduction)
    if (parts.length > 0) {
      const { error: partsErr } = await db
        .from('maintenance_log_parts')
        .insert(parts.map((p) => ({ ...p, log_id: log.id })))

      if (partsErr) throw partsErr
    }

    return res.status(201).json(log)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to create maintenance log' })
  }
})

// PATCH /api/v1/maintenance/:id — update log
maintenanceRouter.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const { data, error } = await db
      .from('maintenance_logs')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('center_id', centerId)
      .select()
      .single()

    if (error || !data) return res.status(404).json({ error: 'Log not found or unauthorized' })

    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update log' })
  }
})

// DELETE /api/v1/maintenance/:id
maintenanceRouter.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const { error } = await db
      .from('maintenance_logs')
      .delete()
      .eq('id', req.params.id)
      .eq('center_id', centerId)

    if (error) throw error
    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to delete log' })
  }
})
