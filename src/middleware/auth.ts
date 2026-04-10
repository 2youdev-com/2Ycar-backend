import { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: 'admin' | 'customer'
    center_id: string | null
  }
}

// ── Verify JWT from Supabase Auth ─────────────────────────────
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.split(' ')[1]

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Fetch profile for role + center_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, center_id')
    .eq('id', user.id)
    .single()

  req.user = {
    id:        user.id,
    email:     user.email!,
    role:      profile?.role ?? 'customer',
    center_id: profile?.center_id ?? null,
  }

  next()
}

// ── Admin-only guard ──────────────────────────────────────────
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}
