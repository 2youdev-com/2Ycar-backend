import { Router, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/client'
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
    let query = db
      .from('vehicles')
      .select('*, customer:profiles!customer_id(full_name, phone)')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })

    if (customer_id) query = query.eq('customer_id', customer_id as string)
    if (search)      query = query.or(`make.ilike.%${search}%,model.ilike.%${search}%,plate_number.ilike.%${search}%`)

    const { data, error } = await query
    if (error) throw error
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch vehicles' })
  }
})

// GET /api/v1/vehicles/:id
vehiclesRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await db
      .from('vehicles')
      .select('*, customer:profiles!customer_id(*)')
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Vehicle not found' })
    return res.json(data)
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

  try {
    const { data, error } = await db
      .from('vehicles')
      .insert({ ...parsed.data, center_id: centerId })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json(data)
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

  try {
    const { data, error } = await db
      .from('vehicles')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('center_id', centerId)
      .select()
      .single()

    if (error || !data) return res.status(404).json({ error: 'Vehicle not found' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update vehicle' })
  }
})

// DELETE /api/v1/vehicles/:id
vehiclesRouter.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  try {
    const { error } = await db.from('vehicles').delete().eq('id', req.params.id).eq('center_id', centerId)
    if (error) throw error
    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to delete vehicle' })
  }
})
