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
import { authRouter }         from './routes/auth'
import { chatRouter }         from './routes/chat'

const app  = express()
const PORT = process.env.PORT || 4000

// Trust Vercel's edge proxy so req.ip and rate-limiter see the real client IP
app.set('trust proxy', 1)

// ── Security & Middleware ──────────────────────────────────────
// CORS must run before helmet so preflight isn't blocked
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, ...process.env.FRONTEND_URL.replace('https://', 'https://www.').split(',')]
  : ['*']

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, mobile apps)
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      cb(null, true)
    } else {
      cb(null, true) // allow all for now during development
    }
  },
  credentials: true,
}))
app.use(helmet({ crossOriginResourcePolicy: false }))
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
app.use(`${API}/auth`,         authRouter)
app.use(`${API}/dashboard`,    dashboardRouter)
app.use(`${API}/maintenance`,  maintenanceRouter)
app.use(`${API}/inventory`,    inventoryRouter)
app.use(`${API}/customers`,    customersRouter)
app.use(`${API}/vehicles`,     vehiclesRouter)
app.use(`${API}/appointments`, appointmentsRouter)
app.use(`${API}/chat`,         chatRouter)

// ── 404 & Error handler ────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 El Amrety API running on http://localhost:${PORT}`)
    startReminderJob()
  })
}

export default app
