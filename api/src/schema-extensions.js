/**
 * Extensiones de esquema: organizaciones, RBAC, billing (Wompi-ready), dominios CNAME.
 * Se aplican de forma idempotente al arrancar la API.
 */

export const DEFAULT_PLAN_FEATURES = {
  customSubdomain: true,
  customCname: false,
  customCnameLimit: 0,
  apiAccess: false,
  prioritySupport: false,
  sso: false,
};

export const PERMISSIONS = [
  'system.admin',
  'system.users.read',
  'system.users.write',
  'system.plans.write',
  'system.billing.read',
  'system.billing.write',
  'system.security.read',
  'system.security.write',
  'org.read',
  'org.manage',
  'org.invite',
  'org.billing',
  'tunnel.create',
  'tunnel.delete',
  'subdomain.reserve',
  'subdomain.release',
  'cname.configure',
];

const DEFAULT_ROLES = [
  {
    slug: 'superadmin',
    name: 'Superadministrador',
    scope: 'system',
    permissions: PERMISSIONS,
    system: 1,
  },
  {
    slug: 'support',
    name: 'Soporte',
    scope: 'system',
    permissions: ['system.users.read', 'system.billing.read', 'system.security.read', 'org.read'],
    system: 1,
  },
  {
    slug: 'org_owner',
    name: 'Propietario',
    scope: 'organization',
    permissions: ['org.read', 'org.manage', 'org.invite', 'org.billing', 'tunnel.create', 'tunnel.delete', 'subdomain.reserve', 'subdomain.release', 'cname.configure'],
    system: 1,
  },
  {
    slug: 'org_admin',
    name: 'Administrador',
    scope: 'organization',
    permissions: ['org.read', 'org.manage', 'org.invite', 'tunnel.create', 'tunnel.delete', 'subdomain.reserve', 'subdomain.release', 'cname.configure'],
    system: 1,
  },
  {
    slug: 'org_member',
    name: 'Miembro',
    scope: 'organization',
    permissions: ['org.read', 'tunnel.create', 'tunnel.delete', 'subdomain.reserve'],
    system: 1,
  },
  {
    slug: 'org_billing',
    name: 'Facturación',
    scope: 'organization',
    permissions: ['org.read', 'org.billing'],
    system: 1,
  },
];

export function parsePlanFeatures(raw) {
  if (!raw) return { ...DEFAULT_PLAN_FEATURES };
  try {
    return { ...DEFAULT_PLAN_FEATURES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PLAN_FEATURES };
  }
}

export function stringifyPlanFeatures(features) {
  return JSON.stringify({ ...DEFAULT_PLAN_FEATURES, ...features });
}

function migrateColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function applySchemaExtensions(db) {
  migrateColumn(db, 'plans', 'plan_type', "TEXT NOT NULL DEFAULT 'personal'");
  migrateColumn(db, 'plans', 'visibility', "TEXT NOT NULL DEFAULT 'public'");
  migrateColumn(db, 'plans', 'max_seats', 'INTEGER NOT NULL DEFAULT 1');
  migrateColumn(db, 'plans', 'features', 'TEXT');
  migrateColumn(db, 'plans', 'wompi_product_id', 'TEXT');
  migrateColumn(db, 'users', 'primary_org_id', 'INTEGER');
  migrateColumn(db, 'users', 'totp_secret', 'TEXT');
  migrateColumn(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  migrateColumn(db, 'users', 'totp_backup_hashes', 'TEXT');
  migrateColumn(db, 'users', 'totp_pending_secret', 'TEXT');
  migrateColumn(db, 'active_tunnels', 'user_agent', 'TEXT');
  migrateColumn(db, 'active_tunnels', 'client_version', 'TEXT');
  migrateColumn(db, 'active_tunnels', 'fingerprint_hash', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      permissions TEXT NOT NULL,
      system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_system_roles (
      user_id INTEGER NOT NULL,
      role_slug TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role_slug),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      billing_email TEXT,
      seat_limit INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL,
      user_id INTEGER,
      role_slug TEXT NOT NULL DEFAULT 'org_member',
      invited_email TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (org_id) REFERENCES organizations(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_type TEXT NOT NULL,
      subscriber_id INTEGER NOT NULL,
      plan_slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      coupon_code TEXT,
      amount_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'COP',
      wompi_transaction_id TEXT,
      wompi_reference TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'COP',
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT NOT NULL DEFAULT 'wompi',
      provider_ref TEXT,
      provider_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      currency TEXT,
      plan_slugs TEXT,
      max_uses INTEGER,
      uses_count INTEGER NOT NULL DEFAULT 0,
      valid_from TEXT,
      valid_until TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS custom_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_type TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      hostname TEXT NOT NULL UNIQUE,
      subdomain_name TEXT NOT NULL,
      cname_target TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      ssl_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON subscriptions(subscriber_type, subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_custom_domains_owner ON custom_domains(owner_type, owner_id);

    CREATE TABLE IF NOT EXISTS plan_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_slug TEXT NOT NULL,
      granted_by INTEGER,
      note TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, plan_slug)
    );

    CREATE INDEX IF NOT EXISTS idx_plan_grants_user ON plan_grants(user_id);

    CREATE TABLE IF NOT EXISTS ip_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      reason TEXT NOT NULL,
      remediation TEXT,
      scope TEXT NOT NULL DEFAULT 'all',
      source TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER,
      expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ip, scope)
    );

    CREATE TABLE IF NOT EXISTS ip_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      label TEXT,
      bypass_rate_limit INTEGER NOT NULL DEFAULT 1,
      bypass_anon_limit INTEGER NOT NULL DEFAULT 0,
      bypass_blacklist INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS abuse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      ip TEXT,
      user_id INTEGER,
      subdomain TEXT,
      fingerprint_hash TEXT,
      user_agent TEXT,
      details TEXT,
      action_taken TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS device_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint_hash TEXT NOT NULL,
      user_id INTEGER,
      client_ip TEXT,
      user_agent TEXT,
      client_version TEXT,
      client_id TEXT,
      tunnel_count INTEGER NOT NULL DEFAULT 0,
      abuse_count INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ip_blacklist_ip ON ip_blacklist(ip) WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_abuse_events_ip ON abuse_events(ip, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_abuse_events_severity ON abuse_events(severity, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_device_fp_hash ON device_fingerprints(fingerprint_hash);

    CREATE TABLE IF NOT EXISTS sla_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_slug TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      first_response_hours INTEGER NOT NULL DEFAULT 72,
      resolution_hours INTEGER,
      business_hours_only INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      sla_policy_id INTEGER,
      first_response_at TEXT,
      resolved_at TEXT,
      due_first_response_at TEXT,
      due_resolution_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      author_user_id INTEGER,
      author_name TEXT,
      body TEXT NOT NULL,
      is_staff INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
    );

    CREATE TABLE IF NOT EXISTS community_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      author_name TEXT NOT NULL,
      author_email TEXT,
      author_type TEXT NOT NULL DEFAULT 'human',
      source_url TEXT,
      patch_content TEXT,
      target_area TEXT NOT NULL DEFAULT 'other',
      status TEXT NOT NULL DEFAULT 'pending',
      review_notes TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      auto_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS community_auto_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      author_type TEXT,
      target_area TEXT,
      trusted_email_domain TEXT,
      auto_approve INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contributions_status ON community_contributions(status, created_at DESC);
  `);

  seedRoles(db);
  seedSlaPolicies(db);
  seedCommunityAutoRules(db);
  seedExtendedPlans(db);
}

function seedSlaPolicies(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sla_policies (plan_slug, name, description, first_response_hours, resolution_hours, business_hours_only)
    VALUES (@plan_slug, @name, @description, @first_response_hours, @resolution_hours, @business_hours_only)
  `);
  const policies = [
    {
      plan_slug: null,
      name: 'Estándar',
      description: 'ANS por defecto para planes sin política específica',
      first_response_hours: 72,
      resolution_hours: 168,
      business_hours_only: 1,
    },
    {
      plan_slug: 'free',
      name: 'Gratis',
      description: 'Soporte comunitario — mejor esfuerzo',
      first_response_hours: 72,
      resolution_hours: null,
      business_hours_only: 1,
    },
    {
      plan_slug: 'pro',
      name: 'Pro',
      description: 'Soporte prioritario',
      first_response_hours: 24,
      resolution_hours: 120,
      business_hours_only: 1,
    },
    {
      plan_slug: 'team',
      name: 'Equipo',
      description: 'Soporte empresarial',
      first_response_hours: 4,
      resolution_hours: 48,
      business_hours_only: 1,
    },
  ];
  for (const p of policies) insert.run(p);
}

