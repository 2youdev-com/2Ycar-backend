-- ============================================================
-- Fix My Car - El Amrety Center | Database Schema (PostgreSQL)
-- Compatible with Neon PostgreSQL
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES TABLE
-- One row per user (admin or customer)
-- ============================================================
CREATE TABLE profiles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name    TEXT NOT NULL,
  phone        TEXT,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT,                                  -- bcrypt hash, NULL for legacy/admin-created customers
  role         TEXT NOT NULL DEFAULT 'customer'        -- 'admin' | 'customer'
               CHECK (role IN ('admin', 'customer')),
  avatar_url   TEXT,
  center_id    UUID,                                   -- NULL for customers, set for admins
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CENTERS TABLE
-- Each service center that subscribes to the platform
-- ============================================================
CREATE TABLE centers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  name_ar      TEXT,
  logo_url     TEXT,
  address      TEXT,
  phone        TEXT,
  email        TEXT,
  qr_code      TEXT UNIQUE,                            -- for QR registration
  plan         TEXT NOT NULL DEFAULT 'trial'
               CHECK (plan IN ('trial', 'monthly', 'annual')),
  trial_ends   TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from profiles to centers
ALTER TABLE profiles
  ADD CONSTRAINT fk_profiles_center
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE SET NULL;

-- ============================================================
-- VEHICLES TABLE
-- Each car owned by a customer, linked to a center
-- ============================================================
CREATE TABLE vehicles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  center_id    UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  make         TEXT NOT NULL,       -- e.g. BMW
  model        TEXT NOT NULL,       -- e.g. 320i
  year         INTEGER,
  color        TEXT,
  vin          TEXT UNIQUE,         -- Vehicle Identification Number
  plate_number TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SPARE_PARTS TABLE
-- Inventory managed by each center
-- ============================================================
CREATE TABLE spare_parts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  center_id    UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  name_ar      TEXT,
  brand        TEXT,
  sku          TEXT,
  price        NUMERIC(10, 2) NOT NULL DEFAULT 0,
  quantity     INTEGER NOT NULL DEFAULT 0,
  unit         TEXT DEFAULT 'piece',              -- 'piece' | 'liter' | 'set'
  category     TEXT,                              -- 'oil' | 'filter' | 'brake' | 'tyre' | 'other'
  image_url    TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  low_stock_threshold INTEGER DEFAULT 5,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MAINTENANCE_LOGS TABLE
-- Core table — records every maintenance session
-- ============================================================
CREATE TABLE maintenance_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  center_id       UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  technician_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  mileage         INTEGER,                         -- km reading at service time
  next_service_km INTEGER,                         -- recommended next service km
  next_service_date DATE,
  service_type    TEXT NOT NULL,                   -- 'oil_change' | 'brake' | 'full_service' | 'repair' | 'inspection'
  description     TEXT,
  notes           TEXT,
  total_cost      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'completed'
                  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MAINTENANCE_LOG_PARTS (Junction Table)
-- Parts used in each maintenance session
-- ============================================================
CREATE TABLE maintenance_log_parts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_id         UUID NOT NULL REFERENCES maintenance_logs(id) ON DELETE CASCADE,
  part_id        UUID REFERENCES spare_parts(id) ON DELETE SET NULL,
  part_name      TEXT NOT NULL,      -- snapshot at time of service
  quantity_used  INTEGER NOT NULL DEFAULT 1,
  unit_price     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_price    NUMERIC(10, 2) GENERATED ALWAYS AS (quantity_used * unit_price) STORED
);

-- ============================================================
-- APPOINTMENTS TABLE
-- Optional: booking requests from customers
-- ============================================================
CREATE TABLE appointments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  center_id    UUID NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vehicle_id   UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL,
  service_type TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CHAT_MESSAGES TABLE
-- Persisted AI assistant conversations per account and role context
-- ============================================================
CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  center_id   UUID REFERENCES centers(id) ON DELETE SET NULL,
  context     TEXT NOT NULL
              CHECK (context IN ('admin', 'customer')),
  role        TEXT NOT NULL
              CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_vehicles_customer    ON vehicles(customer_id);
CREATE INDEX idx_vehicles_center      ON vehicles(center_id);
CREATE INDEX idx_maint_center         ON maintenance_logs(center_id);
CREATE INDEX idx_maint_vehicle        ON maintenance_logs(vehicle_id);
CREATE INDEX idx_maint_customer       ON maintenance_logs(customer_id);
CREATE INDEX idx_maint_date           ON maintenance_logs(date DESC);
CREATE INDEX idx_parts_center         ON spare_parts(center_id);
CREATE INDEX idx_parts_available      ON spare_parts(is_available);
CREATE INDEX idx_appointments_center  ON appointments(center_id);
CREATE INDEX idx_appointments_date    ON appointments(requested_at);
CREATE INDEX idx_chat_messages_profile_context_created
  ON chat_messages(profile_id, context, created_at);
CREATE INDEX idx_chat_messages_center ON chat_messages(center_id);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_vehicles_updated
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_maint_updated
  BEFORE UPDATE ON maintenance_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_parts_updated
  BEFORE UPDATE ON spare_parts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-deduct inventory when a maintenance log part is inserted
CREATE OR REPLACE FUNCTION deduct_part_inventory()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.part_id IS NOT NULL THEN
    UPDATE spare_parts
    SET quantity = quantity - NEW.quantity_used
    WHERE id = NEW.part_id AND quantity >= NEW.quantity_used;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deduct_inventory
  AFTER INSERT ON maintenance_log_parts
  FOR EACH ROW EXECUTE FUNCTION deduct_part_inventory();

-- ============================================================
-- SEED: Demo center (El Amrety)
-- ============================================================
INSERT INTO centers (id, name, name_ar, plan, trial_ends, qr_code)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'El Amrety Center',
  'مركز العمريطي',
  'trial',
  NOW() + INTERVAL '14 days',
  'ELAMRETY-001'
);
