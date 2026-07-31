import db from './db.js';
import { PERMISSIONS } from './schema-extensions.js';

export { PERMISSIONS };

export function listRoles(scope = null) {
  if (scope) {
    return db.prepare('SELECT * FROM roles WHERE scope = ? ORDER BY name').all(scope);
  }
  return db.prepare('SELECT * FROM roles ORDER BY scope, name').all();
}

export function findRoleBySlug(slug) {
  return db.prepare('SELECT * FROM roles WHERE slug = ?').get(slug);
}

export function createRole({ slug, name, scope, permissions }) {
  return db.prepare(`
    INSERT INTO roles (slug, name, scope, permissions, system)
    VALUES (?, ?, ?, ?, 0)
  `).run(slug, name, scope, JSON.stringify(permissions || []));
}

export function updateRole(slug, { name, permissions }) {
  const role = findRoleBySlug(slug);
  if (!role) return null;
  const nextName = name ?? role.name;
  const nextPerms = permissions ?? JSON.parse(role.permissions || '[]');
  db.prepare('UPDATE roles SET name = ?, permissions = ? WHERE slug = ?').run(
    nextName,
    JSON.stringify(nextPerms),
    slug,
  );
  return findRoleBySlug(slug);
}

export function deleteRole(slug) {
  const role = findRoleBySlug(slug);
  if (!role || role.system) return false;
  db.prepare('DELETE FROM roles WHERE slug = ?').run(slug);
  return true;
}

export function publicRole(role) {
  return {
    slug: role.slug,
    name: role.name,
    scope: role.scope,
    permissions: JSON.parse(role.permissions || '[]'),
    system: Boolean(role.system),
    createdAt: role.created_at,
  };
}

export function getUserSystemRoles(userId) {
  return db.prepare(`
    SELECT r.* FROM user_system_roles usr
    JOIN roles r ON r.slug = usr.role_slug
    WHERE usr.user_id = ?
  `).all(userId);
}

export function setUserSystemRoles(userId, roleSlugs = []) {
  db.prepare('DELETE FROM user_system_roles WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO user_system_roles (user_id, role_slug) VALUES (?, ?)');
  for (const slug of roleSlugs) insert.run(userId, slug);
}

export function getUserPermissions(user, { isLegacyAdmin = false } = {}) {
  const perms = new Set();
  if (isLegacyAdmin || user?.is_admin) {
    PERMISSIONS.forEach((p) => perms.add(p));
    return perms;
  }
  const roles = getUserSystemRoles(user.id);
  for (const role of roles) {
    try {
      JSON.parse(role.permissions).forEach((p) => perms.add(p));
    } catch { /* ignore */ }
  }
  return perms;
}

export function getOrgMemberRole(userId, orgId) {
  return db.prepare(`
    SELECT om.*, r.permissions
    FROM organization_members om
    LEFT JOIN roles r ON r.slug = om.role_slug
    WHERE om.org_id = ? AND om.user_id = ? AND om.status = 'active'
  `).get(orgId, userId);
}

export function getOrgPermissions(userId, orgId) {
  const member = getOrgMemberRole(userId, orgId);
  if (!member) return new Set();
  try {
    return new Set(JSON.parse(member.permissions || '[]'));
  } catch {
    return new Set();
  }
}

export function userHasPermission(user, permission, { isLegacyAdmin = false, orgId = null } = {}) {
  const systemPerms = getUserPermissions(user, { isLegacyAdmin });
  if (systemPerms.has(permission) || systemPerms.has('system.admin')) return true;
  if (orgId) {
    const orgPerms = getOrgPermissions(user.id, orgId);
    if (orgPerms.has(permission)) return true;
  }
  return false;
}

export function requirePermission(permission, { orgIdFrom = null } = {}) {
  return (req, res, next) => {
    const isLegacyAdmin = Boolean(req.dbUser?.is_admin);
    const orgId = orgIdFrom ? Number(req.params[orgIdFrom]) : null;
    if (!userHasPermission(req.dbUser, permission, { isLegacyAdmin, orgId })) {
      return res.status(403).json({ error: 'Permiso insuficiente', permission });
    }
    next();
  };
}
