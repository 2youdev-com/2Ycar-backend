import { Router, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const inventoryRouter = Router()

const partSchema = z.object({
  name:                 z.string().min(1),
  name_ar:              z.string().optional(),
  brand:                z.string().optional(),
  sku:                  z.string().optional(),
  price:                z.number().min(0),
  quantity:             z.number().int().min(0),
  unit:                 z.enum(['piece', 'liter', 'set']).default('piece'),
  category:             z.string().optional(),
  image_url:            z.string().url().optional(),
  is_available:         z.boolean().default(true),
  low_stock_threshold:  z.number().int().min(0).default(5),
})

// GET /api/v1/inventory — list all parts
inventoryRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id ?? req.query.center_id as string
  if (!centerId) return res.status(400).json({ error: 'center_id required' })

  const { category, available, search, page = '1', limit = '50' } = req.query

  try {
    let query = db
      .from('spare_parts')
      .select('*')
      .eq('center_id', centerId)
      .order('name', { ascending: true })
      .range((+page - 1) * +limit, +page * +limit - 1)

    if (category)                  query = query.eq('category', category as string)
    if (available === 'true')      query = query.eq('is_available', true)
    if (search)                    query = query.ilike('name', `%${search}%`)

    const { data, error, count } = await query
    if (error) throw error

    return res.json({ data, total: count, page: +page, limit: +limit })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch inventory' })
  }
})

// GET /api/v1/inventory/low-stock
inventoryRouter.get('/low-stock', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const { data, error } = await db
      .from('spare_parts')
      .select('*')
      .eq('center_id', centerId)
      .filter('quantity', 'lte', 'low_stock_threshold')
      .order('quantity', { ascending: true })

    if (error) throw error
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch low stock items' })
  }
})

// GET /api/v1/inventory/:id
inventoryRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await db
      .from('spare_parts')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Part not found' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch part' })
  }
})

// POST /api/v1/inventory
inventoryRouter.post('/', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  const parsed = partSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  try {
    const { data, error } = await db
      .from('spare_parts')
      .insert({ ...parsed.data, center_id: centerId })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to create part' })
  }
})

// PATCH /api/v1/inventory/:id
inventoryRouter.patch('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  const parsed = partSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  try {
    const { data, error } = await db
      .from('spare_parts')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('center_id', centerId)
      .select()
      .single()

    if (error || !data) return res.status(404).json({ error: 'Part not found or unauthorized' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update part' })
  }
})

// PATCH /api/v1/inventory/:id/quantity — adjust quantity only
inventoryRouter.patch('/:id/quantity', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const { delta } = req.body // positive to add, negative to deduct

  if (typeof delta !== 'number') {
    return res.status(400).json({ error: 'delta (number) is required' })
  }

  try {
    // Fetch current quantity
    const { data: part } = await db
      .from('spare_parts')
      .select('quantity')
      .eq('id', req.params.id)
      .eq('center_id', centerId)
      .single()

    if (!part) return res.status(404).json({ error: 'Part not found' })

    const newQty = part.quantity + delta
    if (newQty < 0) return res.status(400).json({ error: 'Insufficient stock' })

    const { data, error } = await db
      .from('spare_parts')
      .update({ quantity: newQty, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to adjust quantity' })
  }
})

// DELETE /api/v1/inventory/:id
inventoryRouter.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const { error } = await db
      .from('spare_parts')
      .delete()
      .eq('id', req.params.id)
      .eq('center_id', centerId)

    if (error) throw error
    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to delete part' })
  }
})
