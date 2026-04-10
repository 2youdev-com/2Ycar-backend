import { Router, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/client'
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

  try {
    // Get all customer IDs linked to this center via their vehicles
    const { data: vehicleLinks } = await db
      .from('vehicles')
      .select('customer_id')
      .eq('center_id', centerId)

    const customerIds = [...new Set((vehicleLinks || []).map((v: { customer_id: string }) => v.customer_id))]
    if (customerIds.length === 0) return res.json({ data: [], total: 0 })

    let query = db
      .from('profiles')
      .select('id, full_name, phone, email, avatar_url, created_at')
      .in('id', customerIds)
      .eq('role', 'customer')
      .order('full_name', { ascending: true })
      .range((+page - 1) * +limit, +page * +limit - 1)

    if (search) query = query.ilike('full_name', `%${search}%`)

    const { data, error, count } = await query
    if (error) throw error

    return res.json({ data, total: count, page: +page, limit: +limit })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch customers' })
  }
})

// GET /api/v1/customers/:id — full customer profile with vehicles + logs
customersRouter.get('/:id', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id!

  try {
    const [{ data: profile }, { data: vehicles }, { data: logs }] = await Promise.all([
      db.from('profiles').select('*').eq('id', req.params.id).single(),
      db.from('vehicles').select('*').eq('customer_id', req.params.id).eq('center_id', centerId),
      db.from('maintenance_logs')
        .select('id, date, service_type, total_cost, status, mileage')
        .eq('customer_id', req.params.id)
        .eq('center_id', centerId)
        .order('date', { ascending: false })
        .limit(20),
    ])

    if (!profile) return res.status(404).json({ error: 'Customer not found' })

    return res.json({ profile, vehicles, logs })
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
    // Create Supabase auth user
    const { data: authUser, error: authErr } = await db.auth.admin.createUser({
      email:    parsed.data.email,
      password: Math.random().toString(36).slice(2, 10) + 'Aa1!',
      email_confirm: true,
    })

    if (authErr || !authUser.user) throw authErr

    // Insert profile
    const { data, error } = await db
      .from('profiles')
      .insert({
        id:        authUser.user.id,
        email:     parsed.data.email,
        full_name: parsed.data.full_name,
        phone:     parsed.data.phone,
        role:      'customer',
      })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json(data)
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

  try {
    const { data, error } = await db
      .from('profiles')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error || !data) return res.status(404).json({ error: 'Customer not found' })
    return res.json(data)
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to update customer' })
  }
})
