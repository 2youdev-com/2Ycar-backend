import { Router, Response } from 'express'
import { db } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const dashboardRouter = Router()

// GET /api/v1/dashboard/stats
dashboardRouter.get('/stats', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id
  if (!centerId) return res.status(400).json({ error: 'No center associated with this account' })

  try {
    const now       = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString()

    const [
      { count: totalCustomers },
      { count: pendingAppointments },
      { data: lowStockParts },
      { data: thisMonthLogs },
      { data: lastMonthLogs },
      { count: totalLogs },
    ] = await Promise.all([
      db.from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'customer'),

      db.from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', centerId)
        .eq('status', 'pending'),

      db.from('spare_parts')
        .select('id, name, quantity, low_stock_threshold')
        .eq('center_id', centerId)
        .filter('quantity', 'lte', 'low_stock_threshold'),

      db.from('maintenance_logs')
        .select('total_cost')
        .eq('center_id', centerId)
        .gte('date', thisMonth),

      db.from('maintenance_logs')
        .select('total_cost')
        .eq('center_id', centerId)
        .gte('date', lastMonth)
        .lte('date', lastMonthEnd),

      db.from('maintenance_logs')
        .select('*', { count: 'exact', head: true })
        .eq('center_id', centerId),
    ])

    const monthlyRevenue   = (thisMonthLogs || []).reduce((s: number, l: { total_cost: number }) => s + (l.total_cost || 0), 0)
    const prevRevenue      = (lastMonthLogs || []).reduce((s: number, l: { total_cost: number }) => s + (l.total_cost || 0), 0)
    const revenueChange    = prevRevenue > 0 ? ((monthlyRevenue - prevRevenue) / prevRevenue) * 100 : 0

    return res.json({
      totalCustomers:      totalCustomers ?? 0,
      pendingAppointments: pendingAppointments ?? 0,
      lowStockParts:       (lowStockParts || []).length,
      lowStockItems:       lowStockParts || [],
      monthlyRevenue,
      revenueChange:       Math.round(revenueChange * 10) / 10,
      totalLogs:           totalLogs ?? 0,
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch dashboard stats' })
  }
})

// GET /api/v1/dashboard/revenue-chart
dashboardRouter.get('/revenue-chart', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id
  if (!centerId) return res.status(400).json({ error: 'No center associated' })

  try {
    const { data, error } = await db
      .from('maintenance_logs')
      .select('date, total_cost')
      .eq('center_id', centerId)
      .gte('date', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .order('date', { ascending: true })

    if (error) throw error

    // Group by month
    const grouped: Record<string, number> = {}
    for (const log of data || []) {
      const month = log.date.slice(0, 7) // YYYY-MM
      grouped[month] = (grouped[month] || 0) + log.total_cost
    }

    return res.json(
      Object.entries(grouped).map(([month, revenue]) => ({ month, revenue }))
    )
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch revenue chart data' })
  }
})
