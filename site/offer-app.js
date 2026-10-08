// Offerte Agenti — Dynamic Google Sheets & API Integration
const DEFAULT_SYSTEM_AGENTS = [
  { id: 'AG01', code: 'AG001', name: 'Tina Cucci', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG02', code: 'AG002', name: 'David Alfano', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG03', code: 'AG003', name: 'Bianca Narducci', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG04', code: 'AG004', name: 'Loredana Andreoli', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG05', code: 'AG005', name: 'Nunzio Sorce', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG06', code: 'AG006', name: 'Enzo Nicastro', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG07', code: 'AG007', name: 'Linda de gavi', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG08', code: 'AG008', name: 'Pietro Vivenza', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG09', code: 'AG009', name: 'Paolo Infante', role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG10', code: 'AG010', name: "Daniele sama’", role: 'Agente', head: false, discountLimit: 40 },
  { id: 'AG11', code: 'AG011', name: 'Andrea Rygiewicz', role: 'Agente', head: false, discountLimit: 40 }
];

let AGENTS = [...DEFAULT_SYSTEM_AGENTS];
let agentById = Object.fromEntries(AGENTS.map(a => [a.id, a]));
let hierarchy = { AG01: ['AG02'], AG03: ['AG04', 'AG05', 'AG06', 'AG07', 'AG08', 'AG09', 'AG10', 'AG11'] };
let products = [], clients = [], dataMeta = {}, items = [], catalogLimit = 80;
let companyProfile = {
  companyName: 'Pascal Milano',
  displayName: 'Pascal Cosmesi International',
  vatNumber: '14442500964',
  taxCode: '14442500964',
  address: 'PIAZZA IV NOVEMBRE 25',
  postalCode: '20099',
  city: 'Milano',
  province: 'MI',
  country: 'Italia',
  email: 'info@pascalmilano.it',
  pec: '',
  phone: '3929427356',
  website: 'https://www.pascalmilano.it',
  sdiCode: '',
  iban: '',
  logoFileName: '',
  footerText: '',
  legalNotes: 'Prezzi IVA esclusa salvo diversa indicazione. Disponibilità e tempi di consegna da confermare.',
  currency: 'EUR',
  defaultVat: 22,
  offerValidityDays: 30,
  ordersEmail: 'info@pascalmilano.it'
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

let currentUser = null;

function normalizeAgentCode(val) {
  if (!val) return '';
  const s = String(val).trim().toUpperCase();
  const m = s.match(/^(?:AG|AGENTE)?\s*0*(\d+)$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return `AG${n < 10 ? '0' + n : n}`;
  }
  const cleanKey = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Risoluzione 100% dinamica dall'elenco agenti caricato live da Google Drive (Anagrafica_Agenti)
  const matched = (AGENTS || []).find(a => {
    const aCode = String(a.id || a.code || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const aName = String(a.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const aUser = String(a.username || a.code || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const aEmail = String(a.email || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanKey === aCode ||
           cleanKey === aName ||
           (aName && (cleanKey.includes(aName) || aName.includes(cleanKey))) ||
           cleanKey === aUser ||
           cleanKey === aEmail ||
           (aCode.replace(/\D+/g, '') && aCode.replace(/\D+/g, '') === cleanKey.replace(/\D+/g, ''));
  });
  if (matched) return matched.id;
  return s;
}

async function checkUserSession() {
  try {
    const res = await fetch('/api/session', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.user) {
        currentUser = data.user;
        try { localStorage.setItem('oa_session_user', JSON.stringify(currentUser)); } catch {}
        return currentUser;
      }
    }
  } catch {}
  try {
    const cached = localStorage.getItem('oa_session_user');
    if (cached) currentUser = JSON.parse(cached);
  } catch {}
  return currentUser;
}

const currentRole = () => {
  if (currentUser && currentUser.role === 'agent') {
    return normalizeAgentCode(currentUser.agentCode) || 'AG01';
  }
  return $('roleSelect')?.value || (AGENTS[0]?.id || 'AG01');
};

const currentAgentId = () => currentRole().replace('AREA_', '');
const currentAgent = () => {
  const agId = currentAgentId();
  if (agentById[agId]) return agentById[agId];
  if (currentUser && currentUser.role === 'agent') {
    return {
      id: agId,
      name: currentUser.name || 'Agente',
      role: 'Agente',
      discountLimit: 40
    };
  }
  return AGENTS[0] || { id: 'AG01', name: 'Agente', role: 'Agente', discountLimit: 40 };
};

// Autonomia sconti agenti: nessun blocco o tetto vincolante in fase operativa
const maxAllowedDiscount = (product, customer) => 100;


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
  if (!clients.length) {
    clients = [
      { id: '1610', code: '1610', name: 'PROF2', type: 'C-002', activity: 'PROFUMERIA', agentId: 'AG10', sourceAgent: "Daniele Sama'", address: 'VIA PIPPO 1', postalCode: '50018', city: 'SCANDICCI', province: 'FI', phone: '', mobile: '', email: '' }
    ];
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
      const def = window.OFFICIAL_SYSTEM_SPREADSHEETS || {
        company: { spreadsheetId: "1-ntNPKA3gdjZaxYntGNkXtKC5Kt4JIXGSoQfESO169M", tab: "Dati azienda" },
        agents: { spreadsheetId: "13HaTubf4_xVTtzkQUcYINkRtuSzLR2qGzJAiA-oAecU", tab: "Agenti" },
        customers: { spreadsheetId: "1rkFDBTCJD3JlrcvyOPGHjYTJDkjuMc24dJ7l6EqQ6I8", tab: "clienti" },
        products: { spreadsheetId: "17ErnowHZDqA3WDTN5auHkyTBPVn4MqkI8BFkiqkDhmE", tab: "q_listino_prezzi_catalogo" },
        repository: { spreadsheetId: "1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnIVIenn-Fjc", tabOffers: "Offerte", tabOrders: "Ordini" }
      };
      const cfg = window.companyConfig || def;
      const getValidId = (id, fallback) => (!id || typeof id !== 'string' || id.length < 20 || id.includes('1mnW') || id.includes('1N6ZcGa')) ? fallback : id.trim();

      const compId = getValidId(cfg.company?.spreadsheetId, def.company.spreadsheetId);
      const agId = getValidId(cfg.agents?.spreadsheetId, def.agents.spreadsheetId);
      const custId = getValidId(cfg.customers?.spreadsheetId, def.customers.spreadsheetId);
      const prodId = getValidId(cfg.products?.spreadsheetId, def.products.spreadsheetId);

      const qs = (id, tab) => {
        const params = new URLSearchParams();
        if (id) params.set('id', id);
        if (tab) params.set('tab', tab);
        const str = params.toString();
        return str ? '?' + str : '';
      };

      const token = localStorage.getItem('oa_session_token');
      const authHeaders = {
        accept: 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      };

      const [compRes, agRes, custRes, prodRes] = await Promise.all([
        fetch(`/api/company${qs(compId, cfg.company?.tab || def.company.tab)}`, { headers: authHeaders, credentials: 'same-origin', cache: 'no-store' }),
        fetch(`/api/agents${qs(agId, cfg.agents?.tab || def.agents.tab)}`, { headers: authHeaders, credentials: 'same-origin', cache: 'no-store' }),
        fetch(`/api/customers${qs(custId, cfg.customers?.tab || def.customers.tab)}`, { headers: authHeaders, credentials: 'same-origin', cache: 'no-store' }),
        fetch(`/api/products${qs(prodId, cfg.products?.tab || def.products.tab)}`, { headers: authHeaders, credentials: 'same-origin', cache: 'no-store' })
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
        if (d.ok !== false && Array.isArray(d.customers)) {
          clients = d.customers;
        }
      }

      if (prodRes.ok) {
        const d = await prodRes.json();
        if (d.ok !== false && Array.isArray(d.products) && d.products.length > 0) {
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
  const user = currentUser;
  const userRole = user?.role || (user ? 'agent' : 'admin');
  const userAgentCode = normalizeAgentCode(user?.agentCode || '');
  const userSwitch = document.querySelector('.user-switch');

  // 1. SE L'UTENTE È UN AGENTE: NASCONDE IL MENU E BLOCCA LA VISTA OPERATIVA SULL'AGENTE STESSO!
  if (user && userRole === 'agent') {
    let myAgent = AGENTS.find(a => normalizeAgentCode(a.id) === userAgentCode || normalizeAgentCode(a.code) === userAgentCode);
    if (!myAgent && user.name) {
      myAgent = AGENTS.find(a => (a.name || '').toLowerCase() === user.name.toLowerCase());
    }
    const myId = myAgent?.id || userAgentCode || 'AG01';
    const myName = myAgent?.name || user.name || 'Agente';

    $('roleSelect').innerHTML = `<option value="${myId}">${myId.replace('AG', 'Agente ')} · ${esc(myName)}</option>`;
    $('roleSelect').value = myId;
    $('roleSelect').style.display = 'none';

    if (userSwitch) {
      const label = userSwitch.querySelector('label');
      if (label) label.style.display = 'none';
      let badge = userSwitch.querySelector('.user-badge-fixed');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'user-badge-fixed';
        userSwitch.appendChild(badge);
      }
      badge.innerHTML = `👤 <strong>${esc(myName)}</strong> (${myId.replace('AG', 'Agente ')})`;
    }

    localStorage.setItem('offer-role', myId);

    if ($('assignedAgent')) {
      $('assignedAgent').innerHTML = `<option value="${myId}">${myId.replace('AG', 'Agente ')} · ${esc(myName)}</option>`;
      $('assignedAgent').value = myId;
      $('assignedAgent').disabled = true;
    }
    return;
  }

  // 2. SE L'UTENTE È UN CAPO AREA: VEDE SOLO SE STESSO E GLI AGENTI ASSEGNATI
  if (user && userRole === 'area_head') {
    const myId = userAgentCode || 'AG01';
    const myAgent = agentById[myId] || { id: myId, name: user.name || 'Capo area' };
    const subAgentIds = hierarchy[myId] || [];

    let html = `<option value="AREA_${myId}">Capo area · ${esc(myAgent.name)}</option>`;
    html += `<option value="${myId}">${myId.replace('AG', 'Agente ')} · ${esc(myAgent.name)} (I miei clienti)</option>`;
    subAgentIds.forEach(subId => {
      const subAg = agentById[subId];
      if (subAg) {
        html += `<option value="${subAg.id}">${subAg.id.replace('AG', 'Agente ')} · ${esc(subAg.name)}</option>`;
      }
    });

    $('roleSelect').innerHTML = html;
    $('roleSelect').style.display = '';

    if (userSwitch) {
      const label = userSwitch.querySelector('label');
      if (label) label.style.display = '';
      const badge = userSwitch.querySelector('.user-badge-fixed');
      if (badge) badge.remove();
    }

    const current = localStorage.getItem('offer-role');
    if (current && [...$('roleSelect').options].some(o => o.value === current)) {
      $('roleSelect').value = current;
    } else {
      $('roleSelect').value = `AREA_${myId}`;
    }

    if ($('assignedAgent')) {
      $('assignedAgent').disabled = false;
      let assignHtml = `<option value="${myId}">${myId.replace('AG', 'Agente ')} · ${esc(myAgent.name)}</option>`;
      subAgentIds.forEach(subId => {
        const subAg = agentById[subId];
        if (subAg) assignHtml += `<option value="${subAg.id}">${subAg.id.replace('AG', 'Agente ')} · ${esc(subAg.name)}</option>`;
      });
      $('assignedAgent').innerHTML = assignHtml;
    }
    return;
  }

  // 3. SE L'UTENTE È AMMINISTRATORE: VEDE TUTTI I CLIENTI E PUÒ SELEZIONARE QUALSIASI AGENTE
  const current = localStorage.getItem('offer-role') || 'ADMIN';
  const heads = AGENTS.filter(a => a.head || (hierarchy[a.id] && hierarchy[a.id].length > 0));

  let html = '<option value="ADMIN">Amministrazione · tutti i clienti</option>';
  heads.forEach(h => {
    html += `<option value="AREA_${h.id}">Capo area · ${esc(h.name)}</option>`;
  });
  html += AGENTS.map(a => `<option value="${a.id}">${a.id.replace('AG', 'Agente ')} · ${esc(a.name)}</option>`).join('');

  $('roleSelect').innerHTML = html;
  $('roleSelect').style.display = '';

  if (userSwitch) {
    const label = userSwitch.querySelector('label');
    if (label) label.style.display = '';
    const badge = userSwitch.querySelector('.user-badge-fixed');
    if (badge) badge.remove();
  }

  if ([...$('roleSelect').options].some(o => o.value === current)) {
    $('roleSelect').value = current;
  } else {
    $('roleSelect').value = 'ADMIN';
  }

  if ($('assignedAgent')) {
    $('assignedAgent').disabled = false;
    $('assignedAgent').innerHTML = AGENTS.map(a => `<option value="${a.id}">${a.id.replace('AG', 'Agente ')} · ${esc(a.name)}</option>`).join('');
  }
}

function visibleAgentIds() {
  const role = currentRole();
  if (role === 'ADMIN') return null;
  if (role.startsWith('AREA_')) {
    const id = currentAgentId();
    const sub = (hierarchy[id] || []).map(normalizeAgentCode);
    return new Set([id, normalizeAgentCode(id), ...sub]);
  }
  const norm = normalizeAgentCode(role);
  return new Set([role, norm, norm.replace(/^AG0?/, 'AG'), norm.replace(/^AG0*/, '')]);
}

function visibleClients() {
  const allowed = visibleAgentIds();
  if (!allowed) return clients;
  return clients.filter(c => {
    const agId = normalizeAgentCode(c.agentId);
    const srcId = normalizeAgentCode(c.sourceAgent);
    return allowed.has(c.agentId) || (agId && allowed.has(agId)) || (srcId && allowed.has(srcId)) || (c.sourceAgent && allowed.has(c.sourceAgent));
  });
}

function findClient(id) {
  return clients.find(c => String(c.id) === String(id));
}

function customerData() {
  return findClient($('customerSelect').value) || { name: '', city: '', address: '', province: '', postalCode: '', id: '' };
}

function renderCustomers(preferred = '') {
  const current = preferred || $('customerSelect').value, role = currentRole(), visible = visibleClients();
  if (!visible.length) {
    $('customerSelect').innerHTML = '<option value="">-- Nessun cliente registrato nel foglio Google Drive --</option>';
    $('assignedAgent').disabled = role.startsWith('AG');
    showCustomer();
    return;
  }
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

  // Pre-imposta il pagamento concordato del cliente se presente in anagrafica
  if (c.payment) {
    const paySelect = $('payment');
    const existingOpt = [...paySelect.options].find(o => o.value.toLowerCase() === c.payment.toLowerCase() || o.text.toLowerCase() === c.payment.toLowerCase());
    if (existingOpt) {
      paySelect.value = existingOpt.value;
      $('customPaymentInput')?.classList.add('hidden');
    } else {
      paySelect.value = '__custom__';
      if ($('customPaymentInput')) {
        $('customPaymentInput').value = c.payment;
        $('customPaymentInput').classList.remove('hidden');
      }
    }
  }

  const extraBadges = [];
  if (c.payment) extraBadges.push(`Pagamento: ${c.payment}`);
  if (c.sdi) extraBadges.push(`SDI: ${c.sdi}`);
  if (c.iban) extraBadges.push(`IBAN: ${c.iban}`);
  if (c.bank) extraBadges.push(`Banca: ${c.bank}`);
  
  // Politica Sconti (Google Drive) - Solo indicativa, non vincolante
  if (c.maxDiscount != null && Number(c.maxDiscount) > 0) {
    extraBadges.push(`🏷️ Sconto rif.: ${c.maxDiscount}%`);
  }
  if (c.discountTable) extraBadges.push(`📊 Tabella: ${c.discountTable}`);
  const clientDiscounts = [c.discount1, c.discount2, c.discount3, c.discount4].filter(d => Number(d) > 0);
  if (clientDiscounts.length > 0) {
    extraBadges.push(`✂️ Sconti base: ${clientDiscounts.map(d => `${d}%`).join(' + ')}`);
  }
  if (c.notes) extraBadges.push(`📝 ${c.notes}`);

  const extraSpan = extraBadges.length > 0 ? `<span>${esc(extraBadges.join(' · '))}</span>` : '';

  const quickActionsHtml = `
    <div style="margin-top:6px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
      <button type="button" class="btn secondary compact-btn" id="cardCustomerQuickBtn" style="font-size:0.75rem; padding:3px 8px;" title="Visualizza e modifica scheda completa">✏️ Scheda Anagrafica & Sconti</button>
      ${(clientDiscounts.length > 0 && items.length > 0) ? `<button type="button" class="btn secondary compact-btn" id="applyCustomerDiscountsBtn" style="font-size:0.75rem; padding:3px 8px;" title="Applica sconti cliente a tutti gli articoli inseriti">🔄 Applica sconti cliente (${clientDiscounts.map(d => `${d}%`).join('+')})</button>` : ''}
    </div>
  `;

  $('customerDetails').innerHTML = `<strong>${esc(c.name)}</strong><span>${esc([c.address, [c.postalCode, c.city, c.province].filter(Boolean).join(' ')].filter(Boolean).join(' · '))}</span><span>${esc([c.phone, c.mobile, c.email].filter(Boolean).join(' · ') || 'Contatti non disponibili')}</span>${extraSpan}${quickActionsHtml}`;
  $('customerDetails').classList.remove('hidden');

  $('cardCustomerQuickBtn')?.addEventListener('click', () => openCustomerCard(c.id));
  $('applyCustomerDiscountsBtn')?.addEventListener('click', () => applyCustomerDiscountsToItems());

  persistOffer();
}

function applyCustomerDiscountsToItems() {
  const c = customerData();
  if (!c || !items.length) return;
  const base = [Number(c.discount1) || 0, Number(c.discount2) || 0, Number(c.discount3) || 0, Number(c.discount4) || 0];
  items.forEach(it => {
    it.discounts = [...base];
  });
  renderOffer();
  toast('Sconti cliente applicati a tutti gli articoli');
}

function openCustomerCard(customerId) {
  const c = findClient(customerId || $('customerSelect').value);
  if (!c || !c.name) {
    toast('Seleziona prima un cliente');
    return;
  }

  $('cardCustomerId').value = c.id || '';
  if ($('cardCustomerCodeBadge')) $('cardCustomerCodeBadge').textContent = c.code || c.id || 'CLI';
  $('cardCustomerName').value = c.name || '';
  $('cardCustomerType').value = c.type || c.activity || '';
  $('cardCustomerAddress').value = c.address || '';
  $('cardCustomerCity').value = c.city || '';
  $('cardCustomerCap').value = c.postalCode || '';
  $('cardCustomerPv').value = c.province || '';
  $('cardCustomerVat').value = c.vatNumber || '';
  $('cardCustomerTax').value = c.taxCode || '';
  $('cardCustomerSdi').value = c.sdi || '';
  $('cardCustomerEmail').value = c.email || '';
  $('cardCustomerPhone').value = c.phone || '';
  $('cardCustomerMobile').value = c.mobile || '';
  $('cardCustomerPayment').value = c.payment || '';
  $('cardCustomerBank').value = c.bank || '';
  $('cardCustomerIban').value = c.iban || '';

  // Sconti & Politica commerciale
  $('cardCustomerMaxDiscount').value = (c.maxDiscount != null && c.maxDiscount !== '') ? c.maxDiscount : '';
  $('cardCustomerDiscountTable').value = c.discountTable || '';
  $('cardCustomerDiscount1').value = (c.discount1 != null && c.discount1 !== '' && Number(c.discount1) > 0) ? c.discount1 : '';
  $('cardCustomerDiscount2').value = (c.discount2 != null && c.discount2 !== '' && Number(c.discount2) > 0) ? c.discount2 : '';
  $('cardCustomerDiscount3').value = (c.discount3 != null && c.discount3 !== '' && Number(c.discount3) > 0) ? c.discount3 : '';
  $('cardCustomerDiscount4').value = (c.discount4 != null && c.discount4 !== '' && Number(c.discount4) > 0) ? c.discount4 : '';
  $('cardCustomerNotes').value = c.notes || '';

  $('customerCardDialog').showModal();
}

async function saveCustomerCard() {
  const id = $('cardCustomerId').value.trim();
  const name = $('cardCustomerName').value.trim();
  const city = $('cardCustomerCity').value.trim();
  if (!name || !city) {
    alert('Ragione sociale e Città sono campi obbligatori');
    return;
  }

  const btn = $('saveCustomerCardBtn');
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvataggio su Google Sheets…';

  const payload = {
    id,
    code: id,
    name,
    type: $('cardCustomerType').value.trim(),
    address: $('cardCustomerAddress').value.trim(),
    city,
    postalCode: $('cardCustomerCap').value.trim(),
    province: $('cardCustomerPv').value.trim().toUpperCase(),
    vatNumber: $('cardCustomerVat').value.trim(),
    taxCode: $('cardCustomerTax').value.trim().toUpperCase(),
    sdi: $('cardCustomerSdi').value.trim().toUpperCase(),
    email: $('cardCustomerEmail').value.trim(),
    phone: $('cardCustomerPhone').value.trim(),
    mobile: $('cardCustomerMobile').value.trim(),
    payment: $('cardCustomerPayment').value.trim(),
    bank: $('cardCustomerBank').value.trim(),
    iban: $('cardCustomerIban').value.trim().replace(/\s+/g, '').toUpperCase(),
    maxDiscount: $('cardCustomerMaxDiscount').value.trim() !== '' ? Number($('cardCustomerMaxDiscount').value) : null,
    discountTable: $('cardCustomerDiscountTable').value.trim(),
    discount1: $('cardCustomerDiscount1').value.trim() !== '' ? Number($('cardCustomerDiscount1').value) : 0,
    discount2: $('cardCustomerDiscount2').value.trim() !== '' ? Number($('cardCustomerDiscount2').value) : 0,
    discount3: $('cardCustomerDiscount3').value.trim() !== '' ? Number($('cardCustomerDiscount3').value) : 0,
    discount4: $('cardCustomerDiscount4').value.trim() !== '' ? Number($('cardCustomerDiscount4').value) : 0,
    notes: $('cardCustomerNotes').value.trim()
  };

  try {
    const res = await fetch('/api/customers/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore durante aggiornamento cliente');

    const updated = data.customer || payload;
    const idx = clients.findIndex(x => String(x.id) === String(id) || (x.name && x.name.toLowerCase() === name.toLowerCase()));
    if (idx >= 0) {
      clients[idx] = { ...clients[idx], ...updated };
    } else {
      clients.push(updated);
    }

    await dbSet('dataset', { meta: dataMeta, articles: products, clients }).catch(() => {});
    renderCustomers(updated.id || id);
    showCustomer();
    renderOffer();
    $('customerCardDialog').close();
    toast(`Scheda anagrafica di "${updated.name}" aggiornata su Google Drive`);
  } catch (err) {
    console.error('Errore salvataggio scheda anagrafica:', err);
    alert(`Errore salvataggio: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
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
  const c = customerData();
  let defaultDiscounts = [0, 0, 0, 0];
  if (c && (Number(c.discount1) > 0 || Number(c.discount2) > 0 || Number(c.discount3) > 0 || Number(c.discount4) > 0)) {
    defaultDiscounts = [
      Number(c.discount1) || 0,
      Number(c.discount2) || 0,
      Number(c.discount3) || 0,
      Number(c.discount4) || 0
    ];
  }
  items.push({ id: crypto.randomUUID(), product, qty: 1, discounts: defaultDiscounts, markup: 0 });
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

  const c = customerData();
  $('itemsList').innerHTML = items.map(it => {
    const eff = effectiveDiscount(it.discounts);

    return `<tr><td class="product-cell"><strong title="${esc(it.product.description)}">${esc(it.product.code)} · ${esc(it.product.description)}</strong><small>${esc([it.product.brand, it.product.macroFamily, it.product.family].filter(Boolean).join(' · '))} · Disp. ${num.format(it.product.stock)} · IVA ${it.product.vat || 22}%</small></td><td><input aria-label="Quantità" type="number" min="0.01" step="0.01" value="${it.qty}" data-id="${it.id}" data-field="qty"></td><td><input aria-label="Listino" class="readonly" value="${num.format(it.product.price)}" readonly></td>${it.discounts.map((d, n) => `<td><input aria-label="Sconto ${n + 1}" type="number" min="0" max="100" step="0.1" value="${d}" data-id="${it.id}" data-discount="${n}"></td>`).join('')}<td><input aria-label="Ricarico" type="number" min="0" max="100" step="0.1" value="${it.markup}" data-id="${it.id}" data-field="markup"></td><td class="net-cell">${euro.format(lineNet(it))}<small>eq. ${num.format(eff)}%</small></td><td><button class="compact-remove" data-remove="${it.id}" aria-label="Rimuovi">×</button></td></tr>`;
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
  $('listTotal').textContent = euro.format(t.list);
  $('discountTotal').textContent = (t.net - t.list > 0 ? '+ ' : '') + euro.format(t.net - t.list);
  $('netTotal').textContent = euro.format(t.net);
  $('vatTotal').textContent = euro.format(t.vat);
  $('grandTotal').textContent = euro.format(t.grand);
  const v = $('validationStatus');
  v.className = 'validation ' + (items.length ? 'ok' : 'neutral');
  v.textContent = items.length ? `${documentType === 'order' ? 'Ordine pronto' : 'Offerta pronta'} per invio, PDF ed Excel` : 'Inserisci almeno un articolo';
}

function currentPaymentValue() {
  const p = $('payment');
  if (!p) return '';
  if (p.value === '__custom__') {
    return $('customPaymentInput')?.value.trim() || 'Da concordare';
  }
  return p.value;
}

function persistOffer() {
  localStorage.setItem('offer-demo', JSON.stringify({
    items,
    customer: $('customerSelect').value,
    notes: $('notes').value,
    validity: $('validity').value,
    payment: currentPaymentValue(),
    shipping: $('shipping').value,
    role: currentRole()
  }));
}

let editingOriginOffer = '';

function restoreOffer() {
  try {
    const d = JSON.parse(localStorage.getItem('offer-demo'));
    if (!d) return;
    if (d.originOfferNumber) editingOriginOffer = d.originOfferNumber;
    items = (d.items || []).map(i => {
      const existingProd = products.find(p => p.code === i.product?.code);
      return {
        product: existingProd || i.product || { code: 'N/A', description: 'Articolo', price: 0, vat: 22 },
        qty: Number(i.qty) || 1,
        discounts: i.discounts || [0, 0, 0, 0],
        markup: Number(i.markup) || 0
      };
    });
    if (d.role && [...$('roleSelect').options].some(o => o.value === d.role)) $('roleSelect').value = d.role;
    $('notes').value = d.notes || '';
    $('validity').value = d.validity || '30 giorni';
    if (d.payment) {
      const paySelect = $('payment');
      const existingOpt = [...paySelect.options].find(o => o.value.toLowerCase() === d.payment.toLowerCase() || o.text.toLowerCase() === d.payment.toLowerCase());
      if (existingOpt) {
        paySelect.value = existingOpt.value;
        $('customPaymentInput')?.classList.add('hidden');
      } else {
        paySelect.value = '__custom__';
        if ($('customPaymentInput')) {
          $('customPaymentInput').value = d.payment;
          $('customPaymentInput').classList.remove('hidden');
        }
      }
    }
    if (d.shipping) $('shipping').value = d.shipping;
    let targetClient = d.customer;
    if (d.customerName) {
      const match = visibleClients().find(c => (c.name && c.name.toLowerCase() === d.customerName.toLowerCase()) || String(c.id) === String(d.customer));
      if (match) targetClient = match.id;
    }
    renderCustomers(targetClient || '');
  } catch (err) {
    console.warn('Errore restoreOffer:', err);
  }
}

function updateRoleView() {
  const role = currentRole(), agent = currentAgent();
  localStorage.setItem('offer-role', role);
  $('agentIdentity').textContent = role === 'ADMIN' ? 'Amministrazione' : role.startsWith('AREA_') ? `Capo area · ${agent.name}` : `${agent.id.replace('AG', 'Agente ')} · ${agent.name}`;
  const isAdmin = currentUser?.role === 'admin' || (role === 'ADMIN' && !currentUser);
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));
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
  const gdprClause = `Informativa Privacy (Reg. UE 2016/679): I dati personali sono trattati per finalità contrattuali e precontrattuali ex art. 6(1)(b) GDPR. Per diritti (artt. 15-22 GDPR) consultare /privacy.html o scrivere a info@pascalmilano.it.`;
  const baseLegal = esc(companyProfile.footerText || companyProfile.legalNotes || `I prezzi sono riservati al cliente intestatario e validi per il periodo indicato. L'${documentType === 'order' ? 'ordine' : 'offerta'} non costituisce conferma definitiva.`);
  $('printOffer').innerHTML = `<div class="print-sheet"><div class="print-parties"><div class="print-party"><label>AGENTE / AZIENDA</label><strong>${esc(companyProfile.companyName || companyProfile.displayName)}</strong><br>${esc(companyAddressLine())}<br>${esc(companyContactLine())}<br>${esc(agent.name)}</div><div class="print-party"><label>SPETT.LE CLIENTE</label><strong>${esc(c.name || 'Cliente da selezionare')}</strong><br>${esc([c.address, c.postalCode, c.city, c.province].filter(Boolean).join(' · '))}<br>${esc([c.phone, c.email].filter(Boolean).join(' · '))}</div></div><div class="print-title-row"><h1>${label}</h1><strong>${offerNumber()}</strong></div><table class="print-commerce"><tr><td><span>Data</span>${new Date().toLocaleDateString('it-IT')}</td><td><span>Pagamento</span>${esc(currentPaymentValue())}</td><td><span>Spedizione</span>${esc($('shipping').value)}</td><td><span>Validità</span>${esc($('validity').value)}</td></tr></table><table class="print-lines"><thead><tr><th class="code">Codice</th><th class="desc">Descrizione</th><th class="qty num">Q.tà</th><th class="price num">Listino</th><th class="discounts">Sconti / ricarico</th><th class="total num">Totale</th><th class="vat num">IVA</th></tr></thead><tbody>${items.map(i => `<tr><td>${esc(i.product.code)}</td><td>${esc(i.product.description)}</td><td class="num">${num.format(i.qty)}</td><td class="num">${num.format(i.product.price)}</td><td>${esc(discountLabel(i))}</td><td class="num"><strong>${num.format(lineNet(i))}</strong></td><td class="num">${i.product.vat || 22}%</td></tr>`).join('')}</tbody></table><div class="print-bottom"><div class="print-notes-dense"><strong>NOTE E CONDIZIONI</strong><p>${esc($('notes').value || companyProfile.legalNotes || 'Prezzi IVA esclusa salvo diversa indicazione. Disponibilità e tempi di consegna da confermare.')}</p></div><div class="print-totals-dense"><div><span>Imponibile</span><strong>${euro.format(t.net)}</strong></div><div><span>IVA</span><strong>${euro.format(t.vat)}</strong></div><div><span>TOTALE ${documentType === 'order' ? 'ORDINE' : 'OFFERTA'}</span><strong>${euro.format(t.grand)}</strong></div></div></div><div class="print-legal-dense">${baseLegal}<br><span style="font-size:0.75rem; color:#666;">${gdprClause}</span></div></div>`;
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
  const c = customerData(), t = totals(), number = offerNumber();
  let agent = currentAgent();
  if (currentRole() === 'ADMIN') {
    const custAgent = (c && c.agentId) ? (agentById[c.agentId] || AGENTS.find(a => a.id === c.agentId || a.code === c.agentId)) : null;
    agent = custAgent || AGENTS[0] || { id: 'AG01', name: 'Amministrazione', role: 'Amministrazione' };
  }
  const rawRepo = window.companyConfig?.repository?.spreadsheetId;
  const repoId = (rawRepo && rawRepo.length >= 20 && !rawRepo.includes('1mnW')) ? rawRepo : '1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnIVIenn-Fjc';
  const base = {
    id: localStorage.getItem(`submission-${number}`) || crypto.randomUUID(),
    spreadsheetId: repoId,
    repositorySpreadsheetId: repoId,
    originOfferId: editingOriginOffer || undefined,
    agentCode: agent.id,
    agentName: agent.name,
    customerId: c.id,
    customerName: c.name,
    total: t.grand,
    payload: {
      company: { ...companyProfile },
      payment: currentPaymentValue(),
      shipping: $('shipping').value,
      validity: $('validity').value,
      notes: $('notes').value,
      customerAddress: c.address || '',
      customerCity: c.city || '',
      customerPostalCode: c.postalCode || '',
      customerProvince: c.province || '',
      customerVat: c.vatNumber || c.taxCode || '',
      customerEmail: c.email || '',
      sdi: c.sdi || '',
      iban: c.iban || '',
      bank: c.bank || '',
      originOfferId: editingOriginOffer || undefined,
      revisionOf: editingOriginOffer || undefined,
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
  try {
    localStorage.setItem(`submission-${number}`, JSON.stringify(payload));
    localStorage.setItem(`submission-payload-${number}`, JSON.stringify(payload));
  } catch {}
  const hdrs = { 'content-type': 'application/json', 'accept': 'application/json' };
  const token = localStorage.getItem('oa_session_token');
  if (token) hdrs['Authorization'] = 'Bearer ' + token;
  const user = currentUser || JSON.parse(localStorage.getItem('oa_session_user') || 'null');
  if (user) hdrs['x-oa-user'] = encodeURIComponent(JSON.stringify(user));

  const response = await fetch(type === 'order' ? '/api/orders' : '/api/offers', {
    method: 'POST',
    headers: hdrs,
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
    localStorage.removeItem('offer-demo');
    localStorage.removeItem('offer-editing-info');
    localStorage.removeItem(documentType === 'order' ? 'order-numbers' : 'offer-numbers');
    localStorage.removeItem('oa_cached_practices');
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
  const norm = normalizeAgentCode(source);
  if (norm && norm.startsWith('AG') && AGENTS.some(a => a.id === norm)) return norm;
  return AGENTS.find(a => normalized(a.source || a.name || a.code) === normalized(source))?.id || 'UNASSIGNED';
}

function normalizeClients(rows) {
  return rows.map((r, index) => {
    const source = pick(r, 'Agente');
    const maxD = pick(r, 'Sconto Max', 'Sconto_Max', 'Sconto massimo', 'Max sconto');
    return {
      id: pick(r, 'Codice') || String(index + 1),
      code: pick(r, 'Codice') || String(index + 1),
      name: pick(r, 'Ragione sociale', 'Cliente'),
      activityCode: pick(r, 'Cod.Att.'),
      activity: pick(r, 'Attivita', 'Tipo') || 'Cliente',
      sourceAgent: source,
      agentId: agentIdForSource(source),
      address: pick(r, 'Indirizzo', 'Via'),
      postalCode: pick(r, 'Cap'),
      city: pick(r, 'Citta'),
      province: pick(r, 'Pv', 'Provincia'),
      phone: pick(r, 'Telefono', 'Tel'),
      mobile: pick(r, 'Cellulare', 'Cell', 'Mobile'),
      email: pick(r, 'E-mail', 'Email'),
      sdi: pick(r, 'Sdi', 'Univoco', 'Destinatario'),
      iban: pick(r, 'Iban'),
      bank: pick(r, 'Banca', 'Appoggio'),
      vatNumber: pick(r, 'Partita iva', 'P.Iva', 'Piva'),
      taxCode: pick(r, 'Codice fiscale', 'Cf'),
      payment: pick(r, 'Condizioni pagamento', 'Pagamento', 'Payment'),
      maxDiscount: maxD !== '' ? toNumber(maxD) : null,
      discountTable: pick(r, 'Tabella Sconti', 'Tabella_Sconti', 'Tabella', 'Listino sconti'),
      discount1: toNumber(pick(r, 'Sconto 1', 'Sconto_1', 'Sc 1', 'Sc1')),
      discount2: toNumber(pick(r, 'Sconto 2', 'Sconto_2', 'Sc 2', 'Sc2')),
      discount3: toNumber(pick(r, 'Sconto 3', 'Sconto_3', 'Sc 3', 'Sc3')),
      discount4: toNumber(pick(r, 'Sconto 4', 'Sconto_4', 'Sc 4', 'Sc4')),
      notes: pick(r, 'Note anagrafica', 'Note cliente', 'Note')
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
  ['validity', 'shipping'].forEach(id => $(id).addEventListener('change', persistOffer));
  $('payment').addEventListener('change', async () => {
    if ($('payment').value === '__custom__') {
      $('customPaymentInput')?.classList.remove('hidden');
      $('customPaymentInput')?.focus();
    } else {
      $('customPaymentInput')?.classList.add('hidden');
    }
    persistOffer();

    // Se è selezionato un cliente esistente, aggiorna la sua condizione di pagamento in anagrafica
    const c = customerData();
    const newPay = currentPaymentValue();
    if (c && c.id && newPay && newPay !== '__custom__') {
      c.payment = newPay;
      const idx = clients.findIndex(x => String(x.id) === String(c.id));
      if (idx >= 0) clients[idx].payment = newPay;
      await dbSet('dataset', { meta: dataMeta, articles: products, clients }).catch(() => {});
      fetch('/api/customers/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: c.id, payment: newPay })
      }).catch(e => console.warn('Sync pagamento cliente fallito:', e));
    }
  });

  $('customPaymentInput')?.addEventListener('input', persistOffer);
  $('customPaymentInput')?.addEventListener('blur', async () => {
    persistOffer();
    const c = customerData();
    const newPay = currentPaymentValue();
    if (c && c.id && newPay && newPay !== '__custom__') {
      c.payment = newPay;
      const idx = clients.findIndex(x => String(x.id) === String(c.id));
      if (idx >= 0) clients[idx].payment = newPay;
      await dbSet('dataset', { meta: dataMeta, articles: products, clients }).catch(() => {});
      fetch('/api/customers/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: c.id, payment: newPay })
      }).catch(e => console.warn('Sync pagamento personalizzato fallito:', e));
    }
  });

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
  $('editCustomerBtn')?.addEventListener('click', () => {
    const cid = $('customerSelect').value;
    if (!cid) {
      toast('Seleziona prima un cliente dal menu a tendina');
      return;
    }
    openCustomerCard(cid);
  });
  $('closeCustomerCardBtn')?.addEventListener('click', () => $('customerCardDialog').close());
  $('closeCustomerCardX')?.addEventListener('click', () => $('customerCardDialog').close());
  $('saveCustomerCardBtn')?.addEventListener('click', saveCustomerCard);

  $('confirmCustomer').onclick = async e => {
    e.preventDefault();
    const name = $('newCustomerName').value.trim();
    const city = $('newCustomerCity').value.trim();
    const address = $('newCustomerAddress').value.trim();
    const tax = ($('newCustomerTax')?.value || '').trim();
    const sdi = ($('newCustomerSdi')?.value || '').trim();
    const email = ($('newCustomerEmail')?.value || '').trim();
    const phone = ($('newCustomerPhone')?.value || '').trim();
    const mobile = ($('newCustomerMobile')?.value || '').trim();
    const payment = ($('newCustomerPayment')?.value || '').trim();
    const iban = ($('newCustomerIban')?.value || '').trim().replace(/\s+/g, '');
    const bank = ($('newCustomerBank')?.value || '').trim();
    const agentId = $('assignedAgent')?.value || currentAgentId() || 'AG01';

    const maxDiscount = ($('newCustomerMaxDiscount')?.value || '').trim();
    const discountTable = ($('newCustomerDiscountTable')?.value || '').trim();
    const discount1 = ($('newCustomerDiscount1')?.value || '').trim();
    const discount2 = ($('newCustomerDiscount2')?.value || '').trim();
    const discount3 = ($('newCustomerDiscount3')?.value || '').trim();
    const discount4 = ($('newCustomerDiscount4')?.value || '').trim();
    const notes = ($('newCustomerNotes')?.value || '').trim();

    if (!name || !city) {
      alert('Inserire almeno la ragione sociale e la città del cliente');
      return;
    }

    const btn = $('confirmCustomer');
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Salvataggio su Google Sheets…';

    let savedCustomer = null;
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          city,
          address,
          tax,
          sdi,
          email,
          phone,
          mobile,
          payment,
          iban,
          bank,
          agentId,
          maxDiscount: maxDiscount !== '' ? Number(maxDiscount) : null,
          discountTable,
          discount1: discount1 !== '' ? Number(discount1) : 0,
          discount2: discount2 !== '' ? Number(discount2) : 0,
          discount3: discount3 !== '' ? Number(discount3) : 0,
          discount4: discount4 !== '' ? Number(discount4) : 0,
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore salvataggio cliente');
      savedCustomer = data.customer;
    } catch (err) {
      console.warn('Errore salvataggio remoto cliente, uso fallback locale:', err);
      savedCustomer = {
        id: `LOCAL-${Date.now()}`,
        code: `LOCAL-${Date.now()}`,
        name,
        city,
        address,
        agentId,
        sourceAgent: agentById[agentId]?.name || agentId,
        phone,
        mobile,
        email,
        sdi,
        iban,
        bank,
        payment,
        vatNumber: tax,
        taxCode: tax,
        postalCode: '',
        province: '',
        activity: 'Cliente',
        activityCode: '',
        maxDiscount: maxDiscount !== '' ? Number(maxDiscount) : null,
        discountTable,
        discount1: discount1 !== '' ? Number(discount1) : 0,
        discount2: discount2 !== '' ? Number(discount2) : 0,
        discount3: discount3 !== '' ? Number(discount3) : 0,
        discount4: discount4 !== '' ? Number(discount4) : 0,
        notes
      };
      toast('Cliente salvato in locale (Google Sheets non raggiungibile)');
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }

    if (savedCustomer) {
      const existingIdx = clients.findIndex(c => String(c.id) === String(savedCustomer.id) || (c.name && c.name.toLowerCase() === savedCustomer.name.toLowerCase()));
      if (existingIdx >= 0) {
        clients[existingIdx] = savedCustomer;
      } else {
        clients.push(savedCustomer);
      }
      renderCustomers(savedCustomer.id);
      $('customerDialog').close();
      $('customerForm').reset();
      await dbSet('dataset', { meta: dataMeta, articles: products, clients }).catch(() => {});
      toast(`Cliente "${savedCustomer.name}" salvato su Google Sheets e assegnato`);
    }
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
  if ($('documentDate')) $('documentDate').value = new Date().toLocaleDateString('it-IT');
  renderCompanyProfile();
  roleOptions();
  renderCustomers();

  const params = new URLSearchParams(location.search);
  const revParam = params.get('revision') || params.get('edit');
  documentType = params.get('type') === 'order' ? 'order' : 'offer';

  if (revParam) {
    documentType = 'offer';
    editingOriginOffer = revParam;
    const isRev = !params.get('edit');
    $('documentTitle').textContent = isRev ? 'REVISIONE OFFERTA' : 'MODIFICA OFFERTA';
    $('grandLabel').textContent = 'TOTALE OFFERTA';
    $('submitBtn').textContent = isRev ? 'Registra revisione su Google Sheets' : 'Aggiorna offerta su Google Sheets';
    document.title = isRev ? `Revisione ${revParam}` : `Modifica ${revParam}`;

    // Calcola il nuovo numero di revisione progressivo
    const base = revParam.replace(/-R\d+$/i, '');
    let revIdx = 1;
    const m = revParam.match(/-R(\d+)$/i);
    if (m) revIdx = parseInt(m[1], 10) + 1;
    const nextRevNum = isRev ? `${base}-R${revIdx}` : revParam;

    const savedNumbers = JSON.parse(localStorage.getItem('offer-numbers') || '{}');
    const roleId = currentAgentId();
    savedNumbers[roleId] = nextRevNum;
    localStorage.setItem('offer-numbers', JSON.stringify(savedNumbers));
  } else {
    $('documentTitle').textContent = documentType === 'order' ? 'ORDINE CLIENTE' : 'OFFERTA CLIENTE';
    $('grandLabel').textContent = documentType === 'order' ? 'TOTALE ORDINE' : 'TOTALE OFFERTA';
    $('submitBtn').textContent = documentType === 'order' ? 'Invia ordine' : 'Invia offerta';
    document.title = documentType === 'order' ? 'Nuovo ordine' : 'Nuova offerta';
  }

  $('offerCode').textContent = offerNumber();

  if (params.get('new') === '1' && !revParam) {
    localStorage.removeItem('offer-demo');
    localStorage.removeItem('offer-editing-info');
    localStorage.removeItem(documentType === 'order' ? 'order-numbers' : 'offer-numbers');
  }

  window.clearOperationalDraft = () => {
    localStorage.removeItem('offer-demo');
    localStorage.removeItem('offer-editing-info');
    localStorage.removeItem(documentType === 'order' ? 'order-numbers' : 'offer-numbers');
    items = [];
    if ($('customerSelect')) $('customerSelect').value = '';
    showCustomer();
    renderOffer();
    updateTotals();
    toast('Bozza azzerata: pronto per un nuovo inserimento operativo');
  };

  try {
    bindEvents();
  } catch (err) {
    console.warn('bindEvents non-fatal warning:', err);
  }

  $('syncLabel').textContent = 'Connessione a Google Sheets…';

  try {
    await checkUserSession();
    roleOptions();
    await loadData();
    roleOptions();
    updateFilters();
    restoreOffer();
    if (params.get('client')) {
      const qClient = decodeURIComponent(params.get('client')).trim().toLowerCase();
      const match = visibleClients().find(c => (c.name || '').toLowerCase().includes(qClient));
      if (match) {
        $('customerSelect').value = String(match.id);
        showCustomer();
      }
    }
    updateRoleView();
    renderOffer();
    renderCatalog();
    renderCompanyProfile();

    if (revParam) {
      let banner = $('revisionBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'revisionBanner';
        banner.style.cssText = 'background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:10px 14px; border-radius:8px; margin: 12px 0; font-size:.88rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;';
        const container = document.querySelector('.main-head') || $('app');
        if (container && container.parentNode) {
          container.parentNode.insertBefore(banner, container.nextSibling);
        }
      }
      banner.innerHTML = `
        <div>
          <strong>✏️ Revisione Offerta:</strong> Stai lavorando sui dati dell'offerta originale <code>${esc(revParam)}</code>.
          <div style="font-size:.78rem; color:#2563eb; margin-top:2px;">Tutti gli articoli sono stati ricaricati. Puoi aggiungerne altri dal catalogo, variare quantità o prezzi, e ristampare o confermare.</div>
        </div>
        <a href="/index.html" class="btn secondary" style="padding:4px 10px; font-size:.78rem; text-decoration:none;">Torna al Registro</a>
      `;
    }

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
