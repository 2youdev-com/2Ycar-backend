import cron from 'node-cron'
import nodemailer from 'nodemailer'
import { sql } from '../db/client'
import dotenv from 'dotenv'
dotenv.config()

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

async function sendReminderEmail(
  to: string,
  customerName: string,
  vehicleInfo: string,
  serviceType: string
) {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to,
    subject: `تذكير: موعد صيانة ${vehicleInfo} القادم`,
    html: `
      <div dir="rtl" style="font-family: Cairo, Arial, sans-serif; max-width: 600px; margin: auto; background: #0A0C10; color: #F1FAEE; padding: 32px; border-radius: 12px;">
        <h1 style="color: #E63946;">El Amrety</h1>
        <p>مرحباً <strong>${customerName}</strong>،</p>
        <p>موعد <strong>${serviceType}</strong> لسيارتك <strong>${vehicleInfo}</strong> قد اقترب.</p>
        <p style="color: #9ca3af; font-size: 14px;">اتصل بنا: <strong style="color: #F1FAEE;">01012345678</strong></p>
      </div>
    `,
  })
}

async function sendMaintenanceReminders() {
  console.log('🔔 Running maintenance reminder job...')

  try {
    const sevenDaysFromNow = new Date()
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)

    const today  = new Date().toISOString().split('T')[0]
    const target = sevenDaysFromNow.toISOString().split('T')[0]

    const logs = await sql`
      SELECT ml.id, ml.service_type, ml.next_service_date,
        cp.full_name AS customer_name, cp.email AS customer_email,
        v.make, v.model, v.year
      FROM maintenance_logs ml
      LEFT JOIN profiles cp ON cp.id = ml.customer_id
      LEFT JOIN vehicles v ON v.id = ml.vehicle_id
      WHERE ml.next_service_date >= ${today}::date
        AND ml.next_service_date <= ${target}::date
        AND ml.status = 'completed'
    `

    let sent = 0

    for (const log of logs) {
      if (!log.customer_email) continue

      const vehicleInfo  = log.make ? `${log.make} ${log.model} ${log.year}` : 'سيارتك'
      const serviceLabel = (log.service_type || 'صيانة دورية').replace(/_/g, ' ')

      try {
        await sendReminderEmail(log.customer_email, log.customer_name, vehicleInfo, serviceLabel)
        sent++
        console.log(`  ✅ Reminder sent to ${log.customer_email}`)
      } catch (emailErr) {
        console.error(`  ❌ Failed to send to ${log.customer_email}:`, emailErr)
      }
    }

    console.log(`🔔 Done — sent ${sent} reminders`)
  } catch (err) {
    console.error('Reminder job failed:', err)
  }
}

export function startReminderJob() {
  cron.schedule('0 9 * * *', sendMaintenanceReminders, { timezone: 'Africa/Cairo' })
  console.log('⏰ Reminder job scheduled — daily at 9:00 AM Cairo')
}
