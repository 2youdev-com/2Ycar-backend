import { sql } from '../db/client'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

// ── Tool Definitions for Gemini ─────────────────────────────────

const tools = [
  {
    function_declarations: [
      // ── Dashboard / Stats ──
      {
        name: 'get_dashboard_stats',
        description: 'احصل على إحصائيات لوحة التحكم: عدد العملاء، المواعيد المعلقة، قطع الغيار منخفضة المخزون، إيرادات الشهر الحالي، إجمالي سجلات الصيانة',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'get_revenue_chart',
        description: 'احصل على بيانات الإيرادات الشهرية لآخر 6 شهور لعرض التقارير والرسم البياني',
        parameters: { type: 'object', properties: {}, required: [] },
      },

      // ── Customers ──
      {
        name: 'list_customers',
        description: 'اعرض قائمة العملاء المسجلين في المركز. يمكن البحث بالاسم',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'البحث بالاسم' },
            page: { type: 'number', description: 'رقم الصفحة (افتراضي 1)' },
            limit: { type: 'number', description: 'عدد النتائج (افتراضي 30)' },
          },
          required: [],
        },
      },
      {
        name: 'get_customer_details',
        description: 'احصل على تفاصيل عميل معين بما في ذلك سياراته وسجلات صيانته',
        parameters: {
          type: 'object',
          properties: {
            customer_id: { type: 'string', description: 'معرف العميل UUID' },
          },
          required: ['customer_id'],
        },
      },
      {
        name: 'create_customer',
        description: 'أضف عميل جديد للمركز',
        parameters: {
          type: 'object',
          properties: {
            full_name: { type: 'string', description: 'اسم العميل بالكامل' },
            email: { type: 'string', description: 'البريد الإلكتروني' },
            phone: { type: 'string', description: 'رقم الهاتف' },
          },
          required: ['full_name', 'email'],
        },
      },
      {
        name: 'update_customer',
        description: 'عدّل بيانات عميل (الاسم، الهاتف، الإيميل)',
        parameters: {
          type: 'object',
          properties: {
            customer_id: { type: 'string', description: 'معرف العميل UUID' },
            full_name: { type: 'string', description: 'الاسم الجديد' },
            phone: { type: 'string', description: 'الهاتف الجديد' },
            email: { type: 'string', description: 'الإيميل الجديد' },
          },
          required: ['customer_id'],
        },
      },

      // ── Vehicles ──
      {
        name: 'list_vehicles',
        description: 'اعرض قائمة السيارات المسجلة. يمكن البحث بالماركة أو الموديل أو رقم اللوحة، أو فلترة حسب عميل معين',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'بحث بالماركة/الموديل/اللوحة' },
            customer_id: { type: 'string', description: 'فلترة حسب عميل معين' },
          },
          required: [],
        },
      },
      {
        name: 'create_vehicle',
        description: 'سجّل سيارة جديدة لعميل',
        parameters: {
          type: 'object',
          properties: {
            customer_id: { type: 'string', description: 'معرف العميل UUID' },
            make: { type: 'string', description: 'الماركة (مثل: تويوتا)' },
            model: { type: 'string', description: 'الموديل (مثل: كامري)' },
            year: { type: 'number', description: 'سنة الصنع' },
            color: { type: 'string', description: 'اللون' },
            plate_number: { type: 'string', description: 'رقم اللوحة' },
          },
          required: ['customer_id', 'make', 'model'],
        },
      },
      {
        name: 'update_vehicle',
        description: 'عدّل بيانات سيارة (الماركة، الموديل، اللوحة، اللون، السنة)',
        parameters: {
          type: 'object',
          properties: {
            vehicle_id: { type: 'string', description: 'معرف السيارة UUID' },
            make: { type: 'string' },
            model: { type: 'string' },
            year: { type: 'number' },
            color: { type: 'string' },
            plate_number: { type: 'string' },
          },
          required: ['vehicle_id'],
        },
      },
      {
        name: 'delete_vehicle',
        description: 'احذف سيارة من النظام',
        parameters: {
          type: 'object',
          properties: {
            vehicle_id: { type: 'string', description: 'معرف السيارة UUID' },
          },
          required: ['vehicle_id'],
        },
      },

      // ── Maintenance Logs ──
      {
        name: 'list_maintenance_logs',
        description: 'اعرض سجلات الصيانة. يمكن الفلترة حسب العميل أو السيارة أو الحالة',
        parameters: {
          type: 'object',
          properties: {
            customer_id: { type: 'string', description: 'فلترة حسب العميل' },
            vehicle_id: { type: 'string', description: 'فلترة حسب السيارة' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'فلترة حسب الحالة' },
            page: { type: 'number', description: 'رقم الصفحة' },
            limit: { type: 'number', description: 'عدد النتائج' },
          },
          required: [],
        },
      },
      {
        name: 'get_maintenance_details',
        description: 'احصل على تفاصيل سجل صيانة معين بما في ذلك القطع المستخدمة',
        parameters: {
          type: 'object',
          properties: {
            log_id: { type: 'string', description: 'معرف سجل الصيانة UUID' },
          },
          required: ['log_id'],
        },
      },
      {
        name: 'create_maintenance_log',
        description: 'أنشئ سجل صيانة جديد لسيارة عميل',
        parameters: {
          type: 'object',
          properties: {
            vehicle_id: { type: 'string', description: 'معرف السيارة' },
            customer_id: { type: 'string', description: 'معرف العميل' },
            date: { type: 'string', description: 'التاريخ بصيغة YYYY-MM-DD' },
            service_type: { type: 'string', enum: ['oil_change', 'brake_service', 'full_service', 'repair', 'inspection', 'tyre_change', 'other'], description: 'نوع الخدمة' },
            description: { type: 'string', description: 'وصف الخدمة' },
            notes: { type: 'string', description: 'ملاحظات' },
            total_cost: { type: 'number', description: 'التكلفة الإجمالية' },
            mileage: { type: 'number', description: 'عداد الكيلومتر' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'حالة الصيانة' },
          },
          required: ['vehicle_id', 'customer_id', 'date', 'service_type', 'total_cost'],
        },
      },
      {
        name: 'update_maintenance_log',
        description: 'عدّل سجل صيانة (الحالة، التكلفة، الوصف، الملاحظات)',
        parameters: {
          type: 'object',
          properties: {
            log_id: { type: 'string', description: 'معرف سجل الصيانة' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            description: { type: 'string' },
            notes: { type: 'string' },
            total_cost: { type: 'number' },
            mileage: { type: 'number' },
          },
          required: ['log_id'],
        },
      },
      {
        name: 'delete_maintenance_log',
        description: 'احذف سجل صيانة',
        parameters: {
          type: 'object',
          properties: {
            log_id: { type: 'string', description: 'معرف سجل الصيانة' },
          },
          required: ['log_id'],
        },
      },

      // ── Inventory / Spare Parts ──
      {
        name: 'list_spare_parts',
        description: 'اعرض قائمة قطع الغيار والمخزون. يمكن البحث بالاسم أو فلترة حسب الفئة',
        parameters: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'بحث بالاسم' },
            category: { type: 'string', description: 'فلترة حسب الفئة (oil, filter, brake, tyre, other)' },
            page: { type: 'number' },
            limit: { type: 'number' },
          },
          required: [],
        },
      },
      {
        name: 'get_low_stock_parts',
        description: 'اعرض قطع الغيار منخفضة المخزون التي تحتاج إعادة تعبئة',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'create_spare_part',
        description: 'أضف قطعة غيار جديدة للمخزون',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'اسم القطعة بالإنجليزي' },
            name_ar: { type: 'string', description: 'اسم القطعة بالعربي' },
            brand: { type: 'string', description: 'الماركة' },
            sku: { type: 'string', description: 'رقم القطعة SKU' },
            price: { type: 'number', description: 'السعر' },
            quantity: { type: 'number', description: 'الكمية' },
            unit: { type: 'string', enum: ['piece', 'liter', 'set'], description: 'الوحدة' },
            category: { type: 'string', description: 'الفئة' },
            low_stock_threshold: { type: 'number', description: 'حد المخزون المنخفض' },
          },
          required: ['name', 'price', 'quantity'],
        },
      },
      {
        name: 'update_spare_part',
        description: 'عدّل بيانات قطعة غيار (السعر، الاسم، الفئة، إلخ)',
        parameters: {
          type: 'object',
          properties: {
            part_id: { type: 'string', description: 'معرف القطعة UUID' },
            name: { type: 'string' },
            name_ar: { type: 'string' },
            brand: { type: 'string' },
            price: { type: 'number' },
            quantity: { type: 'number' },
            category: { type: 'string' },
            low_stock_threshold: { type: 'number' },
          },
          required: ['part_id'],
        },
      },
      {
        name: 'adjust_part_quantity',
        description: 'زوّد أو نقّص كمية قطعة غيار (delta موجب للزيادة، سالب للنقص)',
        parameters: {
          type: 'object',
          properties: {
            part_id: { type: 'string', description: 'معرف القطعة UUID' },
            delta: { type: 'number', description: 'مقدار التغيير (موجب أو سالب)' },
          },
          required: ['part_id', 'delta'],
        },
      },
      {
        name: 'delete_spare_part',
        description: 'احذف قطعة غيار من المخزون',
        parameters: {
          type: 'object',
          properties: {
            part_id: { type: 'string', description: 'معرف القطعة UUID' },
          },
          required: ['part_id'],
        },
      },

      // ── Appointments ──
      {
        name: 'list_appointments',
        description: 'اعرض قائمة المواعيد. يمكن الفلترة حسب الحالة أو التاريخ',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed'], description: 'فلترة حسب الحالة' },
            date: { type: 'string', description: 'فلترة حسب التاريخ YYYY-MM-DD' },
          },
          required: [],
        },
      },
      {
        name: 'update_appointment_status',
        description: 'غيّر حالة موعد (تأكيد، إلغاء، إكمال)',
        parameters: {
          type: 'object',
          properties: {
            appointment_id: { type: 'string', description: 'معرف الموعد UUID' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed'], description: 'الحالة الجديدة' },
          },
          required: ['appointment_id', 'status'],
        },
      },

      // ── Search ──
      {
        name: 'search_all',
        description: 'ابحث في كل البيانات (عملاء، سيارات، قطع غيار) بكلمة بحث واحدة. مفيد لما المستخدم يسأل عن حاجة بالاسم بس مش محدد نوعها',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'كلمة البحث' },
          },
          required: ['query'],
        },
      },
    ],
  },
]

