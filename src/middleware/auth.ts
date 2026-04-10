import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: 'admin' | 'customer'
    center_id: string | null
  }
}

// ── Verify JWT ───────────────────────────────────────────────
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: string
      email: string
      role: 'admin' | 'customer'
      center_id: string | null
    }

    req.user = {
      id:        payload.id,
      email:     payload.email,
      role:      payload.role,
      center_id: payload.center_id,
    }

    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ── Admin-only guard ──────────────────────────────────────────
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
