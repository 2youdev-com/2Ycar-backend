import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'

dotenv.config()

import { startReminderJob }   from './services/reminders'
import { maintenanceRouter }  from './routes/maintenance'
import { inventoryRouter }    from './routes/inventory'
import { customersRouter }    from './routes/customers'
import { vehiclesRouter }     from './routes/vehicles'
import { dashboardRouter }    from './routes/dashboard'
import { appointmentsRouter } from './routes/appointments'

const app  = express()
const PORT = process.env.PORT || 4000

// ── Security & Middleware ──────────────────────────────────────
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}))
app.use(morgan('dev'))
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
})
app.use(limiter)

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'El Amrety API',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  })
})

// ── API Routes ────────────────────────────────────────────────
const API = '/api/v1'
app.use(`${API}/dashboard`,    dashboardRouter)
app.use(`${API}/maintenance`,  maintenanceRouter)
app.use(`${API}/inventory`,    inventoryRouter)
app.use(`${API}/customers`,    customersRouter)
app.use(`${API}/vehicles`,     vehiclesRouter)
app.use(`${API}/appointments`, appointmentsRouter)

// ── 404 & Error handler ────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`🚀 El Amrety API running on http://localhost:${PORT}`)
  startReminderJob()
})

export default app
