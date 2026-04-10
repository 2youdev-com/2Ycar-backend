import { Router, Response } from 'express'
import { sql } from '../db/client'
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth'

export const dashboardRouter = Router()

// GET /api/v1/dashboard/stats
dashboardRouter.get('/stats', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const centerId = req.user!.center_id
  if (!centerId) return res.status(400).json({ error: 'No center associated with this account' })

  try {
    const now          = new Date()
    const thisMonth    = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const lastMonth    = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString()

    const [
      customersResult,
      appointmentsResult,
      lowStockParts,
      thisMonthLogs,
      lastMonthLogs,
      totalLogsResult,
    ] = await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM profiles WHERE role = 'customer'`,
      sql`SELECT COUNT(*)::int AS count FROM appointments WHERE center_id = ${centerId} AND status = 'pending'`,
      sql`SELECT id, name, quantity, low_stock_threshold FROM spare_parts WHERE center_id = ${centerId} AND quantity <= low_stock_threshold`,
      sql`SELECT total_cost FROM maintenance_logs WHERE center_id = ${centerId} AND date >= ${thisMonth}::date`,
      sql`SELECT total_cost FROM maintenance_logs WHERE center_id = ${centerId} AND date >= ${lastMonth}::date AND date <= ${lastMonthEnd}::date`,
      sql`SELECT COUNT(*)::int AS count FROM maintenance_logs WHERE center_id = ${centerId}`,
    ])

    const totalCustomers      = customersResult[0]?.count ?? 0
    const pendingAppointments = appointmentsResult[0]?.count ?? 0
    const totalLogs           = totalLogsResult[0]?.count ?? 0

    const monthlyRevenue = thisMonthLogs.reduce((s, l) => s + (Number(l.total_cost) || 0), 0)
    const prevRevenue    = lastMonthLogs.reduce((s, l) => s + (Number(l.total_cost) || 0), 0)
    const revenueChange  = prevRevenue > 0 ? ((monthlyRevenue - prevRevenue) / prevRevenue) * 100 : 0

    return res.json({
      totalCustomers,
      pendingAppointments,
      lowStockParts:  lowStockParts.length,
      lowStockItems:  lowStockParts,
      monthlyRevenue,
      revenueChange:  Math.round(revenueChange * 10) / 10,
      totalLogs,
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
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

    const data = await sql`
      SELECT date, total_cost FROM maintenance_logs
      WHERE center_id = ${centerId} AND date >= ${since}::date
      ORDER BY date ASC
    `

    // Group by month
    const grouped: Record<string, number> = {}
    for (const log of data) {
      const month = String(log.date).slice(0, 7) // YYYY-MM
      grouped[month] = (grouped[month] || 0) + Number(log.total_cost)
    }

    return res.json(
      Object.entries(grouped).map(([month, revenue]) => ({ month, revenue }))
    )
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Failed to fetch revenue chart data' })
  }
})
