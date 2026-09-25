// Offerte Agenti — Dynamic Google Sheets & API Integration
let AGENTS = [];
let agentById = {};
let hierarchy = {};
let products = [], clients = [], dataMeta = {}, items = [], catalogLimit = 80;
let companyProfile = {
  companyName: '',
  displayName: '',
  vatNumber: '',
  taxCode: '',
  address: '',
  postalCode: '',
  city: '',
  province: '',
  country: 'Italia',
  email: '',
  pec: '',
  phone: '',
  website: '',
  sdiCode: '',
  iban: '',
  logoFileName: '',
  footerText: '',
  legalNotes: '',
  currency: 'EUR',
  defaultVat: 22,
  offerValidityDays: 30,
  ordersEmail: ''
};

let documentType = new URLSearchParams(location.search).get('type') === 'order' ? 'order' : 'offer';
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = value => String(value ?? '').trim();
const normalized = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const toNumber = value => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const decimal = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const n = Number(decimal);
  return Number.isFinite(n) ? n : 0;
};
const effectiveDiscount = ds => 100 * (1 - ds.reduce((m, d) => m * (1 - (Number(d) || 0) / 100), 1));
const lineNet = item => item.product.price * item.qty * item.discounts.reduce((m, d) => m * (1 - d / 100), 1) * (1 + item.markup / 100);
const discountLabel = item => [...item.discounts.map(d => `${num.format(d)}%`), item.markup ? `+${num.format(item.markup)}% ric.` : null].filter(Boolean).join(' + ');

const currentRole = () => $('roleSelect')?.value || (AGENTS[0]?.id || 'AG01');
const currentAgentId = () => currentRole().replace('AREA_', '');
const currentAgent = () => agentById[currentAgentId()] || AGENTS[0] || { id: 'AG01', name: 'Agente', role: 'Agente', discountLimit: 40 };
const maxAllowedDiscount = (product) => {
  const agLimit = currentAgent()?.discountLimit != null ? Number(currentAgent().discountLimit) : 40;
  const prodLimit = product.maxDiscount != null ? Number(product.maxDiscount) : 100;
  return Math.min(prodLimit, agLimit > 0 ? agLimit : 100);
};

const nowLabel = iso => iso ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';

