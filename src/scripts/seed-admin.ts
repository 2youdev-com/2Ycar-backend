import bcrypt from 'bcryptjs'
import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'
dotenv.config()

const sql = neon(process.env.DATABASE_URL!)

async function seedAdmin() {
  const email    = 'admin@elamrety.com'
  const password = 'Admin@2026'
  const name     = 'مدير العمريطي'
  const centerId = 'a1b2c3d4-0000-0000-0000-000000000001'

  const hash = await bcrypt.hash(password, 10)

  // Check if admin already exists
  const existing = await sql`SELECT id FROM profiles WHERE email = ${email}`
  if (existing.length > 0) {
    console.log('Admin already exists, updating password...')
    await sql`UPDATE profiles SET password_hash = ${hash} WHERE email = ${email}`
    console.log('Password updated.')
  } else {
    await sql`
      INSERT INTO profiles (full_name, email, password_hash, role, center_id)
      VALUES (${name}, ${email}, ${hash}, 'admin', ${centerId})
    `
    console.log('Admin created.')
  }

  console.log('──────────────────────────────')
  console.log('Admin credentials:')
  console.log(`  Email:    ${email}`)
  console.log(`  Password: ${password}`)
  console.log('──────────────────────────────')
}

seedAdmin().catch(console.error)
