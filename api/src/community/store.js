import db from '../db.js';

export function listAutoApprovalRules() {
  return db.prepare('SELECT * FROM community_auto_rules WHERE active = 1 ORDER BY id').all()
    .map(publicAutoRule);
}

export function publicAutoRule(row) {
  return {
    id: row.id,
    name: row.name,
    authorType: row.author_type,
    targetArea: row.target_area,
    trustedEmailDomain: row.trusted_email_domain,
    autoApprove: Boolean(row.auto_approve),
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

export function publicContribution(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    authorName: row.author_name,
    authorEmail: row.author_email,
    authorType: row.author_type,
    sourceUrl: row.source_url,
    patchContent: row.patch_content,
    targetArea: row.target_area,
    status: row.status,
    reviewNotes: row.review_notes,
    autoApproved: Boolean(row.auto_approved),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function matchesAutoRule(rule, contribution) {
  if (rule.author_type && rule.author_type !== contribution.author_type) return false;
  if (rule.target_area && rule.target_area !== contribution.target_area) return false;
  if (rule.trusted_email_domain) {
    const email = (contribution.author_email || '').toLowerCase();
    const domain = rule.trusted_email_domain.toLowerCase().replace(/^@/, '');
    if (!email.endsWith(`@${domain}`)) return false;
  }
  return true;
}

function evaluateAutoApproval(contribution) {
  const rules = db.prepare('SELECT * FROM community_auto_rules WHERE active = 1 AND auto_approve = 1').all();
  return rules.some((rule) => matchesAutoRule(rule, contribution));
}

export function createContribution(data) {
  const {
    title, description, authorName, authorEmail, authorType,
    sourceUrl, patchContent, targetArea,
  } = data;

  const contribution = {
    title: String(title).trim(),
    description: description ? String(description).trim() : null,
    author_name: String(authorName).trim(),
    author_email: authorEmail ? String(authorEmail).trim() : null,
    author_type: authorType || 'human',
    source_url: sourceUrl ? String(sourceUrl).trim() : null,
    patch_content: patchContent ? String(patchContent).trim() : null,
    target_area: targetArea || 'other',
  };

  const autoApprove = evaluateAutoApproval(contribution);
  const status = autoApprove ? 'approved' : 'pending';
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO community_contributions (
      title, description, author_name, author_email, author_type,
      source_url, patch_content, target_area, status, auto_approved, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contribution.title,
    contribution.description,
    contribution.author_name,
    contribution.author_email,
    contribution.author_type,
    contribution.source_url,
    contribution.patch_content,
    contribution.target_area,
    status,
    autoApprove ? 1 : 0,
    autoApprove ? now : null,
  );

  return findContributionById(result.lastInsertRowid);
}

export function findContributionById(id) {
  return db.prepare('SELECT * FROM community_contributions WHERE id = ?').get(id);
}

export function listContributions({ status, limit = 50, offset = 0, publicOnly = false } = {}) {
  let sql = 'SELECT * FROM community_contributions WHERE 1=1';
  const params = [];
  if (publicOnly) {
    sql += " AND status = 'approved'";
  } else if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params).map(publicContribution);
}

export function reviewContribution(id, { status, reviewNotes, reviewerUserId }) {
  const row = findContributionById(id);
  if (!row) return null;
  if (!['approved', 'rejected'].includes(status)) return null;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE community_contributions
    SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = ?, auto_approved = 0
    WHERE id = ?
  `).run(status, reviewNotes || null, reviewerUserId, now, id);
  return findContributionById(id);
}

export function createAutoRule(data) {
  const result = db.prepare(`
    INSERT INTO community_auto_rules (name, author_type, target_area, trusted_email_domain, auto_approve, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(
    data.name,
    data.authorType || null,
    data.targetArea || null,
    data.trustedEmailDomain || null,
    data.autoApprove ? 1 : 0,
  );
  return db.prepare('SELECT * FROM community_auto_rules WHERE id = ?').get(result.lastInsertRowid);
}

export function deleteAutoRule(id) {
  db.prepare('UPDATE community_auto_rules SET active = 0 WHERE id = ?').run(id);
}

export function getCommunityStats() {
  const pending = db.prepare("SELECT COUNT(*) AS c FROM community_contributions WHERE status = 'pending'").get().c;
  const approved = db.prepare("SELECT COUNT(*) AS c FROM community_contributions WHERE status = 'approved'").get().c;
  const autoApproved = db.prepare('SELECT COUNT(*) AS c FROM community_contributions WHERE auto_approved = 1').get().c;
  return { pending, approved, autoApproved };
}