function seedCommunityAutoRules(db) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM community_auto_rules').get().c;
  if (count > 0) return;
  const insert = db.prepare(`
    INSERT INTO community_auto_rules (name, author_type, target_area, trusted_email_domain, auto_approve, active)
    VALUES (@name, @author_type, @target_area, @trusted_email_domain, @auto_approve, 1)
  `);
  insert.run({
    name: 'Docs de IA confiables',
    author_type: 'ai',
    target_area: 'docs',
    trusted_email_domain: 'desarrollado.com',
    auto_approve: 1,
  });
  insert.run({
    name: 'Parches menores web (revisión manual)',
    author_type: 'ai',
    target_area: 'web',
    trusted_email_domain: null,
    auto_approve: 0,
  });
}

function seedRoles(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO roles (slug, name, scope, permissions, system)
    VALUES (@slug, @name, @scope, @permissions, @system)
  `);
  for (const role of DEFAULT_ROLES) {
    insert.run({
      ...role,
      permissions: JSON.stringify(role.permissions),
    });
  }
}

function seedExtendedPlans(db) {
  const updates = [
    {
      slug: 'free',
      plan_type: 'personal',
      visibility: 'public',
      max_seats: 1,
      features: stringifyPlanFeatures({ customSubdomain: true, customCname: false, customCnameLimit: 0 }),
    },
    {
      slug: 'pro',
      plan_type: 'personal',
      visibility: 'public',
      max_seats: 1,
      features: stringifyPlanFeatures({ customSubdomain: true, customCname: true, customCnameLimit: 1, prioritySupport: true }),
    },
    {
      slug: 'team',
      name: 'Equipo',
      description: 'Plan empresarial: varios usuarios bajo una organización',
      price_monthly: 49.99,
      price_yearly: 499,
      currency: 'USD',
      tunnel_limit: 50,
      reserved_subdomain_limit: 50,
      custom_subdomain: 1,
      plan_type: 'enterprise',
      visibility: 'public',
      max_seats: 25,
      sort_order: 2,
      features: stringifyPlanFeatures({
        customSubdomain: true,
        customCname: true,
        customCnameLimit: 10,
        apiAccess: true,
        prioritySupport: true,
        sso: false,
      }),
    },
    {
      slug: 'partner',
      name: 'Partner',
      description: 'Plan privado — solo con invitación o asignación admin',
      price_monthly: 29.99,
      price_yearly: 299,
      currency: 'USD',
      tunnel_limit: 20,
      reserved_subdomain_limit: 20,
      custom_subdomain: 1,
      plan_type: 'personal',
      visibility: 'private',
      max_seats: 1,
      sort_order: 10,
      features: stringifyPlanFeatures({
        customSubdomain: true,
        customCname: true,
        customCnameLimit: 3,
        apiAccess: true,
        prioritySupport: true,
      }),
    },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO plans (
      slug, name, description, price_monthly, price_yearly, currency,
      tunnel_limit, reserved_subdomain_limit, custom_subdomain, sort_order, active,
      plan_type, visibility, max_seats, features
    ) VALUES (
      @slug, @name, @description, @price_monthly, @price_yearly, @currency,
      @tunnel_limit, @reserved_subdomain_limit, @custom_subdomain, @sort_order, 1,
      @plan_type, @visibility, @max_seats, @features
    )
  `);

  const patch = db.prepare(`
    UPDATE plans SET
      plan_type = COALESCE(@plan_type, plan_type),
      visibility = COALESCE(@visibility, visibility),
      max_seats = COALESCE(@max_seats, max_seats),
      features = COALESCE(@features, features)
    WHERE slug = @slug
  `);

  for (const plan of updates) {
    insert.run({
      name: plan.name || plan.slug,
      description: plan.description || '',
      price_monthly: plan.price_monthly ?? 0,
      price_yearly: plan.price_yearly ?? null,
      currency: plan.currency || 'USD',
      tunnel_limit: plan.tunnel_limit ?? 5,
      reserved_subdomain_limit: plan.reserved_subdomain_limit ?? 5,
      custom_subdomain: plan.custom_subdomain ?? 1,
      sort_order: plan.sort_order ?? 0,
      ...plan,
    });
    patch.run(plan);
  }
}
