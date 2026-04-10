import { Router, Response } from 'express'
import { z } from 'zod'
import { sql } from '../db/client'
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
  const offset = (+page - 1) * +limit

  try {
    const data = await sql`
      SELECT ml.*,
        json_build_object('make', v.make, 'model', v.model, 'year', v.year, 'plate_number', v.plate_number) AS vehicle,
        json_build_object('full_name', cp.full_name, 'phone', cp.phone) AS customer,
        json_build_object('full_name', tp.full_name) AS technician,
        COALESCE(
          (SELECT json_agg(mlp.*) FROM maintenance_log_parts mlp WHERE mlp.log_id = ml.id),
          '[]'::json
        ) AS parts
      FROM maintenance_logs ml
      LEFT JOIN vehicles v ON v.id = ml.vehicle_id
      LEFT JOIN profiles cp ON cp.id = ml.customer_id
      LEFT JOIN profiles tp ON tp.id = ml.technician_id
      WHERE ml.center_id = ${centerId}
        AND (${vehicle_id || null}::text IS NULL OR ml.vehicle_id = ${vehicle_id || null}::uuid)
        AND (${customer_id || null}::text IS NULL OR ml.customer_id = ${customer_id || null}::uuid)
        AND (${status || null}::text IS NULL OR ml.status = ${status || null})
      ORDER BY ml.date DESC
      LIMIT ${+limit} OFFSET ${offset}
    `

    return res.json({ data, page: +page, limit: +limit })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch maintenance logs' })
  }
})

// GET /api/v1/maintenance/:id
maintenanceRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await sql`
      SELECT ml.*,
        row_to_json(v.*) AS vehicle,
        row_to_json(cp.*) AS customer,
        json_build_object('full_name', tp.full_name, 'phone', tp.phone) AS technician,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id', mlp.id, 'log_id', mlp.log_id, 'part_id', mlp.part_id,
              'part_name', mlp.part_name, 'quantity_used', mlp.quantity_used,
              'unit_price', mlp.unit_price, 'total_price', mlp.total_price,
              'part', CASE WHEN sp.id IS NOT NULL THEN json_build_object('name', sp.name, 'sku', sp.sku) ELSE NULL END
            )
          ) FROM maintenance_log_parts mlp
          LEFT JOIN spare_parts sp ON sp.id = mlp.part_id
          WHERE mlp.log_id = ml.id),
          '[]'::json
        ) AS parts
      FROM maintenance_logs ml
      LEFT JOIN vehicles v ON v.id = ml.vehicle_id
      LEFT JOIN profiles cp ON cp.id = ml.customer_id
      LEFT JOIN profiles tp ON tp.id = ml.technician_id
      WHERE ml.id = ${req.params.id}
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Log not found' })

    const data = rows[0]

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

  const { parts, ...d } = parsed.data

  try {
    // Insert log
    const logRows = await sql`
      INSERT INTO maintenance_logs (center_id, vehicle_id, customer_id, technician_id, date, mileage, next_service_km, next_service_date, service_type, description, notes, total_cost, status)
      VALUES (${centerId}, ${d.vehicle_id}, ${d.customer_id}, ${d.technician_id ?? null}, ${d.date}, ${d.mileage ?? null}, ${d.next_service_km ?? null}, ${d.next_service_date ?? null}, ${d.service_type}, ${d.description ?? null}, ${d.notes ?? null}, ${d.total_cost}, ${d.status})
      RETURNING *
    `

    const log = logRows[0]

    // Insert parts (trigger handles inventory deduction)
    if (parts.length > 0) {
      for (const p of parts) {
        await sql`
          INSERT INTO maintenance_log_parts (log_id, part_id, part_name, quantity_used, unit_price)
          VALUES (${log.id}, ${p.part_id ?? null}, ${p.part_name}, ${p.quantity_used}, ${p.unit_price})
        `
      }
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
  const { status, description, notes, total_cost, mileage, next_service_km, next_service_date } = req.body

  try {
    const rows = await sql`
      UPDATE maintenance_logs SET
        status            = COALESCE(${status ?? null}, status),
        description       = COALESCE(${description ?? null}, description),
        notes             = COALESCE(${notes ?? null}, notes),
        total_cost        = COALESCE(${total_cost ?? null}, total_cost),
        mileage           = COALESCE(${mileage ?? null}, mileage),
        next_service_km   = COALESCE(${next_service_km ?? null}, next_service_km),
        next_service_date = COALESCE(${next_service_date ?? null}, next_service_date)
      WHERE id = ${req.params.id} AND center_id = ${centerId}
      RETURNING *
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Log not found or unauthorized' })
    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update log' })
  }
})

// DELETE /api/v1/maintenance/:id
maintenanceRouter.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    await sql`DELETE FROM maintenance_logs WHERE id = ${req.params.id} AND center_id = ${centerId}`
    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to delete log' })
  }
})