// IndexedDB Local Storage for Offline-First Capability
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('offerte-agenti', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('data').objectStore('data').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite');
    tx.objectStore('data').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Dynamic Loading from /api/company, /api/agents, /api/customers, /api/products
async function loadData() {
  // Step 1: Load from local cache immediately for instantaneous startup
  const [cachedData, cachedComp, cachedAg] = await Promise.all([
    dbGet('dataset').catch(() => null),
    dbGet('company-profile').catch(() => null),
    dbGet('agents-data').catch(() => null)
  ]);

  if (cachedData) {
    const isOldTestArticles = (cachedData.articles || []).length < 50;
    if (!isOldTestArticles) {
      products = cachedData.articles || [];
      clients = cachedData.clients || [];
      dataMeta = cachedData.meta || {};
    }
  }
  if (cachedComp) companyProfile = { ...companyProfile, ...cachedComp };
  if (cachedAg) {
    const hasOldTestAgent = (cachedAg.agents || []).some(a => a.name && (a.name.includes('Micozzi') || a.name.includes('Pontrelli')));
    if (!hasOldTestAgent) {
      AGENTS = cachedAg.agents || [];
      agentById = Object.fromEntries(AGENTS.map(a => [a.id, a]));
      hierarchy = cachedAg.hierarchy || hierarchy;
    }
  }

  // Step 2: If online, fetch live data from server endpoints
  // Pass spreadsheet IDs directly as query params (Netlify Functions are stateless!)
  if (navigator.onLine) {
    try {
      if (window.companyConfigPromise) {
        try { await window.companyConfigPromise; } catch {}
      }
      const cfg = window.companyConfig || {};
      const qs = (id, tab) => {
        const params = new URLSearchParams();
        if (id) params.set('id', id);
        if (tab) params.set('tab', tab);
        const str = params.toString();
        return str ? '?' + str : '';
      };

      const [compRes, agRes, custRes, prodRes] = await Promise.all([
        fetch(`/api/company${qs(cfg.company?.spreadsheetId, cfg.company?.tab)}`, { headers: { accept: 'application/json' }, cache: 'no-store' }),
        fetch(`/api/agents${qs(cfg.agents?.spreadsheetId, cfg.agents?.tab)}`, { headers: { accept: 'application/json' }, cache: 'no-store' }),
        fetch(`/api/customers${qs(cfg.customers?.spreadsheetId, cfg.customers?.tab)}`, { headers: { accept: 'application/json' }, cache: 'no-store' }),
        fetch(`/api/products${qs(cfg.products?.spreadsheetId, cfg.products?.tab)}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
      ]);

      if (compRes.ok) {
        const d = await compRes.json();
        if (d.company && Object.keys(d.company).length > 0) {
          companyProfile = { ...companyProfile, ...d.company };
          await dbSet('company-profile', companyProfile).catch(() => {});
        }
      }

      if (agRes.ok) {
        const d = await agRes.json();
        if (d.ok !== false && d.agents && d.agents.length > 0) {
          AGENTS = d.agents;
          agentById = Object.fromEntries(AGENTS.map(a => [a.id, a]));
          hierarchy = d.hierarchy || hierarchy;
          await dbSet('agents-data', { agents: AGENTS, hierarchy }).catch(() => {});
        }
      }

      if (custRes.ok) {
        const d = await custRes.json();
        if (d.ok !== false && d.customers && d.customers.length > 0) {
          clients = d.customers;
        }
      }

      if (prodRes.ok) {
        const d = await prodRes.json();
        if (d.ok !== false && d.products && d.products.length > 0) {
          products = d.products;
        }
      }

      dataMeta = {
        generatedAt: new Date().toISOString(),
        source: 'Google Sheets Live API',
        articleCount: products.length,
        clientCount: clients.length,
        agentCount: AGENTS.length
      };

      await dbSet('dataset', { meta: dataMeta, articles: products, clients }).catch(() => {});
    } catch (err) {
      console.warn('Connessione API non riuscita, uso la cache locale:', err);
    }
  }

  // Step 3: Fallback to seed-data if cache was completely empty
  if (!products.length || !clients.length || !AGENTS.length) {
    try {
      const res = await fetch('/seed-data.json');
      if (res.ok) {
        const seed = await res.json();
        if (!products.length) products = seed.articles || [];
        if (!clients.length) clients = seed.clients || [];
        if (!AGENTS.length && seed.agents) {
          AGENTS = seed.agents;
          hierarchy = seed.hierarchy || hierarchy;
        }
        if (seed.company && !companyProfile.companyName) {
          companyProfile = { ...companyProfile, ...seed.company };
        }
        dataMeta = seed.meta || dataMeta;
      }
    } catch (e) {}
  }

  // Final indexing
  agentById = Object.fromEntries(AGENTS.map(a => [a.id, a]));
}

async function loadCompanyProfile() {
  await loadData();
  renderCompanyProfile();
}

function companyAddressLine() {
  return [companyProfile.address, [companyProfile.postalCode, companyProfile.city, companyProfile.province].filter(Boolean).join(' ')].filter(Boolean).join(' - ');
}

function companyContactLine() {
  return [
    [companyProfile.phone && `Tel. ${companyProfile.phone}`, companyProfile.vatNumber && `P. IVA ${String(companyProfile.vatNumber).replace(/^"|"$/g, '')}`].filter(Boolean).join(' · '),
    companyProfile.email
  ].filter(Boolean).join(' · ');
}

function renderCompanyProfile() {
  $('companyName').textContent = companyProfile.companyName || companyProfile.displayName || 'Azienda';
  $('companyAddress').textContent = companyAddressLine() || 'Indirizzo aziendale da completare nel foglio';
  $('companyContacts').textContent = companyContactLine();
  const validity = `${Number(companyProfile.offerValidityDays) || 30} giorni`;
  if ([...$('validity').options].some(o => o.value === validity)) $('validity').value = validity;
}

function roleOptions() {
  const current = localStorage.getItem('offer-role') || (AGENTS[0]?.id || 'AG01');
  const heads = AGENTS.filter(a => a.head || (hierarchy[a.id] && hierarchy[a.id].length > 0));

  let html = '<option value="ADMIN">Amministrazione · tutti i clienti</option>';
  heads.forEach(h => {
    html += `<option value="AREA_${h.id}">Capo area · ${esc(h.name)}</option>`;
  });
  html += AGENTS.map(a => `<option value="${a.id}">${a.id.replace('AG', 'Agente ')} · ${esc(a.name)}</option>`).join('');

  $('roleSelect').innerHTML = html;
  if ([...$('roleSelect').options].some(o => o.value === current)) {
    $('roleSelect').value = current;
  } else if (AGENTS[0]) {
    $('roleSelect').value = AGENTS[0].id;
  }

  $('assignedAgent').innerHTML = AGENTS.map(a => `<option value="${a.id}">${a.id.replace('AG', 'Agente ')} · ${esc(a.name)}</option>`).join('');
}

function visibleAgentIds() {
  const role = currentRole();
  if (role === 'ADMIN') return null;
  if (role.startsWith('AREA_')) {
    const id = currentAgentId();
    return new Set([id, ...(hierarchy[id] || [])]);
  }
  return new Set([role]);
}

function visibleClients() {
  const allowed = visibleAgentIds();
  return allowed ? clients.filter(c => allowed.has(c.agentId)) : clients;
}

function findClient(id) {
  return clients.find(c => String(c.id) === String(id));
}

function customerData() {
  return findClient($('customerSelect').value) || { name: '', city: '', address: '', province: '', postalCode: '', id: '' };
}

function renderCustomers(preferred = '') {
  const current = preferred || $('customerSelect').value, role = currentRole(), visible = visibleClients();
  $('customerSelect').innerHTML = '<option value="">Seleziona un cliente…</option>' + visible.map(c => `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.city)}${role === 'ADMIN' && c.agentId !== 'UNASSIGNED' ? ` · ${esc(agentById[c.agentId]?.name || c.sourceAgent)}` : ''}${role === 'ADMIN' && c.agentId === 'UNASSIGNED' ? ' · non assegnato' : ''}</option>`).join('');
  if ([...$('customerSelect').options].some(o => o.value === String(current))) $('customerSelect').value = String(current);
  const agentRole = role.startsWith('AG');
  $('assignedAgent').disabled = agentRole;
  if (agentRole) $('assignedAgent').value = role;
  showCustomer();
}

function showCustomer() {
  const c = customerData();
  if (!c.name) {
    $('customerDetails').classList.add('hidden');
    return;
  }
  $('customerDetails').innerHTML = `<strong>${esc(c.name)}</strong><span>${esc([c.address, [c.postalCode, c.city, c.province].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</span><span>${esc([c.phone, c.mobile, c.email].filter(Boolean).join(' · ') || 'Contatti non disponibili')}</span>`;
  $('customerDetails').classList.remove('hidden');
  persistOffer();
}

function unique(field, source = products) {
  return [...new Set(source.map(p => clean(p[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it', { numeric: true }));
}

function fillSelect(id, label, values) {
  const old = $(id).value;
  $(id).innerHTML = `<option value="">${label}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (values.includes(old)) $(id).value = old;
}

function updateFilters(changed = '') {
  if (!changed) fillSelect('sectorFilter', 'Tutti i settori', unique('sector'));
  const sector = $('sectorFilter').value, bySector = sector ? products.filter(p => p.sector === sector) : products;
  fillSelect('macroFilter', 'Tutte le macrofamiglie', unique('macroFamily', bySector));
  const macro = $('macroFilter').value, byMacro = bySector.filter(p => !macro || p.macroFamily === macro);
  fillSelect('familyFilter', 'Tutte le famiglie', unique('family', byMacro));
  const family = $('familyFilter').value, byFamily = byMacro.filter(p => !family || p.family === family);
  fillSelect('brandFilter', 'Tutte le marche', unique('brand', byFamily));
}

function catalogMatches() {
  const f = { sector: $('sectorFilter').value, macroFamily: $('macroFilter').value, family: $('familyFilter').value, brand: $('brandFilter').value };
  return products.filter(p => Object.entries(f).every(([k, v]) => !v || p[k] === v));
}

function renderCatalog() {
  const matches = catalogMatches(), shown = matches.slice(0, catalogLimit);
  $('catalogGrid').innerHTML = shown.map(p => {
    let photoHtml;
    if (p.imageUrl && (p.imageUrl.startsWith('http://') || p.imageUrl.startsWith('https://'))) {
      photoHtml = `<img src="${esc(p.imageUrl)}" alt="${esc(p.description)}" loading="lazy" onerror="this.parentElement.innerHTML='<small>FOTO NON DISPONIBILE</small>'">`;
    } else if (p.imageRef) {
      photoHtml = `<small>${esc(p.imageRef.split('\\').pop())}</small>`;
    } else {
      photoHtml = '<small>FOTO NON DISPONIBILE</small>';
    }
    return `<button type="button" class="catalog-card" data-catalog-code="${esc(p.code)}"><div class="product-photo">${photoHtml}</div><div class="catalog-info"><strong>${esc(p.code)}</strong><span>${esc(p.description)}</span><small>${esc([p.brand, p.macroFamily, p.family].filter(Boolean).join(' · '))}</small><b>${euro.format(p.price)}</b></div></button>`;
  }).join('') || '<div class="empty-state">Nessun articolo con questi filtri</div>';
  $('loadMoreCatalog').classList.toggle('hidden', shown.length >= matches.length);
  $('loadMoreCatalog').textContent = `Mostra altri (${matches.length - shown.length})`;
  document.querySelectorAll('[data-catalog-code]').forEach(b => b.onclick = () => {
    addProduct(b.dataset.catalogCode);
    toast('Articolo aggiunto all’offerta');
  });
}

function renderProducts(query = '') {
  const q = normalized(query);
  const found = (q ? products.filter(p => normalized([p.code, p.description, p.brand, p.group, p.sector, p.macroFamily, p.family].join(' ')).includes(q)) : products).slice(0, 60);
  $('productResults').innerHTML = found.map(p => `<button class="product-result" data-code="${esc(p.code)}"><span><strong>${esc(p.description)}</strong><small>${esc(p.code)} · ${esc([p.brand, p.macroFamily, p.family].filter(Boolean).join(' · '))} · disp. ${num.format(p.stock)}</small></span><span class="result-price">${euro.format(p.price)}</span></button>`).join('') || '<div class="empty-state">Nessun articolo trovato</div>';
  $('productResults').classList.remove('hidden');
  document.querySelectorAll('.product-result').forEach(b => b.onclick = () => addProduct(b.dataset.code));
}

function addProduct(code) {
  const product = products.find(p => p.code === code);
  if (!product) return;
  items.push({ id: crypto.randomUUID(), product, qty: 1, discounts: [0, 0, 0, 0], markup: 0 });
  $('productSearch').value = '';
  $('productResults').classList.add('hidden');
  renderOffer();
}

function totals() {
  const list = items.reduce((s, i) => s + i.product.price * i.qty, 0);
  const net = items.reduce((s, i) => s + lineNet(i), 0);
  const vat = items.reduce((s, i) => s + lineNet(i) * (i.product.vat || 22) / 100, 0);
  return { list, net, vat, grand: net + vat };
}

function renderOffer() {
  $('emptyState').classList.toggle('hidden', items.length > 0);
  $('itemCount').textContent = `${items.length} ${items.length === 1 ? 'articolo' : 'articoli'}`;

  $('itemsList').innerHTML = items.map(it => {
    const eff = effectiveDiscount(it.discounts);
    const maxLimit = maxAllowedDiscount(it.product);
    const valid = eff <= maxLimit + 0.0001;

    return `<tr class="${valid ? '' : 'invalid-row'}"><td class="product-cell"><strong title="${esc(it.product.description)}">${esc(it.product.code)} · ${esc(it.product.description)}</strong><small>${esc([it.product.brand, it.product.macroFamily, it.product.family].filter(Boolean).join(' · '))} · Disp. ${num.format(it.product.stock)} · Max sc. ${maxLimit}% · IVA ${it.product.vat || 22}%</small></td><td><input aria-label="Quantità" type="number" min="0.01" step="0.01" value="${it.qty}" data-id="${it.id}" data-field="qty"></td><td><input aria-label="Listino" class="readonly" value="${num.format(it.product.price)}" readonly></td>${it.discounts.map((d, n) => `<td><input aria-label="Sconto ${n + 1}" type="number" min="0" max="100" step="0.1" value="${d}" data-id="${it.id}" data-discount="${n}"></td>`).join('')}<td><input aria-label="Ricarico" type="number" min="0" max="100" step="0.1" value="${it.markup}" data-id="${it.id}" data-field="markup"></td><td class="net-cell">${euro.format(lineNet(it))}<small class="${valid ? '' : 'bad'}">eq. ${num.format(eff)}%${valid ? '' : ' !'}</small></td><td><button class="compact-remove" data-remove="${it.id}" aria-label="Rimuovi">×</button></td></tr>`;
  }).join('');

  document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    items = items.filter(i => i.id !== b.dataset.remove);
    renderOffer();
  });
  document.querySelectorAll('[data-field]').forEach(inp => inp.onchange = () => {
    const it = items.find(i => i.id === inp.dataset.id);
    if (it) it[inp.dataset.field] = Math.max(0, Number(inp.value) || 0);
    renderOffer();
  });
  document.querySelectorAll('[data-discount]').forEach(inp => inp.onchange = () => {
    const it = items.find(i => i.id === inp.dataset.id);
    if (it) it.discounts[Number(inp.dataset.discount)] = Math.min(100, Math.max(0, Number(inp.value) || 0));
    renderOffer();
  });
  updateTotals();
  persistOffer();
}

function updateTotals() {
  const t = totals();
  const invalid = items.some(i => effectiveDiscount(i.discounts) > maxAllowedDiscount(i.product) + 0.0001);
  $('listTotal').textContent = euro.format(t.list);
  $('discountTotal').textContent = (t.net - t.list > 0 ? '+ ' : '') + euro.format(t.net - t.list);
  $('netTotal').textContent = euro.format(t.net);
  $('vatTotal').textContent = euro.format(t.vat);
  $('grandTotal').textContent = euro.format(t.grand);
  const v = $('validationStatus');
  v.className = 'validation ' + (invalid ? 'bad' : items.length ? 'ok' : 'neutral');
  v.textContent = invalid ? 'Correggere gli sconti fuori dal limite autorizzato' : items.length ? 'Offerta pronta per invio, PDF ed Excel' : 'Inserisci almeno un articolo';
}

function persistOffer() {
  localStorage.setItem('offer-demo', JSON.stringify({
    items,
    customer: $('customerSelect').value,
    notes: $('notes').value,
    validity: $('validity').value,
    payment: $('payment').value,
    shipping: $('shipping').value,
    role: currentRole()
  }));
}

function restoreOffer() {
  try {
    const d = JSON.parse(localStorage.getItem('offer-demo'));
    if (!d) return;
    items = d.items || [];
    if (d.role && [...$('roleSelect').options].some(o => o.value === d.role)) $('roleSelect').value = d.role;
    $('notes').value = d.notes || '';
    $('validity').value = d.validity || '30 giorni';
    if (d.payment) $('payment').value = d.payment;
    if (d.shipping) $('shipping').value = d.shipping;
    renderCustomers(d.customer || '');
  } catch {}
}

function updateRoleView() {
  const role = currentRole(), agent = currentAgent();
  localStorage.setItem('offer-role', role);
  $('agentIdentity').textContent = role === 'ADMIN' ? 'Amministrazione' : role.startsWith('AREA_') ? `Capo area · ${agent.name}` : `${agent.id.replace('AG', 'Agente ')} · ${agent.name}`;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', role !== 'ADMIN'));
  renderCustomers();
  persistOffer();
  $('offerCode').textContent = offerNumber();
}

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

function canExport() {
  if (!items.length) {
    toast('Inserisci almeno un articolo');
    return false;
  }
  if (items.some(i => effectiveDiscount(i.discounts) > maxAllowedDiscount(i.product) + 0.0001)) {
    toast('Correggi gli sconti che superano il limite autorizzato');
    return false;
  }
  return true;
}

function offerNumber() {
  const role = currentAgentId();
  const storage = documentType === 'order' ? 'order-numbers' : 'offer-numbers';
  const saved = JSON.parse(localStorage.getItem(storage) || '{}');
  if (!saved[role]) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    saved[role] = `${documentType === 'order' ? 'ORD' : 'OFF'}-${role}-${stamp}`;
    localStorage.setItem(storage, JSON.stringify(saved));
  }
  return saved[role];
}

function buildPrintOffer() {
  const c = customerData(), t = totals(), agent = currentAgent(), label = documentType === 'order' ? 'ORDINE CLIENTE' : 'OFFERTA CLIENTE';
  $('printOffer').innerHTML = `<div class="print-sheet"><div class="print-parties"><div class="print-party"><label>AGENTE / AZIENDA</label><strong>${esc(companyProfile.companyName || companyProfile.displayName)}</strong><br>${esc(companyAddressLine())}<br>${esc(companyContactLine())}<br>${esc(agent.name)}</div><div class="print-party"><label>SPETT.LE CLIENTE</label><strong>${esc(c.name || 'Cliente da selezionare')}</strong><br>${esc([c.address, c.postalCode, c.city, c.province].filter(Boolean).join(' · '))}<br>${esc([c.phone, c.email].filter(Boolean).join(' · '))}</div></div><div class="print-title-row"><h1>${label}</h1><strong>${offerNumber()}</strong></div><table class="print-commerce"><tr><td><span>Data</span>${new Date().toLocaleDateString('it-IT')}</td><td><span>Pagamento</span>${esc($('payment').value)}</td><td><span>Spedizione</span>${esc($('shipping').value)}</td><td><span>Validità</span>${esc($('validity').value)}</td></tr></table><table class="print-lines"><thead><tr><th class="code">Codice</th><th class="desc">Descrizione</th><th class="qty num">Q.tà</th><th class="price num">Listino</th><th class="discounts">Sconti / ricarico</th><th class="total num">Totale</th><th class="vat num">IVA</th></tr></thead><tbody>${items.map(i => `<tr><td>${esc(i.product.code)}</td><td>${esc(i.product.description)}</td><td class="num">${num.format(i.qty)}</td><td class="num">${num.format(i.product.price)}</td><td>${esc(discountLabel(i))}</td><td class="num"><strong>${num.format(lineNet(i))}</strong></td><td class="num">${i.product.vat || 22}%</td></tr>`).join('')}</tbody></table><div class="print-bottom"><div class="print-notes-dense"><strong>NOTE E CONDIZIONI</strong><p>${esc($('notes').value || companyProfile.legalNotes || 'Prezzi IVA esclusa salvo diversa indicazione. Disponibilità e tempi di consegna da confermare.')}</p></div><div class="print-totals-dense"><div><span>Imponibile</span><strong>${euro.format(t.net)}</strong></div><div><span>IVA</span><strong>${euro.format(t.vat)}</strong></div><div><span>TOTALE ${documentType === 'order' ? 'ORDINE' : 'OFFERTA'}</span><strong>${euro.format(t.grand)}</strong></div></div></div><div class="print-legal-dense">${esc(companyProfile.footerText || companyProfile.legalNotes || `I prezzi sono riservati al cliente intestatario e validi per il periodo indicato. L'${documentType === 'order' ? 'ordine' : 'offerta'} non costituisce conferma definitiva.`)}</div></div>`;
}

function exportExcel() {
  if (!canExport()) return;
  const c = customerData(), t = totals(), label = documentType === 'order' ? 'ORDINE' : 'OFFERTA';
  const rows = items.map(i => `<tr><td>${esc(i.product.code)}</td><td>${esc(i.product.description)}</td><td>${esc(i.product.brand)}</td><td>${i.qty}</td><td>${i.product.price}</td>${i.discounts.map(d => `<td>${d}</td>`).join('')}<td>${i.markup}</td><td>${effectiveDiscount(i.discounts).toFixed(2)}</td><td>${lineNet(i).toFixed(2)}</td><td>${i.product.vat || 22}</td></tr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><tr><th colspan="13">${label} CLIENTE ${offerNumber()}</th></tr><tr><td>Azienda</td><td colspan="12">${esc(companyProfile.companyName || companyProfile.displayName)}</td></tr><tr><td>Dati azienda</td><td colspan="12">${esc([companyAddressLine(), companyContactLine()].filter(Boolean).join(' · '))}</td></tr><tr><td>Cliente</td><td colspan="12">${esc(c.name)}</td></tr><tr><td>Indirizzo</td><td colspan="12">${esc(c.address)}</td></tr><tr><th>Codice</th><th>Descrizione</th><th>Marca</th><th>Quantità</th><th>Listino</th><th>Sconto 1</th><th>Sconto 2</th><th>Sconto 3</th><th>Sconto 4</th><th>Ricarico</th><th>Sconto equivalente</th><th>Totale netto</th><th>IVA %</th></tr>${rows}<tr><td colspan="11">Imponibile</td><td>${t.net.toFixed(2)}</td></tr><tr><td colspan="11">IVA</td><td>${t.vat.toFixed(2)}</td></tr><tr><td colspan="11">Totale ${label.toLowerCase()}</td><td>${t.grand.toFixed(2)}</td></tr></table></body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label}_${offerNumber()}.xls`;
  a.click();
  URL.revokeObjectURL(url);
  toast('File Excel generato');
}

function submissionPayload() {
  const c = customerData(), t = totals(), agent = currentAgent(), number = offerNumber();
  const repoId = window.companyConfig?.repository?.spreadsheetId || '1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnIVIenn-Fjc';
  const base = {
    id: localStorage.getItem(`submission-${number}`) || crypto.randomUUID(),
    spreadsheetId: repoId,
    repositorySpreadsheetId: repoId,
    agentCode: agent.id,
    agentName: agent.name,
    customerId: c.id,
    customerName: c.name,
    total: t.grand,
    payload: {
      company: { ...companyProfile },
      payment: $('payment').value,
      shipping: $('shipping').value,
      validity: $('validity').value,
      notes: $('notes').value,
      lines: items.map(i => ({
        code: i.product.code,
        description: i.product.description,
        quantity: i.qty,
        listPrice: i.product.price,
        discounts: i.discounts,
        markup: i.markup,
        net: lineNet(i),
        vat: i.product.vat || 22
      }))
    }
  };
  return documentType === 'order' ? { ...base, orderNumber: number } : { ...base, offerNumber: number };
}

async function readApiResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { return text ? JSON.parse(text) : {}; } catch { throw new Error('Risposta del servizio non leggibile. Riprova tra poco.'); }
  }
  if (response.status === 401 || response.status === 403 || response.redirected || /^\s*<!doctype|^\s*<html/i.test(text)) {
    throw new Error('Sessione scaduta o accesso non autorizzato.');
  }
  throw new Error(`Servizio non disponibile (${response.status}).`);
}

async function sendSubmission(payload) {
  const number = payload.orderNumber || payload.offerNumber;
  const type = payload.documentType || (payload.orderNumber ? 'order' : 'offer');
  localStorage.setItem(`submission-${number}`, payload.id);
  const response = await fetch(type === 'order' ? '/api/orders' : '/api/offers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(payload)
  });
  const data = await readApiResponse(response);
  if (!response.ok) throw new Error(data.error || 'Invio a Google Sheets non riuscito');
  return data;
}

async function submitOffer() {
  if (!canExport()) return;
  const c = customerData();
  if (!c.name) {
    toast('Seleziona il cliente prima dell’invio');
    return;
  }
  if (currentRole() === 'ADMIN') {
    toast('Seleziona la vista operativa di un agente prima dell’invio');
    return;
  }
  const payload = submissionPayload();
  $('submitBtn').disabled = true;
  $('submitBtn').textContent = 'Registrazione su Google Sheets…';

  if (!navigator.onLine) {
    const outbox = JSON.parse(localStorage.getItem('offer-outbox') || '[]');
    if (!outbox.some(o => o.id === payload.id)) outbox.push({ ...payload, documentType });
    localStorage.setItem('offer-outbox', JSON.stringify(outbox));
    toast(`${documentType === 'order' ? 'Ordine' : 'Offerta'} in coda: sarà registrato sul foglio appena torna la linea`);
    $('submitBtn').textContent = 'In coda offline';
    return;
  }

  try {
    await sendSubmission(payload);
    toast(`${documentType === 'order' ? 'Ordine' : 'Offerta'} registrato con successo nel foglio Google`);
    setTimeout(() => location.href = '/', 900);
  } catch (error) {
    toast(error.message || 'Invio non riuscito');
    $('submitBtn').disabled = false;
    $('submitBtn').textContent = 'Invia in azienda';
  }
}

async function flushOutbox() {
  const outbox = JSON.parse(localStorage.getItem('offer-outbox') || '[]');
  if (!outbox.length) return;
  const pending = [];
  for (const payload of outbox) {
    try {
      await sendSubmission(payload);
    } catch {
      pending.push(payload);
    }
  }
  localStorage.setItem('offer-outbox', JSON.stringify(pending));
  if (!pending.length) toast('Pratiche in coda registrate sul foglio Google');
}

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length };
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() || []).map(normalized);
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, clean(r[i])])));
}

