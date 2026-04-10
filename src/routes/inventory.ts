import { Router, Response } from 'express'
import { z } from 'zod'
import { sql } from '../db/client'
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
  const offset = (+page - 1) * +limit

  try {
    const data = await sql`
      SELECT * FROM spare_parts
      WHERE center_id = ${centerId}
        AND (${category || null}::text IS NULL OR category = ${category || null})
        AND (${available === 'true' ? true : null}::boolean IS NULL OR is_available = ${available === 'true'})
        AND (${search || null}::text IS NULL OR name ILIKE ${'%' + (search || '') + '%'})
      ORDER BY name ASC
      LIMIT ${+limit} OFFSET ${offset}
    `

    return res.json({ data, page: +page, limit: +limit })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch inventory' })
  }
})

// GET /api/v1/inventory/low-stock
inventoryRouter.get('/low-stock', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const data = await sql`
      SELECT * FROM spare_parts
      WHERE center_id = ${centerId}
        AND quantity <= low_stock_threshold
      ORDER BY quantity ASC
    `

    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch low stock items' })
  }
})

// GET /api/v1/inventory/:id
inventoryRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await sql`
      SELECT * FROM spare_parts WHERE id = ${req.params.id}
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Part not found' })
    return res.json(rows[0])
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

  const d = parsed.data
  try {
    const rows = await sql`
      INSERT INTO spare_parts (center_id, name, name_ar, brand, sku, price, quantity, unit, category, image_url, is_available, low_stock_threshold)
      VALUES (${centerId}, ${d.name}, ${d.name_ar ?? null}, ${d.brand ?? null}, ${d.sku ?? null}, ${d.price}, ${d.quantity}, ${d.unit}, ${d.category ?? null}, ${d.image_url ?? null}, ${d.is_available}, ${d.low_stock_threshold})
      RETURNING *
    `

    return res.status(201).json(rows[0])
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

  const d = parsed.data
  try {
    const rows = await sql`
      UPDATE spare_parts SET
        name                = COALESCE(${d.name ?? null}, name),
        name_ar             = COALESCE(${d.name_ar ?? null}, name_ar),
        brand               = COALESCE(${d.brand ?? null}, brand),
        sku                 = COALESCE(${d.sku ?? null}, sku),
        price               = COALESCE(${d.price ?? null}, price),
        quantity            = COALESCE(${d.quantity ?? null}, quantity),
        unit                = COALESCE(${d.unit ?? null}, unit),
        category            = COALESCE(${d.category ?? null}, category),
        image_url           = COALESCE(${d.image_url ?? null}, image_url),
        is_available        = COALESCE(${d.is_available ?? null}, is_available),
        low_stock_threshold = COALESCE(${d.low_stock_threshold ?? null}, low_stock_threshold)
      WHERE id = ${req.params.id} AND center_id = ${centerId}
      RETURNING *
    `

    if (rows.length === 0) return res.status(404).json({ error: 'Part not found or unauthorized' })
    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update part' })
  }
})

// PATCH /api/v1/inventory/:id/quantity — adjust quantity only
inventoryRouter.patch('/:id/quantity', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!
  const { delta } = req.body

  if (typeof delta !== 'number') {
    return res.status(400).json({ error: 'delta (number) is required' })
  }

  try {
    const parts = await sql`
      SELECT quantity FROM spare_parts WHERE id = ${req.params.id} AND center_id = ${centerId}
    `

    if (parts.length === 0) return res.status(404).json({ error: 'Part not found' })

    const newQty = parts[0].quantity + delta
    if (newQty < 0) return res.status(400).json({ error: 'Insufficient stock' })

    const rows = await sql`
      UPDATE spare_parts SET quantity = ${newQty}
      WHERE id = ${req.params.id}
      RETURNING *
    `

    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to adjust quantity' })
  }
})

// DELETE /api/v1/inventory/:id
inventoryRouter.delete('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    await sql`
      DELETE FROM spare_parts WHERE id = ${req.params.id} AND center_id = ${centerId}
    `

    return res.json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to delete part' })
  }
})