// ── Tool Execution Functions ────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>, centerId: string): Promise<unknown> {
  switch (name) {
    // ── Dashboard ──
    case 'get_dashboard_stats': {
      const now = new Date()
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString()

      const [customers, appointments, lowStock, thisMonthLogs, lastMonthLogs, totalLogs] = await Promise.all([
        sql`SELECT COUNT(*)::int AS count FROM profiles WHERE role = 'customer'`,
        sql`SELECT COUNT(*)::int AS count FROM appointments WHERE center_id = ${centerId} AND status = 'pending'`,
        sql`SELECT id, name, quantity, low_stock_threshold FROM spare_parts WHERE center_id = ${centerId} AND quantity <= low_stock_threshold`,
        sql`SELECT total_cost FROM maintenance_logs WHERE center_id = ${centerId} AND date >= ${thisMonth}::date`,
        sql`SELECT total_cost FROM maintenance_logs WHERE center_id = ${centerId} AND date >= ${lastMonth}::date AND date <= ${lastMonthEnd}::date`,
        sql`SELECT COUNT(*)::int AS count FROM maintenance_logs WHERE center_id = ${centerId}`,
      ])

      const monthlyRevenue = (thisMonthLogs as Array<Record<string, unknown>>).reduce((s, l) => s + (Number(l.total_cost) || 0), 0)
      const prevRevenue = (lastMonthLogs as Array<Record<string, unknown>>).reduce((s, l) => s + (Number(l.total_cost) || 0), 0)
      const revenueChange = prevRevenue > 0 ? Math.round(((monthlyRevenue - prevRevenue) / prevRevenue) * 1000) / 10 : 0

      return {
        totalCustomers: customers[0]?.count ?? 0,
        pendingAppointments: appointments[0]?.count ?? 0,
        lowStockParts: lowStock.length,
        lowStockItems: lowStock,
        monthlyRevenue,
        revenueChange,
        totalMaintenanceLogs: totalLogs[0]?.count ?? 0,
      }
    }

    case 'get_revenue_chart': {
      const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
      const data = await sql`
        SELECT date, total_cost FROM maintenance_logs
        WHERE center_id = ${centerId} AND date >= ${since}::date
        ORDER BY date ASC
      `
      const grouped: Record<string, number> = {}
      for (const log of data) {
        const month = String(log.date).slice(0, 7)
        grouped[month] = (grouped[month] || 0) + Number(log.total_cost)
      }
      return Object.entries(grouped).map(([month, revenue]) => ({ month, revenue }))
    }

    // ── Customers ──
    case 'list_customers': {
      const search = args.search as string | undefined
      const page = (args.page as number) || 1
      const limit = (args.limit as number) || 30
      const offset = (page - 1) * limit

      const data = await sql`
        SELECT DISTINCT p.id, p.full_name, p.phone, p.email, p.created_at
        FROM profiles p
        JOIN vehicles v ON v.customer_id = p.id
        WHERE v.center_id = ${centerId}
          AND p.role = 'customer'
          AND (${search || null}::text IS NULL OR p.full_name ILIKE ${'%' + (search || '') + '%'})
        ORDER BY p.full_name ASC
        LIMIT ${limit} OFFSET ${offset}
      `
      return { customers: data, page, limit }
    }

    case 'get_customer_details': {
      const id = args.customer_id as string
      const [profileRows, vehicles, logs] = await Promise.all([
        sql`SELECT id, full_name, email, phone, created_at FROM profiles WHERE id = ${id}`,
        sql`SELECT * FROM vehicles WHERE customer_id = ${id} AND center_id = ${centerId}`,
        sql`SELECT id, date, service_type, total_cost, status, mileage FROM maintenance_logs WHERE customer_id = ${id} AND center_id = ${centerId} ORDER BY date DESC LIMIT 20`,
      ])
      if (profileRows.length === 0) return { error: 'العميل غير موجود' }
      return { profile: profileRows[0], vehicles, recentLogs: logs }
    }

    case 'create_customer': {
      const { full_name, email, phone } = args as { full_name: string; email: string; phone?: string }
      const bcrypt = await import('bcryptjs')
      const randomPassword = Math.random().toString(36).slice(2, 10) + 'Aa1!'
      const passwordHash = await bcrypt.hash(randomPassword, 10)

      const rows = await sql`
        INSERT INTO profiles (full_name, email, phone, password_hash, role)
        VALUES (${full_name}, ${email}, ${phone ?? null}, ${passwordHash}, 'customer')
        RETURNING id, full_name, email, phone, created_at
      `
      return { success: true, customer: rows[0] }
    }

    case 'update_customer': {
      const { customer_id, full_name, phone, email } = args as { customer_id: string; full_name?: string; phone?: string; email?: string }
      const rows = await sql`
        UPDATE profiles SET
          full_name = COALESCE(${full_name ?? null}, full_name),
          phone = COALESCE(${phone ?? null}, phone),
          email = COALESCE(${email ?? null}, email)
        WHERE id = ${customer_id}
        RETURNING id, full_name, email, phone
      `
      if (rows.length === 0) return { error: 'العميل غير موجود' }
      return { success: true, customer: rows[0] }
    }

    // ── Vehicles ──
    case 'list_vehicles': {
      const search = args.search as string | undefined
      const customer_id = args.customer_id as string | undefined

      const data = await sql`
        SELECT v.*, json_build_object('full_name', p.full_name, 'phone', p.phone) AS customer
        FROM vehicles v
        LEFT JOIN profiles p ON p.id = v.customer_id
        WHERE v.center_id = ${centerId}
          AND (${customer_id || null}::text IS NULL OR v.customer_id = ${customer_id || null})
          AND (${search || null}::text IS NULL OR (
            v.make ILIKE ${'%' + (search || '') + '%'}
            OR v.model ILIKE ${'%' + (search || '') + '%'}
            OR v.plate_number ILIKE ${'%' + (search || '') + '%'}
          ))
        ORDER BY v.created_at DESC
      `
      return { vehicles: data }
    }

    case 'create_vehicle': {
      const { customer_id, make, model, year, color, plate_number } = args as {
        customer_id: string; make: string; model: string; year?: number; color?: string; plate_number?: string
      }
      const rows = await sql`
        INSERT INTO vehicles (customer_id, center_id, make, model, year, color, plate_number)
        VALUES (${customer_id}, ${centerId}, ${make}, ${model}, ${year ?? null}, ${color ?? null}, ${plate_number ?? null})
        RETURNING *
      `
      return { success: true, vehicle: rows[0] }
    }

    case 'update_vehicle': {
      const { vehicle_id, make, model, year, color, plate_number } = args as {
        vehicle_id: string; make?: string; model?: string; year?: number; color?: string; plate_number?: string
      }
      const rows = await sql`
        UPDATE vehicles SET
          make = COALESCE(${make ?? null}, make),
          model = COALESCE(${model ?? null}, model),
          year = COALESCE(${year ?? null}, year),
          color = COALESCE(${color ?? null}, color),
          plate_number = COALESCE(${plate_number ?? null}, plate_number)
        WHERE id = ${vehicle_id} AND center_id = ${centerId}
        RETURNING *
      `
      if (rows.length === 0) return { error: 'السيارة غير موجودة' }
      return { success: true, vehicle: rows[0] }
    }

    case 'delete_vehicle': {
      const { vehicle_id } = args as { vehicle_id: string }
      await sql`DELETE FROM vehicles WHERE id = ${vehicle_id} AND center_id = ${centerId}`
      return { success: true }
    }

    // ── Maintenance ──
    case 'list_maintenance_logs': {
      const { customer_id, vehicle_id, status, page: p, limit: l } = args as {
        customer_id?: string; vehicle_id?: string; status?: string; page?: number; limit?: number
      }
      const page = p || 1
      const limit = l || 20
      const offset = (page - 1) * limit

      const data = await sql`
        SELECT ml.*,
          json_build_object('make', v.make, 'model', v.model, 'plate_number', v.plate_number) AS vehicle,
          json_build_object('full_name', cp.full_name, 'phone', cp.phone) AS customer
        FROM maintenance_logs ml
        LEFT JOIN vehicles v ON v.id = ml.vehicle_id
        LEFT JOIN profiles cp ON cp.id = ml.customer_id
        WHERE ml.center_id = ${centerId}
          AND (${vehicle_id || null}::text IS NULL OR ml.vehicle_id = ${vehicle_id || null}::uuid)
          AND (${customer_id || null}::text IS NULL OR ml.customer_id = ${customer_id || null}::uuid)
          AND (${status || null}::text IS NULL OR ml.status = ${status || null})
        ORDER BY ml.date DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      return { logs: data, page, limit }
    }

    case 'get_maintenance_details': {
      const { log_id } = args as { log_id: string }
      const rows = await sql`
        SELECT ml.*,
          json_build_object('make', v.make, 'model', v.model, 'plate_number', v.plate_number) AS vehicle,
          json_build_object('full_name', cp.full_name, 'phone', cp.phone) AS customer,
          COALESCE(
            (SELECT json_agg(mlp.*) FROM maintenance_log_parts mlp WHERE mlp.log_id = ml.id),
            '[]'::json
          ) AS parts
        FROM maintenance_logs ml
        LEFT JOIN vehicles v ON v.id = ml.vehicle_id
        LEFT JOIN profiles cp ON cp.id = ml.customer_id
        WHERE ml.id = ${log_id}
      `
      if (rows.length === 0) return { error: 'سجل الصيانة غير موجود' }
      return rows[0]
    }

    case 'create_maintenance_log': {
      const { vehicle_id, customer_id, date, service_type, description, notes, total_cost, mileage, status } = args as {
        vehicle_id: string; customer_id: string; date: string; service_type: string
        description?: string; notes?: string; total_cost: number; mileage?: number; status?: string
      }
      const rows = await sql`
        INSERT INTO maintenance_logs (center_id, vehicle_id, customer_id, date, service_type, description, notes, total_cost, mileage, status)
        VALUES (${centerId}, ${vehicle_id}, ${customer_id}, ${date}, ${service_type}, ${description ?? null}, ${notes ?? null}, ${total_cost}, ${mileage ?? null}, ${status || 'completed'})
        RETURNING *
      `
      return { success: true, log: rows[0] }
    }

    case 'update_maintenance_log': {
      const { log_id, status, description, notes, total_cost, mileage } = args as {
        log_id: string; status?: string; description?: string; notes?: string; total_cost?: number; mileage?: number
      }
      const rows = await sql`
        UPDATE maintenance_logs SET
          status = COALESCE(${status ?? null}, status),
          description = COALESCE(${description ?? null}, description),
          notes = COALESCE(${notes ?? null}, notes),
          total_cost = COALESCE(${total_cost ?? null}, total_cost),
          mileage = COALESCE(${mileage ?? null}, mileage)
        WHERE id = ${log_id} AND center_id = ${centerId}
        RETURNING *
      `
      if (rows.length === 0) return { error: 'سجل الصيانة غير موجود' }
      return { success: true, log: rows[0] }
    }

    case 'delete_maintenance_log': {
      const { log_id } = args as { log_id: string }
      await sql`DELETE FROM maintenance_logs WHERE id = ${log_id} AND center_id = ${centerId}`
      return { success: true }
    }

    // ── Inventory ──
    case 'list_spare_parts': {
      const { search, category, page: p, limit: l } = args as {
        search?: string; category?: string; page?: number; limit?: number
      }
      const page = p || 1
      const limit = l || 50
      const offset = (page - 1) * limit

      const data = await sql`
        SELECT * FROM spare_parts
        WHERE center_id = ${centerId}
          AND (${category || null}::text IS NULL OR category = ${category || null})
          AND (${search || null}::text IS NULL OR name ILIKE ${'%' + (search || '') + '%'} OR name_ar ILIKE ${'%' + (search || '') + '%'})
        ORDER BY name ASC
        LIMIT ${limit} OFFSET ${offset}
      `
      return { parts: data, page, limit }
    }

    case 'get_low_stock_parts': {
      const data = await sql`
        SELECT * FROM spare_parts
        WHERE center_id = ${centerId} AND quantity <= low_stock_threshold
        ORDER BY quantity ASC
      `
      return { lowStockParts: data }
    }

    case 'create_spare_part': {
      const { name, name_ar, brand, sku, price, quantity, unit, category, low_stock_threshold } = args as {
        name: string; name_ar?: string; brand?: string; sku?: string; price: number; quantity: number
        unit?: string; category?: string; low_stock_threshold?: number
      }
      const rows = await sql`
        INSERT INTO spare_parts (center_id, name, name_ar, brand, sku, price, quantity, unit, category, low_stock_threshold)
        VALUES (${centerId}, ${name}, ${name_ar ?? null}, ${brand ?? null}, ${sku ?? null}, ${price}, ${quantity}, ${unit || 'piece'}, ${category ?? null}, ${low_stock_threshold ?? 5})
        RETURNING *
      `
      return { success: true, part: rows[0] }
    }

    case 'update_spare_part': {
      const { part_id, name, name_ar, brand, price, quantity, category, low_stock_threshold } = args as {
        part_id: string; name?: string; name_ar?: string; brand?: string; price?: number
        quantity?: number; category?: string; low_stock_threshold?: number
      }
      const rows = await sql`
        UPDATE spare_parts SET
          name = COALESCE(${name ?? null}, name),
          name_ar = COALESCE(${name_ar ?? null}, name_ar),
          brand = COALESCE(${brand ?? null}, brand),
          price = COALESCE(${price ?? null}, price),
          quantity = COALESCE(${quantity ?? null}, quantity),
          category = COALESCE(${category ?? null}, category),
          low_stock_threshold = COALESCE(${low_stock_threshold ?? null}, low_stock_threshold)
        WHERE id = ${part_id} AND center_id = ${centerId}
        RETURNING *
      `
      if (rows.length === 0) return { error: 'قطعة الغيار غير موجودة' }
      return { success: true, part: rows[0] }
    }

    case 'adjust_part_quantity': {
      const { part_id, delta } = args as { part_id: string; delta: number }
      const parts = await sql`SELECT quantity FROM spare_parts WHERE id = ${part_id} AND center_id = ${centerId}`
      if (parts.length === 0) return { error: 'قطعة الغيار غير موجودة' }

      const newQty = parts[0].quantity + delta
      if (newQty < 0) return { error: 'الكمية غير كافية' }

      const rows = await sql`
        UPDATE spare_parts SET quantity = ${newQty} WHERE id = ${part_id} RETURNING *
      `
      return { success: true, part: rows[0] }
    }

    case 'delete_spare_part': {
      const { part_id } = args as { part_id: string }
      await sql`DELETE FROM spare_parts WHERE id = ${part_id} AND center_id = ${centerId}`
      return { success: true }
    }

    // ── Appointments ──
    case 'list_appointments': {
      const { status, date } = args as { status?: string; date?: string }
      const data = await sql`
        SELECT a.*,
          json_build_object('full_name', cp.full_name, 'phone', cp.phone) AS customer,
          json_build_object('make', v.make, 'model', v.model, 'plate_number', v.plate_number) AS vehicle
        FROM appointments a
        LEFT JOIN profiles cp ON cp.id = a.customer_id
        LEFT JOIN vehicles v ON v.id = a.vehicle_id
        WHERE a.center_id = ${centerId}
          AND (${status || null}::text IS NULL OR a.status = ${status || null})
          AND (${date || null}::text IS NULL OR (
            a.requested_at >= (${date || null} || 'T00:00:00')::timestamptz
            AND a.requested_at <= (${date || null} || 'T23:59:59')::timestamptz
          ))
        ORDER BY a.requested_at ASC
      `
      return { appointments: data }
    }

    case 'update_appointment_status': {
      const { appointment_id, status } = args as { appointment_id: string; status: string }
      const rows = await sql`
        UPDATE appointments SET status = ${status}
        WHERE id = ${appointment_id} AND center_id = ${centerId}
        RETURNING *
      `
      if (rows.length === 0) return { error: 'الموعد غير موجود' }
      return { success: true, appointment: rows[0] }
    }

    // ── Search All ──
    case 'search_all': {
      const q = args.query as string
      const pattern = `%${q}%`

      const [customers, vehicles, parts] = await Promise.all([
        sql`SELECT id, full_name, phone, email FROM profiles WHERE role = 'customer' AND (full_name ILIKE ${pattern} OR phone ILIKE ${pattern} OR email ILIKE ${pattern}) LIMIT 10`,
        sql`SELECT v.id, v.make, v.model, v.plate_number, p.full_name AS customer_name FROM vehicles v LEFT JOIN profiles p ON p.id = v.customer_id WHERE v.center_id = ${centerId} AND (v.make ILIKE ${pattern} OR v.model ILIKE ${pattern} OR v.plate_number ILIKE ${pattern}) LIMIT 10`,
        sql`SELECT id, name, name_ar, brand, price, quantity FROM spare_parts WHERE center_id = ${centerId} AND (name ILIKE ${pattern} OR name_ar ILIKE ${pattern} OR brand ILIKE ${pattern}) LIMIT 10`,
      ])

      return { customers, vehicles, parts }
    }

    default:
      return { error: `أداة غير معروفة: ${name}` }
  }
}

// ── System Prompt ───────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت مساعد ذكي لمركز صيانة سيارات اسمه "العمرتي". أنت تساعد صاحب المركز في إدارة المركز بالكامل.

## قدراتك:
- الاطلاع على كل بيانات المركز (عملاء، سيارات، صيانة، مخزون، مواعيد، إحصائيات)
- إضافة وتعديل وحذف أي بيانات
- الإجابة عن أسئلة إحصائية ومالية
- البحث في كل البيانات

## قواعد مهمة:
1. رد دايماً بالعربي (مصري/عامي)
2. لو المستخدم سألك عن حاجة، استخدم الأدوات المتاحة عشان تجيب البيانات الفعلية - متخمنش أبداً
3. لو محتاج تعدل حاجة، اتأكد الأول من البيانات الحالية قبل التعديل
4. لما تعرض أرقام أو فلوس، نسّقها بشكل واضح
5. لو مش متأكد من حاجة، اسأل المستخدم
6. كن ودود ومحترف - أنت مساعد صاحب المركز
7. لو المستخدم طلب حذف أو تعديل كبير، اتأكد منه الأول قبل التنفيذ
8. استخدم الإيموجي باعتدال عشان الرد يكون واضح ومنظم

## أنواع الخدمات:
- oil_change: تغيير زيت
- brake_service: خدمة فرامل
- full_service: صيانة شاملة
- repair: إصلاح
- inspection: فحص
- tyre_change: تغيير إطارات
- other: أخرى

## حالات الصيانة:
- pending: قيد الانتظار
- in_progress: جاري العمل
- completed: مكتملة
- cancelled: ملغية

## حالات المواعيد:
- pending: في الانتظار
- confirmed: مؤكد
- cancelled: ملغي
- completed: مكتمل`

// ── Main Chat Function ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ChatMessage {
  role: 'user' | 'model'
  parts: any[]
}

export async function processChat(
  message: string,
  centerId: string,
  history: ChatMessage[] = []
): Promise<{ reply: string; history: ChatMessage[] }> {

  // Build conversation with history
  const contents = [
    ...history,
    { role: 'user' as const, parts: [{ text: message }] },
  ]

  let currentContents = contents
  let maxIterations = 10 // Prevent infinite loops

  while (maxIterations-- > 0) {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: currentContents,
        tools,
        tool_config: { function_calling_config: { mode: 'AUTO' } },
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Gemini API error:', err)
      throw new Error('فشل الاتصال بالذكاء الاصطناعي')
    }

    const data: any = await response.json()
    const candidate = data.candidates?.[0]

    if (!candidate?.content?.parts) {
      throw new Error('رد غير متوقع من الذكاء الاصطناعي')
    }

    const parts = candidate.content.parts

    // Check if there are function calls
    const functionCalls = parts.filter((p: { functionCall?: unknown }) => p.functionCall)

    if (functionCalls.length === 0) {
      // No function calls - return the text response
      const textPart = parts.find((p: { text?: string }) => p.text)
      const reply = textPart?.text || 'عذراً، مقدرتش أفهم الطلب.'

      const updatedHistory: ChatMessage[] = [
        ...history,
        { role: 'user', parts: [{ text: message }] },
        { role: 'model', parts: [{ text: reply }] },
      ]

      return { reply, history: updatedHistory }
    }

    // Execute all function calls
    const functionResponses = []
    for (const fc of functionCalls) {
      const { name, args } = fc.functionCall
      console.log(`[Chat] Executing tool: ${name}`, args)
      try {
        const result = await executeTool(name, args || {}, centerId)
        functionResponses.push({
          functionResponse: {
            name,
            response: { result },
          },
        })
      } catch (err) {
        console.error(`[Chat] Tool error (${name}):`, err)
        functionResponses.push({
          functionResponse: {
            name,
            response: { error: `فشل تنفيذ الأداة: ${err instanceof Error ? err.message : 'خطأ غير معروف'}` },
          },
        })
      }
    }

    // Add model response and function results to conversation
    currentContents = [
      ...currentContents,
      { role: 'model' as const, parts },
      { role: 'user' as const, parts: functionResponses },
    ]
  }

  return {
    reply: 'عذراً، الطلب معقد شوية. ممكن تبسّطه أو تقسّمه لأجزاء أصغر؟',
    history: [...history, { role: 'user', parts: [{ text: message }] }],
  }
}
