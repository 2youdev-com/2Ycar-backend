import cron from 'node-cron'
import nodemailer from 'nodemailer'
import { db } from '../db/client'
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

    const { data: logs, error } = await db
      .from('maintenance_logs')
      .select(`
        id, service_type, next_service_date,
        customer:profiles!customer_id(full_name, email, phone),
        vehicle:vehicles(make, model, year, plate_number)
      `)
      .gte('next_service_date', today)
      .lte('next_service_date', target)
      .eq('status', 'completed')

    if (error) throw error

    let sent = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const log of (logs || []) as any[]) {
      // Supabase returns joined rows as arrays — take first element
      const customer = Array.isArray(log.customer) ? log.customer[0] : log.customer
      const vehicle  = Array.isArray(log.vehicle)  ? log.vehicle[0]  : log.vehicle

      if (!customer?.email) continue

      const vehicleInfo  = vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.year}` : 'سيارتك'
      const serviceLabel = (log.service_type || 'صيانة دورية').replace(/_/g, ' ')

      try {
        await sendReminderEmail(customer.email, customer.full_name, vehicleInfo, serviceLabel)
        sent++
        console.log(`  ✅ Reminder sent to ${customer.email}`)
      } catch (emailErr) {
        console.error(`  ❌ Failed to send to ${customer.email}:`, emailErr)
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
