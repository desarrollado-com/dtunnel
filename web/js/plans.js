async function fetchPublicPlans() {
  const res = await fetch('/api/plans');
  if (!res.ok) throw new Error('No se pudieron cargar los planes');
  const data = await res.json();
  return (data.plans || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function formatPrice(plan) {
  if (!plan.priceMonthly || plan.priceMonthly <= 0) return 'Gratis';
  const monthly = `$${Number(plan.priceMonthly).toLocaleString('es')}`;
  if (plan.priceYearly > 0) {
    return `${monthly}<small>/mes</small>`;
  }
  return monthly;
}

function formatYearly(plan) {
  if (!plan.priceYearly || plan.priceYearly <= 0) return '—';
  return `$${Number(plan.priceYearly).toLocaleString('es')}/año`;
}

function featureList(plan) {
  const items = [
    `${plan.tunnelLimit} túnel(es) simultáneo(s)`,
    `${plan.reservedSubdomainLimit} subdominio(s) reservable(s)`,
    'HTTP + HTTPS + WebSocket',
    'Trazas HTTP en el panel',
  ];
  if (plan.customSubdomain) items.push('Subdominio fijo reservable');
  if (plan.features?.customCname) {
    items.push(`Dominio CNAME (${plan.features.customCnameLimit || 1})`);
  }
  if (plan.features?.apiAccess) items.push('Acceso API ampliado');
  if (plan.planType === 'enterprise') {
    items.push(`Hasta ${plan.maxSeats} usuarios por organización`);
    items.push('Facturación por organización');
  }
  if (plan.features?.prioritySupport) items.push('Soporte prioritario');
  if (plan.features?.sso) items.push('SSO (próximamente)');
  return items.map((t) => `<li>${t}</li>`).join('');
}

function ctaForPlan(plan) {
  if (plan.planType === 'enterprise') {
    return `<a href="mailto:dtunnel@desarrollado.com?subject=Plan%20${encodeURIComponent(plan.name)}" class="btn btn-outlined">Contactar</a>`;
  }
  if (plan.priceMonthly > 0) {
    return `<a href="/register.html?plan=${plan.slug}&upgrade=1" class="btn btn-primary">Elegir plan</a>`;
  }
  return `<a href="/register.html" class="btn btn-primary">Crear cuenta</a>`;
}

function boolCell(value) {
  return value
    ? '<span class="plans-yes material-symbols-outlined" aria-label="Sí">check_circle</span>'
    : '<span class="plans-no">—</span>';
}

function renderPricingGrid(grid, plans) {
  const anonymousCard = `
    <article class="card">
      <h3>Sin cuenta</h3>
      <p class="price">$0</p>
      <ul>
        <li>URL aleatoria</li>
        <li>1 túnel por IP</li>
        <li>HTTP + HTTPS</li>
        <li>Solo pruebas rápidas</li>
      </ul>
      <p class="text-muted" style="font-size:0.85rem;margin-top:1rem">Ideal para <code>dtunnel --port 3000</code> sin registrarte.</p>
    </article>
  `;

  const planCards = plans.map((plan, i) => `
    <article class="card${plan.slug === 'free' ? ' card-featured' : ''}">
      <h3>${plan.name}</h3>
      <p class="price">${formatPrice(plan)}</p>
      ${plan.description ? `<p class="text-muted" style="font-size:0.9rem;margin-bottom:1rem">${plan.description}</p>` : ''}
      <ul>${featureList(plan)}</ul>
      ${ctaForPlan(plan)}
    </article>
  `).join('');

  grid.innerHTML = anonymousCard + planCards;
  grid.classList.remove('pricing-grid');
  grid.classList.add('grid');
  grid.style.maxWidth = '100%';
}

function renderComparisonTable(container, plans) {
  const rows = [
    { label: 'Precio mensual', render: (p) => `<span class="plan-price">${formatPrice(p).replace(/<[^>]+>/g, '')}</span>` },
    { label: 'Precio anual', render: (p) => formatYearly(p) },
    { label: 'Túneles simultáneos', render: (p) => String(p.tunnelLimit) },
    { label: 'Subdominios reservados', render: (p) => String(p.reservedSubdomainLimit) },
    { label: 'Subdominio fijo', render: (p) => boolCell(p.customSubdomain) },
    { label: 'Dominio CNAME propio', render: (p) => boolCell(p.features?.customCname) },
    { label: 'Límite CNAME', render: (p) => (p.features?.customCname ? String(p.features.customCnameLimit || 1) : '—') },
    { label: 'Usuarios (organización)', render: (p) => (p.planType === 'enterprise' ? String(p.maxSeats) : '1') },
    { label: 'Trazas HTTP en panel', render: () => boolCell(true) },
    { label: 'Soporte prioritario', render: (p) => boolCell(p.features?.prioritySupport) },
    { label: 'Acceso API ampliado', render: (p) => boolCell(p.features?.apiAccess) },
  ];

  container.innerHTML = `
    <table class="plans-comparison">
      <thead>
        <tr>
          <th>Característica</th>
          ${plans.map((p) => `<th><div class="plan-name">${p.name}</div><div class="text-muted" style="font-size:0.8rem">${p.slug}</div></th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.label}</td>
            ${plans.map((p) => `<td>${row.render(p)}</td>`).join('')}
          </tr>
        `).join('')}
        <tr>
          <td></td>
          ${plans.map((p) => `<td>${ctaForPlan(p)}</td>`).join('')}
        </tr>
      </tbody>
    </table>
  `;
}

async function loadPricingGrid() {
  const grid = document.getElementById('pricing-grid');
  if (!grid) return;
  try {
    const plans = await fetchPublicPlans();
    renderPricingGrid(grid, plans);
  } catch {
    grid.innerHTML = '<p class="text-muted">No se pudieron cargar los planes. <a href="/planes.html">Ver página de planes</a> o <a href="/register.html">crear cuenta</a>.</p>';
  }
}

async function loadPlansPage() {
  const cards = document.getElementById('plans-cards');
  const table = document.getElementById('plans-comparison');
  if (!cards && !table) return;
  try {
    const plans = await fetchPublicPlans();
    if (cards) renderPricingGrid(cards, plans);
    if (table) renderComparisonTable(table, plans);
  } catch {
    const msg = '<p class="form-error">No se pudieron cargar los planes. Intenta más tarde o escribe a <a href="mailto:dtunnel@desarrollado.com">dtunnel@desarrollado.com</a>.</p>';
    if (cards) cards.innerHTML = msg;
    if (table) table.innerHTML = msg;
  }
}

loadPricingGrid();
loadPlansPage();