const pick = (row, ...keys) => {
  for (const key of keys) {
    const value = row[normalized(key)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
};

function normalizeArticles(rows) {
  return rows.map((r, index) => ({
    id: pick(r, 'CaId') || String(index + 1),
    code: pick(r, 'Ca', 'Codice') || pick(r, 'CaId'),
    description: pick(r, 'DesArt', 'Descrizione') || pick(r, 'Q_UBI_ART_DesTab'),
    sector: pick(r, 'JSettore', 'Settore'),
    macroFamily: pick(r, 'JMacroFamiglia', 'Macro famiglia'),
    family: pick(r, 'JFamiglia', 'Famiglia'),
    brand: pick(r, 'Marca') || pick(r, 'Q_MARCHE_DesTab'),
    group: pick(r, 'Q_UBI_ART_DesTab'),
    price: toNumber(pick(r, 'QT_prezzo_Pz', 'Prezzo', 'Listino')),
    stock: toNumber(pick(r, 'QtEsi', 'Disponibilita')),
    imageRef: pick(r, 'Disegno'),
    discountCode: pick(r, 'JScontoVen'),
    maxDiscount: Math.min(100, Math.max(0, toNumber(pick(r, 'ScReale', 'Sconto massimo')) || 100)),
    vat: toNumber(pick(r, 'IVA')) || 22
  })).filter(p => p.code && p.description);
}

function agentIdForSource(source) {
  return AGENTS.find(a => normalized(a.source || a.name || a.code) === normalized(source))?.id || 'UNASSIGNED';
}

function normalizeClients(rows) {
  return rows.map((r, index) => {
    const source = pick(r, 'Agente');
    return {
      id: pick(r, 'Codice') || String(index + 1),
      name: pick(r, 'Ragione sociale', 'Cliente'),
      activityCode: pick(r, 'Cod.Att.'),
      activity: pick(r, 'Attivita'),
      sourceAgent: source,
      agentId: agentIdForSource(source),
      address: pick(r, 'Indirizzo'),
      postalCode: pick(r, 'Cap'),
      city: pick(r, 'Citta'),
      province: pick(r, 'Pv', 'Provincia'),
      phone: pick(r, 'Telefono'),
      mobile: pick(r, 'Cellulare'),
      email: pick(r, 'E-mail', 'Email')
    };
  }).filter(c => c.id && c.name);
}

async function readImport(input, type) {
  const file = input.files[0];
  if (!file) return null;
  const rows = parseCsv(await file.text());
  return type === 'articles' ? normalizeArticles(rows) : normalizeClients(rows);
}

function renderDataDialog() {
  $('articleDataCount').textContent = products.length.toLocaleString('it-IT');
  $('clientDataCount').textContent = clients.length.toLocaleString('it-IT');
  $('dataUpdatedAt').textContent = nowLabel(dataMeta.generatedAt);
  $('agentMapList').innerHTML = AGENTS.map((a, index) => `<label class="agent-map-row"><span><strong>${a.id.replace('AG', 'Agente ')}</strong>${esc(a.name)}${a.head ? ' · capo area' : ''}</span>${index ? `<input type="checkbox" data-area-member="${a.id}" ${(hierarchy[AGENTS[0]?.id] || []).includes(a.id) ? 'checked' : ''}>` : '<small>Include sempre i propri clienti</small>'}</label>`).join('');
}

async function applyImports(event) {
  event.preventDefault();
  $('importStatus').textContent = 'Elaborazione in corso…';
  try {
    const [newArticles, newClients] = await Promise.all([
      readImport($('articleImport'), 'articles'),
      readImport($('clientImport'), 'clients')
    ]);
    if (AGENTS[0]) {
      hierarchy[AGENTS[0].id] = [...document.querySelectorAll('[data-area-member]:checked')].map(el => el.dataset.areaMember);
      localStorage.setItem('offer-hierarchy', JSON.stringify(hierarchy));
    }
    if (newArticles && newArticles.length) products = newArticles;
    if (newClients && newClients.length) clients = newClients;
    if (newArticles || newClients) {
      dataMeta = {
        ...dataMeta,
        generatedAt: new Date().toISOString(),
        articleCount: products.length,
        clientCount: clients.length,
        articleSource: newArticles ? $('articleImport').files[0].name : dataMeta.articleSource,
        clientSource: newClients ? $('clientImport').files[0].name : dataMeta.clientSource
      };
      await dbSet('dataset', { meta: dataMeta, articles: products, clients });
    }
    updateFilters();
    renderCustomers();
    renderDataDialog();
    $('importStatus').textContent = newArticles || newClients ? `Aggiornamento completato: ${products.length.toLocaleString('it-IT')} articoli e ${clients.length.toLocaleString('it-IT')} clienti.` : 'Gerarchia aggiornata.';
    toast(newArticles || newClients ? 'Dati aggiornati sul dispositivo' : 'Gerarchia agenti aggiornata');
  } catch (error) {
    console.error(error);
    $('importStatus').textContent = 'Il file non è leggibile. Verifica che sia un CSV UTF-8.';
  }
}

function bindEvents() {
  $('productSearch').onfocus = e => renderProducts(e.target.value);
  $('productSearch').oninput = e => renderProducts(e.target.value);
  document.addEventListener('click', e => {
    if (!e.target.closest('.product-picker')) $('productResults').classList.add('hidden');
  });

  $('customerSelect').onchange = showCustomer;
  $('roleSelect').onchange = updateRoleView;
  $('catalogBtn').onclick = () => {
    $('catalogPanel').classList.remove('hidden');
    catalogLimit = 80;
    renderCatalog();
  };
  $('closeCatalog').onclick = () => $('catalogPanel').classList.add('hidden');
  ['sectorFilter', 'macroFilter', 'familyFilter', 'brandFilter'].forEach(id => $(id).onchange = () => {
    catalogLimit = 80;
    updateFilters(id);
    renderCatalog();
  });
  $('loadMoreCatalog').onclick = () => {
    catalogLimit += 80;
    renderCatalog();
  };
  ['validity', 'payment', 'shipping'].forEach(id => $(id).addEventListener('change', persistOffer));
  $('notes').oninput = persistOffer;
  $('saveBtn').onclick = () => {
    persistOffer();
    toast('Bozza salvata sul dispositivo');
  };
  $('excelBtn').onclick = exportExcel;
  $('printBtn').onclick = () => {
    if (!canExport()) return;
    buildPrintOffer();
    window.print();
  };
  $('submitBtn').onclick = submitOffer;
  $('newCustomerBtn').onclick = () => $('customerDialog').showModal();
  $('confirmCustomer').onclick = e => {
    e.preventDefault();
    const name = $('newCustomerName').value.trim(), city = $('newCustomerCity').value.trim(), address = $('newCustomerAddress').value.trim(), agentId = $('assignedAgent').value;
    if (!name || !city) return;
    const customer = {
      id: `LOCAL-${Date.now()}`,
      name,
      city,
      address,
      agentId,
      sourceAgent: agentById[agentId]?.name || agentId,
      phone: '',
      mobile: '',
      email: '',
      postalCode: '',
      province: '',
      activity: '',
      activityCode: ''
    };
    clients.push(customer);
    renderCustomers(customer.id);
    $('customerDialog').close();
    $('customerForm').reset();
    dbSet('dataset', { meta: dataMeta, articles: products, clients }).catch(() => {});
    toast('Cliente salvato e assegnato');
  };
  $('dataBtn').onclick = async () => {
    await loadData();
    renderCompanyProfile();
    renderDataDialog();
    $('dataDialog').showModal();
    toast('Dati sincronizzati con Google Sheets');
  };
  $('applyImport').onclick = applyImports;
}

async function start() {
  const params = new URLSearchParams(location.search);
  documentType = params.get('type') === 'order' ? 'order' : 'offer';
  $('documentTitle').textContent = documentType === 'order' ? 'ORDINE CLIENTE' : 'OFFERTA CLIENTE';
  $('grandLabel').textContent = documentType === 'order' ? 'TOTALE ORDINE' : 'TOTALE OFFERTA';
  $('submitBtn').textContent = documentType === 'order' ? 'Invia ordine' : 'Invia offerta';
  $('documentDate').value = new Date().toLocaleDateString('it-IT');
  document.title = documentType === 'order' ? 'Nuovo ordine' : 'Nuova offerta';

  if (params.get('new') === '1') {
    localStorage.removeItem('offer-demo');
    localStorage.removeItem(documentType === 'order' ? 'order-numbers' : 'offer-numbers');
  }

  bindEvents();
  $('syncLabel').textContent = 'Connessione a Google Sheets…';

  try {
    await loadData();
    roleOptions();
    updateFilters();
    restoreOffer();
    updateRoleView();
    renderOffer();
    renderCatalog();
    renderCompanyProfile();
    $('syncLabel').textContent = navigator.onLine ? '🟢 Google Sheets collegato' : 'Modalità offline';
    $('offerCode').textContent = offerNumber();
  } catch (error) {
    console.error(error);
    $('syncLabel').textContent = 'Errore caricamento dati';
    toast(error.message || 'Impossibile caricare l’archivio dati');
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' });
window.addEventListener('offline', () => {
  $('syncLabel').textContent = 'Modalità offline';
  toast('Sei offline: dati e bozze restano disponibili');
});
window.addEventListener('online', () => {
  $('syncLabel').textContent = '🟢 Google Sheets collegato';
  toast('Connessione ripristinata');
  flushOutbox();
});

start();
if (navigator.onLine) flushOutbox();
