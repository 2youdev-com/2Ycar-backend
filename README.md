# El Amrety Backend ⚙️

> REST API لمنصة إدارة مركز العمريطي — Express.js + Supabase

![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Express](https://img.shields.io/badge/Express-4-black?logo=express)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)

## 🗄️ Database Schema

All tables are defined in `schema.sql`. Run it once on your Supabase project:

1. Go to Supabase Dashboard → SQL Editor
2. Paste the contents of `schema.sql`
3. Click Run

### Tables

| Table | Description |
|-------|-------------|
| `profiles` | Users (admin + customer) extending Supabase Auth |
| `centers` | Service centers subscribed to the platform |
| `vehicles` | Cars linked to customers & centers |
| `maintenance_logs` | Service records |
| `maintenance_log_parts` | Parts used per service |
| `spare_parts` | Inventory per center |
| `appointments` | Booking requests |

## 🚀 Getting Started

```bash
# 1. Clone
git clone https://github.com/Belal-Mohamed-24/El-Amrety-backend.git
cd El-Amrety-backend

# 2. Install
npm install

# 3. Environment
cp .env.example .env
# Edit .env with your Supabase service role key

# 4. Dev server
npm run dev
```

Server runs at `http://localhost:4000`

## 📡 API Endpoints

### Dashboard
```
GET /api/v1/dashboard/stats          — Center stats overview
GET /api/v1/dashboard/revenue-chart  — Monthly revenue data
```

### Maintenance Logs
```
GET    /api/v1/maintenance           — List logs (paginated)
GET    /api/v1/maintenance/:id       — Get single log with parts
POST   /api/v1/maintenance           — Create new log
PATCH  /api/v1/maintenance/:id       — Update log
DELETE /api/v1/maintenance/:id       — Delete log
```

### Inventory
```
GET    /api/v1/inventory             — List parts (filterable)
GET    /api/v1/inventory/low-stock   — Low stock alert items
GET    /api/v1/inventory/:id         — Get single part
POST   /api/v1/inventory             — Add new part
PATCH  /api/v1/inventory/:id         — Update part
PATCH  /api/v1/inventory/:id/quantity — Adjust quantity (delta)
DELETE /api/v1/inventory/:id         — Delete part
```

### Customers
```
GET    /api/v1/customers             — List center customers
GET    /api/v1/customers/:id         — Full profile + vehicles + logs
POST   /api/v1/customers             — Create customer account
PATCH  /api/v1/customers/:id         — Update customer info
```

### Vehicles
```
GET    /api/v1/vehicles              — List vehicles
GET    /api/v1/vehicles/:id          — Get single vehicle
POST   /api/v1/vehicles              — Register vehicle
PATCH  /api/v1/vehicles/:id          — Update vehicle
DELETE /api/v1/vehicles/:id          — Remove vehicle
```

### Appointments
```
GET    /api/v1/appointments          — List appointments
POST   /api/v1/appointments          — Book appointment (customer)
PATCH  /api/v1/appointments/:id/status — Update status (admin)
```

## 🔐 Authentication

All routes require a Supabase JWT in the Authorization header:

```
Authorization: Bearer <supabase_access_token>
```

Admin routes additionally check `role = 'admin'` in the profiles table.

## 🛠️ Tech Stack

| Layer       | Technology |
|-------------|-----------|
| Runtime     | Node.js 20 |
| Framework   | Express 4 |
| Language    | TypeScript 5 |
| Database    | Supabase (PostgreSQL) |
| Auth        | Supabase Auth (JWT) |
| Validation  | Zod |
| Security    | Helmet + CORS + Rate Limiting |

## 📄 License

Private — El Amrety Center © 2024
