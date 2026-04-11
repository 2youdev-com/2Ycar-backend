import { Router, Response } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt, { SignOptions } from 'jsonwebtoken'
import { sql } from '../db/client'
import { requireAuth, AuthRequest } from '../middleware/auth'

export const authRouter = Router()

const JWT_SECRET     = process.env.JWT_SECRET || 'change-me-in-production'
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// POST /api/v1/auth/login
authRouter.post('/login', async (req, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const { email, password } = parsed.data

  try {
    const rows = await sql`
      SELECT id, full_name, email, password_hash, role, center_id
      FROM profiles
      WHERE email = ${email}
    `

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = rows[0]

    if (!user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, center_id: user.center_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as SignOptions
    )

    return res.json({
      token,
      user: {
        id:        user.id,
        email:     user.email,
        full_name: user.full_name,
        role:      user.role,
        center_id: user.center_id,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Login failed' })
  }
})

const registerSchema = z.object({
  full_name: z.string().min(2),
  email:     z.string().email(),
  password:  z.string().min(6),
  phone:     z.string().optional(),
})

// POST /api/v1/auth/register
authRouter.post('/register', async (req, res: Response) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.flatten() })
  }

  const { full_name, email, password, phone } = parsed.data

  try {
    // Check if email already exists
    const existing = await sql`SELECT id FROM profiles WHERE email = ${email}`
    if (existing.length > 0) {
      return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const rows = await sql`
      INSERT INTO profiles (full_name, email, password_hash, phone, role)
      VALUES (${full_name}, ${email}, ${passwordHash}, ${phone ?? null}, 'customer')
      RETURNING id, full_name, email, role, center_id
    `

    const user = rows[0]

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, center_id: user.center_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as SignOptions
    )

    return res.status(201).json({
      token,
      user: {
        id:        user.id,
        email:     user.email,
        full_name: user.full_name,
        role:      user.role,
        center_id: user.center_id,
      },
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Registration failed' })
  }
})

// GET /api/v1/auth/me — get current user profile
authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await sql`
      SELECT id, full_name, email, phone, role, center_id, avatar_url, created_at
      FROM profiles
      WHERE id = ${req.user!.id}
    `

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' })
    }

    return res.json(rows[0])
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch profile' })
  }
})
