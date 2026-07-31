const API_BASE = 'https://dtunnel.desarrollado.com/api';

function formatPrice(plan) {
  if (!plan.priceMonthly || plan.priceMonthly <= 0) return 'Gratis';
  const sym = plan.currency === 'COP' ? '$' : '$';
  const monthly = `${sym}${Number(plan.priceMonthly).toLocaleString('es')}`;
  if (plan.priceYearly > 0) {
    return `${monthly}<small>/mes</small>`;
  }
  return monthly;
}

function featureList(plan) {
  const items = [
    `${plan.tunnelLimit} túnel(es) simultáneo(s)`,
    `${plan.reservedSubdomainLimit} subdominio(s) reservable(s)`,
  ];
  if (plan.customSubdomain) items.push('Subdominio personalizado');
  if (plan.features?.customCname) {
    items.push(`Dominio CNAME (${plan.features.customCnameLimit || 1})`);
  }
  if (plan.planType === 'enterprise') {
    items.push(`Hasta ${plan.maxSeats} usuarios`);
    items.push('Facturación por organización');
  }
  if (plan.features?.prioritySupport) items.push('Soporte prioritario');
  return items.map((t) => `<li>${t}</li>`).join('');
}

function ctaForPlan(plan) {
  if (plan.planType === 'enterprise') {
    return `<a href="/register.html?plan=${plan.slug}" class="btn btn-outlined">Crear organización</a>`;
  }
  if (plan.priceMonthly > 0) {
    return `<a href="/register.html?plan=${plan.slug}&upgrade=1" class="btn btn-primary">Elegir plan</a>`;
  }
  return `<a href="/register.html" class="btn btn-primary">Crear cuenta</a>`;
}

async function loadPricing() {
  const grid = document.getElementById('pricing-grid');
  if (!grid) return;

  try {
    const res = await fetch(`${API_BASE}/plans`);
    const data = await res.json();
    const plans = (data.plans || []).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const anonymousCard = `
      <article class="card">
        <h3>Sin cuenta</h3>
        <p class="price">$0</p>
        <ul>
          <li>URL aleatoria</li>
          <li>1 túnel por IP</li>
          <li>HTTP + HTTPS</li>
        </ul>
        <p class="text-muted" style="font-size:0.85rem;margin-top:1rem">Ideal para pruebas rápidas con <code>dtunnel --port 3000</code></p>
      </article>
    `;

    const planCards = plans.map((plan, i) => `
      <article class="card${i === 0 && plan.slug === 'free' ? ' card-featured' : ''}">
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
  } catch {
    grid.innerHTML = '<p class="text-muted">No se pudieron cargar los planes. <a href="/register.html">Crear cuenta</a></p>';
  }
}

loadPricing();
