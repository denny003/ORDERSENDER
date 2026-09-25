import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  }
});

const b64 = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const unb64 = v => Buffer.from(v, 'base64url').toString('utf8');
const secret = () => process.env.SESSION_SECRET || 'secret-key-at-least-32-characters-long';
const sign = v => crypto.createHmac('sha256', secret()).update(v).digest('base64url');

function users() {
  try {
    const list = JSON.parse(process.env.PILOT_USERS || '[]');
    if (list.length) return list;
  } catch {}
  return [
    { username: 'agente01', password: 'cambiare-password', name: 'Federico Micozzi', role: 'agent', agentCode: 'AG01' },
    { username: 'amministrazione', password: 'cambiare-password', name: 'Amministrazione', role: 'admin', agentCode: 'AG01' }
  ];
}

function cookie(request) {
  return Object.fromEntries(
    (request.headers.get('cookie') || '')
      .split(';')
      .map(v => v.trim().split(/=(.*)/s).slice(0, 2))
      .filter(x => x[0])
  );
}

function session(request) {
  try {
    const token = cookie(request).oa_session;
    if (!token) return null;
    const [p, s] = token.split('.');
    if (!p || !s) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sign(p)), Buffer.from(s))) return null;
    const data = JSON.parse(unb64(p));
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function sessionCookie(user) {
  const payload = b64({
    username: user.username,
    name: user.name,
    role: user.role || 'agent',
    agentCode: normalizeAgentId(user.agentCode || 'AG01'),
    exp: Date.now() + 12 * 60 * 60 * 1000
  });
  return `oa_session=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`;
}

function normalizeAgentId(code) {
  if (!code) return '';
  const str = String(code).trim().toUpperCase();
  const m = str.match(/^AG0*(\d+)$/);
  if (m) {
    const num = parseInt(m[1], 10);
    return `AG${num < 10 ? '0' + num : num}`;
  }
  return str;
}

// In-memory runtime configuration with sensible defaults
let runtimeConfig = {
  company: {
    sheetName: 'Dati_Azienda_e_Mandanti',
    spreadsheetId: process.env.COMPANY_SPREADSHEET_ID || '1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0',
    tab: 'Dati azienda'
  },
  agents: {
    fileName: 'Anagrafica_Agenti',
    spreadsheetId: process.env.AGENTS_SPREADSHEET_ID || process.env.COMPANY_SPREADSHEET_ID || '1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0',
    tab: 'Agenti'
  },
  customers: {
    fileName: 'clienti',
    spreadsheetId: process.env.CUSTOMERS_SPREADSHEET_ID || process.env.COMPANY_SPREADSHEET_ID || '1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0',
    tab: 'clienti'
  },
  products: {
    fileName: 'Articoli',
    spreadsheetId: process.env.PRODUCTS_SPREADSHEET_ID || process.env.COMPANY_SPREADSHEET_ID || '1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0',
    tab: 'q_listino_prezzi_catalogo'
  },
  repository: {
    folder: 'Repository',
    fileName: 'Registro offerte e ordini',
    spreadsheetId: process.env.REGISTER_SPREADSHEET_ID || '1N6ZcGa2r6Qc4KzkIIUg7cgfhkMajMnippGg6U_fx2Z4',
    tabOffers: 'Offerte',
    tabOrders: 'Ordini'
  },
  googleDrive: {
    sourceFolderUrl: 'https://drive.google.com/drive/folders/1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9',
    folderId: '1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9'
  }
};

let tokenCache = { token: '', expires: 0 };

async function googleToken() {
  if (tokenCache.expires > Date.now() + 60000) return tokenCache.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Collegamento Google non configurato (mancano GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY)');
  }
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claim}.${signature}`
    })
  });
  const d = await r.json();
  if (!r.ok) {
    throw new Error('Autorizzazione Google non riuscita: ' + (d.error_description || d.error || 'Errore OAuth'));
  }
  tokenCache = { token: d.access_token, expires: Date.now() + Number(d.expires_in) * 1000 };
  return tokenCache.token;
}

async function sheets(path, opt = {}) {
  const token = await googleToken();
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + path, {
    ...opt,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(opt.headers || {})
    }
  });
  const d = await r.json();
  if (!r.ok) {
    throw new Error(d.error?.message || `Errore Google Fogli (${r.status})`);
  }
  return d;
}

async function readRange(id, range) {
  const q = encodeURIComponent(range);
  const data = await sheets(`${id}/values/${q}?majorDimension=ROWS`);
  return data.values || [];
}

async function append(id, range, values) {
  return sheets(`${id}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values })
  });
}

const companyKeys = {
  AZ001: 'companyName',
  AZ002: 'displayName',
  AZ003: 'vatNumber',
  AZ004: 'taxCode',
  AZ005: 'address',
  AZ006: 'postalCode',
  AZ007: 'city',
  AZ008: 'province',
  AZ009: 'country',
  AZ010: 'email',
  AZ011: 'pec',
  AZ012: 'phone',
  AZ013: 'website',
  AZ014: 'sdiCode',
  AZ015: 'iban',
  AZ016: 'logoFileName',
  AZ017: 'footerText',
  AZ018: 'legalNotes',
  AZ019: 'currency',
  AZ020: 'defaultVat',
  AZ021: 'offerValidityDays',
  AZ022: 'ordersEmail'
};

const knownAgentNames = {
  AG001: 'Federico Micozzi',
  AG002: 'Francesco Pontrelli',
  AG003: 'Savino De Palma',
  AG004: 'Giorgio Fabris',
  AG005: 'Francesco Poli',
  AG006: 'Francesco Gelsumini',
  AG007: 'Andrea Tirella',
  AG008: 'Vincenzo Antonio Richetta',
  AG009: 'Daniele Rigamonti',
  AG010: 'Maurizio Maltinti',
  AG011: 'Andrea Rygiewicz'
};

// Fallback seed loader for local dev / offline resilience
let cachedSeed = null;
async function loadSeed() {
  if (cachedSeed) return cachedSeed;
  try {
    const raw = await readFile(new URL('../../site/seed-data.json', import.meta.url), 'utf8');
    cachedSeed = JSON.parse(raw);
    return cachedSeed;
  } catch {
    return { articles: [], clients: [], agents: [], company: {} };
  }
}

// 1. Fetch Company
async function fetchCompanyData(customId, customTab) {
  const id = customId || runtimeConfig.company.spreadsheetId;
  const tab = customTab || runtimeConfig.company.tab || 'Dati azienda';
  try {
    const rows = await readRange(id, `'${tab}'!A1:D45`);
    const out = {};
    for (const r of rows) {
      if (r[0] && companyKeys[r[0]]) {
        out[companyKeys[r[0]]] = String(r[3] ?? '').trim().replace(/^"|"$/g, '');
      }
    }
    if (Object.keys(out).length > 0) {
      return { ok: true, source: 'google-sheets', company: out };
    }
  } catch (err) {
    console.warn('Google Sheets company read error:', err.message);
  }
  const seed = await loadSeed();
  return { ok: true, source: 'offline-cache', company: seed.company || {} };
}

// 2. Fetch Agents
async function fetchAgentsData(customId, customTab) {
  const id = customId || runtimeConfig.agents.spreadsheetId;
  const tab = customTab || runtimeConfig.agents.tab || 'Agenti';
  try {
    const rows = await readRange(id, `'${tab}'!A1:R100`);
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const line = (rows[i] || []).map(c => String(c).toLowerCase().trim());
      if (line.some(c => c.includes('codice agente') || c === 'codice')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx >= 0) {
      const header = rows[headerIdx].map(c => String(c).toLowerCase().trim());
      const col = name => header.findIndex(h => h.includes(name));
      const codeIdx = col('codice agente') >= 0 ? col('codice agente') : col('codice');
      const activeIdx = col('attivo');
      const roleIdx = col('ruolo');
      const parentIdx = col('assegnato a');
      const nameIdx = col('nome');
      const surnameIdx = col('cognome');
      const rsIdx = col('ragione sociale');
      const emailIdx = col('email accesso') >= 0 ? col('email accesso') : col('email');
      const phoneIdx = col('telefono');
      const canOfferIdx = col('offerte');
      const canOrderIdx = col('ordini');
      const discountIdx = col('sconto');
      const noteIdx = col('note');

      const agents = [];
      const hierarchy = {};

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[codeIdx]) continue;
        const rawCode = String(r[codeIdx]).trim();
        const idShort = normalizeAgentId(rawCode);
        const role = String(r[roleIdx] || 'Agente').trim();
        const isHead = role.toLowerCase().includes('capo');
        const parentCode = r[parentIdx] ? normalizeAgentId(r[parentIdx]) : null;

        const firstName = String(r[nameIdx] || '').trim();
        const lastName = String(r[surnameIdx] || '').trim();
        const fullName = [firstName, lastName].filter(Boolean).join(' ') ||
                         String(r[rsIdx] || '').trim() ||
                         knownAgentNames[rawCode] ||
                         knownAgentNames[idShort] ||
                         `Agente ${idShort}`;

        const limitRaw = r[discountIdx] != null ? Number(r[discountIdx]) : 0.4;
        const discountLimit = limitRaw <= 1.0 ? Math.round(limitRaw * 100) : limitRaw;

        agents.push({
          id: idShort,
          code: rawCode,
          name: fullName,
          firstName,
          lastName,
          role,
          head: isHead,
          parentAgent: parentCode,
          email: String(r[emailIdx] || '').trim(),
          phone: String(r[phoneIdx] || '').trim(),
          active: !String(r[activeIdx] || '').toLowerCase().startsWith('n'),
          canOffer: !String(r[canOfferIdx] || '').toLowerCase().startsWith('n'),
          canOrder: !String(r[canOrderIdx] || '').toLowerCase().startsWith('n'),
          discountLimit,
          notes: String(r[noteIdx] || '').trim()
        });

        if (parentCode) {
          hierarchy[parentCode] = hierarchy[parentCode] || [];
          if (!hierarchy[parentCode].includes(idShort)) hierarchy[parentCode].push(idShort);
        }
      }

      if (agents.length > 0) {
        return { ok: true, source: 'google-sheets', count: agents.length, agents, hierarchy };
      }
      return { ok: false, source: 'google-sheets', error: `Nessuna riga valida trovata nella scheda "${tab}"`, count: 0 };
    }
    return { ok: false, source: 'google-sheets', error: `Intestazione con "Codice agente" non trovata nella scheda "${tab}"`, count: 0 };
  } catch (err) {
    console.warn('Google Sheets agents read error:', err.message);
    const seed = await loadSeed();
    return {
      ok: false,
      source: 'offline-cache',
      error: err.message,
      count: (seed.agents || []).length,
      agents: seed.agents || [],
      hierarchy: seed.hierarchy || { AG01: ['AG02'], AG03: ['AG04', 'AG05', 'AG06', 'AG07', 'AG08', 'AG09', 'AG10', 'AG11'] }
    };
  }
}

// 3. Fetch Customers
async function fetchCustomersData(customId, customTab, user = null) {
  const id = customId || runtimeConfig.customers.spreadsheetId;
  const tab = customTab || runtimeConfig.customers.tab || 'clienti';
  try {
    const rows = await readRange(id, `'${tab}'!A1:P500`);
    if (rows.length > 1) {
      const header = rows[0].map(c => String(c).toLowerCase().trim());
      const col = name => header.findIndex(h => h.includes(name));
      const codeIdx = col('codice');
      const nameIdx = col('ragione sociale') >= 0 ? col('ragione sociale') : col('cliente');
      const typeIdx = col('tipo');
      const actIdx = col('attivit');
      const agentIdx = col('agente');
      const addressIdx = col('indirizzo');
      const capIdx = col('cap');
      const cityIdx = col('citt');
      const pvIdx = col('pv') >= 0 ? col('pv') : col('provincia');
      const phoneIdx = col('telefono');
      const mobileIdx = col('cellulare');
      const emailIdx = col('e-mail') >= 0 ? col('e-mail') : col('email');

      let customers = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r[codeIdx] == null || String(r[codeIdx]).trim() === '') continue;
        const codeVal = String(r[codeIdx]).replace(/\.0$/, '').trim();
        const agentVal = String(r[agentIdx] || '').trim();
        const agentId = agentVal ? normalizeAgentId(agentVal) : 'UNASSIGNED';

        customers.push({
          id: codeVal,
          code: codeVal,
          name: String(r[nameIdx] || '').trim(),
          type: String(r[typeIdx] || '').trim(),
          activity: String(r[actIdx] || '').trim(),
          agentId,
          sourceAgent: agentVal,
          address: String(r[addressIdx] || '').trim(),
          postalCode: String(r[capIdx] || '').replace(/\.0$/, '').trim(),
          city: String(r[cityIdx] || '').trim(),
          province: String(r[pvIdx] || '').trim(),
          phone: String(r[phoneIdx] || '').trim(),
          mobile: String(r[mobileIdx] || '').trim(),
          email: String(r[emailIdx] || '').trim()
        });
      }

      if (customers.length > 0) {
        if (user && user.role !== 'admin' && user.role !== 'area_head') {
          customers = customers.filter(c => c.agentId === user.agentCode || c.sourceAgent === user.agentCode);
        }
        return { ok: true, source: 'google-sheets', count: customers.length, customers };
      }
      return { ok: false, source: 'google-sheets', error: `Scheda "${tab}" vuota o senza righe valide`, count: 0 };
    }
    return { ok: false, source: 'google-sheets', error: `Scheda "${tab}" non trovata o senza intestazione`, count: 0 };
  } catch (err) {
    console.warn('Google Sheets customers read error:', err.message);
    const seed = await loadSeed();
    let customers = seed.clients || [];
    if (user && user.role !== 'admin' && user.role !== 'area_head') {
      customers = customers.filter(c => c.agentId === user.agentCode || c.sourceAgent === user.agentCode);
    }
    return { ok: false, source: 'offline-cache', error: err.message, count: customers.length, customers };
  }
}

// 4. Fetch Products
async function fetchProductsData(customId, customTab) {
  const id = customId || runtimeConfig.products.spreadsheetId;
  const tab = customTab || runtimeConfig.products.tab || 'q_listino_prezzi_catalogo';
  try {
    const rows = await readRange(id, `'${tab}'!A1:AN500`);
    if (rows.length > 1) {
      const header = rows[0].map(c => String(c).toLowerCase().trim());
      const col = name => header.findIndex(h => h.includes(name));
      const caIdIdx = col('caid');
      const caIdx = col('ca') >= 0 ? col('ca') : col('codice');
      const desIdx = col('desart') >= 0 ? col('desart') : col('descrizione');
      const brandIdx = col('marca');
      const sectorIdx = col('jsettore') >= 0 ? col('jsettore') : col('settore');
      const macroIdx = col('jmacrofamiglia');
      const famIdx = col('jfamiglia');
      const groupIdx = col('q_ubi_art_destab');
      const priceIdx = col('qt_prezzo_pz') >= 0 ? col('qt_prezzo_pz') : col('prezzo');
      const stockIdx = col('qtesi') >= 0 ? col('qtesi') : col('disp');
      const imageIdx = col('url-immagine') >= 0 ? col('url-immagine') : col('disegno');
      const disegnoIdx = col('disegno');
      const discCodeIdx = col('jscontoven');
      const maxDiscIdx = col('screale') >= 0 ? col('screale') : col('sconto');

      const products = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || (r[caIdIdx] == null && r[caIdx] == null)) continue;
        const caId = String(r[caIdIdx] || i).replace(/\.0$/, '').trim();
        const code = String(r[caIdx] || caId).trim();
        const desc = String(r[desIdx] || r[groupIdx] || code).trim();
        if (!code || !desc) continue;

        const price = r[priceIdx] != null ? Number(r[priceIdx]) : 0;
        const stock = r[stockIdx] != null ? Number(r[stockIdx]) : 0;
        const maxDisc = r[maxDiscIdx] != null ? Number(r[maxDiscIdx]) : 60;

        products.push({
          id: caId,
          code,
          description: desc,
          brand: String(r[brandIdx] || '').trim(),
          sector: String(r[sectorIdx] || '').trim(),
          macroFamily: String(r[macroIdx] || '').trim(),
          family: String(r[famIdx] || '').trim(),
          group: String(r[groupIdx] || '').trim(),
          price: Number.isFinite(price) ? price : 0,
          stock: Number.isFinite(stock) ? stock : 0,
          imageRef: String(r[disegnoIdx] || r[imageIdx] || '').trim(),
          imageUrl: String(r[imageIdx] || '').trim(),
          discountCode: String(r[discCodeIdx] || '').trim(),
          maxDiscount: Number.isFinite(maxDisc) ? Math.min(100, Math.max(0, maxDisc)) : 60,
          vat: 22
        });
      }

      if (products.length > 0) {
        return { ok: true, source: 'google-sheets', count: products.length, products };
      }
      return { ok: false, source: 'google-sheets', error: `Nessun articolo valido trovato nella scheda "${tab}"`, count: 0 };
    }
    return { ok: false, source: 'google-sheets', error: `Scheda "${tab}" non trovata o senza intestazione`, count: 0 };
  } catch (err) {
    console.warn('Google Sheets products read error:', err.message);
    const seed = await loadSeed();
    return { ok: false, source: 'offline-cache', error: err.message, count: (seed.articles || []).length, products: seed.articles || [] };
  }
}

// 5. Diagnostics Runner
async function runDiagnostics(testCfg = {}) {
  const cfg = {
    companyId: testCfg.companyId || runtimeConfig.company.spreadsheetId,
    companyTab: testCfg.companyTab || runtimeConfig.company.tab,
    agentsId: testCfg.agentsId || runtimeConfig.agents.spreadsheetId,
    agentsTab: testCfg.agentsTab || runtimeConfig.agents.tab,
    customersId: testCfg.customersId || runtimeConfig.customers.spreadsheetId,
    customersTab: testCfg.customersTab || runtimeConfig.customers.tab,
    productsId: testCfg.productsId || runtimeConfig.products.spreadsheetId,
    productsTab: testCfg.productsTab || runtimeConfig.products.tab,
    registerId: testCfg.registerId || runtimeConfig.repository.spreadsheetId,
    registerTabOffers: testCfg.registerTabOffers || runtimeConfig.repository.tabOffers || 'Offerte',
    registerTabOrders: testCfg.registerTabOrders || runtimeConfig.repository.tabOrders || 'Ordini'
  };

  const results = {
    timestamp: new Date().toISOString(),
    googleSheetsApi: { status: 'pending', icon: '⏳', label: 'Verifica in corso' },
    company: { status: 'pending', icon: '⏳', label: 'Verifica in corso' },
    agents: { status: 'pending', icon: '⏳', label: 'Verifica in corso' },
    customers: { status: 'pending', icon: '⏳', label: 'Verifica in corso' },
    products: { status: 'pending', icon: '⏳', label: 'Verifica in corso' },
    repository: { status: 'pending', icon: '⏳', label: 'Verifica in corso' }
  };

  // Check 1: Google Sheets API Token
  let hasGoogle = false;
  try {
    await googleToken();
    hasGoogle = true;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
    results.googleSheetsApi = {
      status: 'ok',
      icon: '🟢',
      label: 'Collegato',
      message: 'Account di servizio autenticato con Google OAuth 2.0',
      details: email ? `Service Account: ${email}` : 'Autenticato con chiave di servizio'
    };
  } catch (err) {
    results.googleSheetsApi = {
      status: 'error',
      icon: '🔴',
      label: 'Non collegato',
      message: err.message,
      details: 'Verificare GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY nelle impostazioni Netlify'
    };
  }

  // Check 2: Dati Azienda
  if (hasGoogle) {
    try {
      const rows = await readRange(cfg.companyId, `'${cfg.companyTab}'!A1:D45`);
      let foundName = '';
      for (const r of rows) {
        if (r[0] === 'AZ001' || r[0] === 'AZ002') {
          foundName = String(r[3] || '').trim();
          if (foundName) break;
        }
      }
      results.company = {
        status: 'ok',
        icon: '🟢',
        label: 'Letto',
        message: foundName ? `Dati azienda letti (${foundName})` : 'Dati azienda letti correttamente',
        details: `Foglio ID: ${cfg.companyId} · Tab: ${cfg.companyTab}`
      };
    } catch (err) {
      results.company = {
        status: 'error',
        icon: '🔴',
        label: 'Errore lettura',
        message: err.message,
        details: `Impossibile leggere il foglio "${cfg.companyTab}" (ID: ${cfg.companyId})`
      };
    }
  } else {
    results.company = {
      status: 'warning',
      icon: '🟡',
      label: 'Copia locale attiva',
      message: 'Uso dati locali di fallback (Pascal Milano 2)',
      details: 'Connessione Google Sheets API non attiva'
    };
  }

  // Check 3: Agenti
  if (hasGoogle) {
    try {
      const agRes = await fetchAgentsData(cfg.agentsId, cfg.agentsTab);
      if (agRes.source === 'google-sheets' && agRes.count > 0) {
        results.agents = {
          status: 'ok',
          icon: '🟢',
          label: `${agRes.count} record`,
          count: agRes.count,
          message: `${agRes.count} agenti configurati nel foglio`,
          details: `Foglio ID: ${cfg.agentsId} · Tab: ${cfg.agentsTab}`
        };
      } else {
        const isWrongSheet = agRes.error && (agRes.error.includes('Unable to parse range') || agRes.error.includes('not found') || agRes.error.includes('permission'));
        results.agents = {
          status: 'error',
          icon: '🔴',
          label: 'Nessun record',
          count: 0,
          message: agRes.error || 'Nessun agente trovato nella scheda specificata',
          details: isWrongSheet ? `Scheda "${cfg.agentsTab}" non trovata nel foglio ID ${cfg.agentsId}. Inserire lo Spreadsheet ID del file "Anagrafica_Agenti"` : (agRes.error || `Verificare ID foglio e tab "${cfg.agentsTab}"`)
        };
      }
    } catch (err) {
      results.agents = {
        status: 'error',
        icon: '🔴',
        label: 'Errore lettura',
        count: 0,
        message: err.message,
        details: `Foglio ID: ${cfg.agentsId} · Tab: ${cfg.agentsTab}`
      };
    }
  } else {
    results.agents = {
      status: 'warning',
      icon: '🟡',
      label: '11 record (offline)',
      count: 11,
      message: '11 agenti caricati dal pacchetto offline locale',
      details: 'Connessione Google Sheets API non attiva'
    };
  }

  // Check 4: Clienti
  if (hasGoogle) {
    try {
      const clRes = await fetchCustomersData(cfg.customersId, cfg.customersTab);
      if (clRes.source === 'google-sheets' && clRes.count > 0) {
        results.customers = {
          status: 'ok',
          icon: '🟢',
          label: `${clRes.count} record caricati`,
          count: clRes.count,
          message: `${clRes.count} clienti importati con successo`,
          details: `Foglio ID: ${cfg.customersId} · Tab: ${cfg.customersTab}`
        };
      } else {
        const isWrongSheet = clRes.error && (clRes.error.includes('Unable to parse range') || clRes.error.includes('not found') || clRes.error.includes('permission'));
        results.customers = {
          status: 'error',
          icon: '🔴',
          label: 'Nessun cliente',
          count: 0,
          message: clRes.error || 'Nessun cliente rilevato nel foglio',
          details: isWrongSheet ? `Scheda "${cfg.customersTab}" non trovata nel foglio ID ${cfg.customersId}. Inserire lo Spreadsheet ID del file "clienti"` : (clRes.error || `Foglio ID: ${cfg.customersId} · Tab: ${cfg.customersTab}`)
        };
      }
    } catch (err) {
      results.customers = {
        status: 'error',
        icon: '🔴',
        label: 'Errore lettura',
        count: 0,
        message: err.message,
        details: `Foglio ID: ${cfg.customersId} · Tab: ${cfg.customersTab}`
      };
    }
  } else {
    results.customers = {
      status: 'warning',
      icon: '🟡',
      label: '11 record caricati (offline)',
      count: 11,
      message: '11 clienti caricati dal pacchetto offline locale',
      details: 'Connessione Google Sheets API non attiva'
    };
  }

  // Check 5: Articoli
  if (hasGoogle) {
    try {
      const prRes = await fetchProductsData(cfg.productsId, cfg.productsTab);
      if (prRes.source === 'google-sheets' && prRes.count > 0) {
        results.products = {
          status: 'ok',
          icon: '🟢',
          label: `${prRes.count} record caricati`,
          count: prRes.count,
          message: `${prRes.count} articoli nel catalogo listino`,
          details: `Foglio ID: ${cfg.productsId} · Tab: ${cfg.productsTab}`
        };
      } else {
        const isWrongSheet = prRes.error && (prRes.error.includes('Unable to parse range') || prRes.error.includes('not found') || prRes.error.includes('permission'));
        results.products = {
          status: 'error',
          icon: '🔴',
          label: 'Nessun articolo',
          count: 0,
          message: prRes.error || 'Nessun articolo rilevato nel foglio',
          details: isWrongSheet ? `Scheda "${cfg.productsTab}" non trovata nel foglio ID ${cfg.productsId}. Inserire lo Spreadsheet ID del file "Articoli"` : (prRes.error || `Foglio ID: ${cfg.productsId} · Tab: ${cfg.productsTab}`)
        };
      }
    } catch (err) {
      results.products = {
        status: 'error',
        icon: '🔴',
        label: 'Errore lettura',
        count: 0,
        message: err.message,
        details: `Foglio ID: ${cfg.productsId} · Tab: ${cfg.productsTab}`
      };
    }
  } else {
    results.products = {
      status: 'warning',
      icon: '🟡',
      label: '25 record caricati (offline)',
      count: 25,
      message: '25 articoli caricati dal listino offline locale',
      details: 'Connessione Google Sheets API non attiva'
    };
  }

  // Check 6: Repository
  if (hasGoogle) {
    try {
      // Check headers on Offerte and Ordini
      await ensureHeader(cfg.registerTabOffers, registerHeaders, cfg.registerId);
      await ensureHeader(cfg.registerTabOrders, registerHeaders, cfg.registerId);
      results.repository = {
        status: 'ok',
        icon: '🟢',
        label: 'Scrittura attiva',
        message: 'Permessi di scrittura e struttura schede confermati',
        details: `Foglio ID: ${cfg.registerId} · Schede "${cfg.registerTabOffers}" e "${cfg.registerTabOrders}"`
      };
    } catch (err) {
      results.repository = {
        status: 'error',
        icon: '🔴',
        label: 'Errore repository',
        message: err.message,
        details: `Verificare che il foglio ID ${cfg.registerId} sia condiviso come Editor con l'account di servizio`
      };
    }
  } else {
    results.repository = {
      status: 'warning',
      icon: '🟡',
      label: 'Coda locale attiva',
      message: 'Offerte e ordini salvati nella coda del browser',
      details: 'Connessione Google Sheets API non attiva'
    };
  }

  return results;
}

// 6. Repository Register
const registerHeaders = ['id', 'number', 'submitted_at', 'updated_at', 'agent_code', 'agent_name', 'customer_id', 'customer_name', 'total', 'currency', 'status', 'version', 'payload_json'];

function parseTotal(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[^0-9,.-]/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : 0;
}

function cleanCell(val) {
  if (val == null) return '';
  return String(val).trim().replace(/^["']|["']$/g, '');
}

async function ensureHeader(tab, headers, customRegId) {
  const regId = customRegId || runtimeConfig.repository.spreadsheetId;
  const current = await readRange(regId, `'${tab}'!A1:Z5`);
  if (!current.length || !current.some(r => r && r.length > 0)) {
    await append(regId, `'${tab}'!A1`, [headers]);
  }
}

async function listDocs(tab, user) {
  const regId = runtimeConfig.repository.spreadsheetId;
  try {
    const rawRows = await readRange(regId, `'${tab}'!A1:Z1000`);
    if (!rawRows || !rawRows.length) return [];

    // Dynamically locate header row within first 10 rows
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const line = (rawRows[i] || []).map(c => String(c || '').toLowerCase().trim());
      if (
        line.includes('id') ||
        line.includes('id record') ||
        line.some(c => c.includes('numero documento') || c.includes('numero ordine') || c.includes('codice agente') || c.includes('submitted_at'))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx < 0) {
      headerIdx = 0;
    }

    const header = (rawRows[headerIdx] || []).map(c => String(c || '').toLowerCase().trim());
    const findCol = (patterns, excludes = []) => {
      for (let k = 0; k < header.length; k++) {
        const h = header[k];
        const match = patterns.some(p => h === p || h.includes(p));
        if (match && !excludes.some(ex => h.includes(ex))) {
          return k;
        }
      }
      return -1;
    };

    const idIdx = findCol(['id record', 'id']);
    const numIdx = findCol(['numero documento', 'numero ordine', 'number'], ['id']);
    const subIdx = findCol(['data invio', 'submitted_at', 'data']);
    const updIdx = findCol(['ultimo aggiornamento', 'updated_at']);
    const agCodeIdx = findCol(['codice agente', 'agent_code']);
    const agNameIdx = findCol(['agente', 'agent_name', 'nome agente'], ['codice']);
    const custIdIdx = findCol(['codice cliente', 'customer_id']);
    const custNameIdx = findCol(['ragione sociale', 'cliente', 'customer_name'], ['codice']);
    const totalIdx = findCol(['totale', 'total', 'importo', 'imponibile']);
    const currIdx = findCol(['valuta', 'currency']);
    const statusIdx = findCol(['stato applicazione', 'stato avanzamento', 'status']);
    const outcomeIdx = findCol(['esito azienda', 'esito', 'decisione']);
    const verIdx = findCol(['versione', 'version']);
    const notesIdx = findCol(['nota azienda', 'note operative', 'note', 'payload_json']);
    const origOfferIdx = findCol(['id offerta origine', 'offerta origine']);

    // Allowed agents for user role
    const userRole = user?.role || 'agent';
    const userAgentCode = normalizeAgentId(user?.agentCode || '');
    const allowedAgents = new Set();
    if (userRole !== 'admin') {
      if (userAgentCode) allowedAgents.add(userAgentCode);
      const seed = await loadSeed();
      const hier = seed.hierarchy || { AG01: ['AG02'], AG03: ['AG04', 'AG05', 'AG06', 'AG07', 'AG08', 'AG09', 'AG10', 'AG11'] };
      if (hier[userAgentCode]) {
        for (const sub of hier[userAgentCode]) allowedAgents.add(normalizeAgentId(sub));
      }
    }

    const docs = [];
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (!r || !r.some(cell => String(cell || '').trim())) continue;

      const id = idIdx >= 0 && r[idIdx] != null ? cleanCell(r[idIdx]) : '';
      const num = numIdx >= 0 && r[numIdx] != null ? cleanCell(r[numIdx]) : '';
      if (!id && !num) continue;

      const agCode = agCodeIdx >= 0 && r[agCodeIdx] != null ? normalizeAgentId(r[agCodeIdx]) : '';
      if (userRole !== 'admin' && allowedAgents.size > 0 && agCode && !allowedAgents.has(agCode)) {
        continue;
      }

      const total = totalIdx >= 0 ? parseTotal(r[totalIdx]) : 0;
      const subAt = subIdx >= 0 && r[subIdx] != null ? cleanCell(r[subIdx]) : '';
      const updAt = updIdx >= 0 && r[updIdx] != null ? cleanCell(r[updIdx]) : '';
      const agName = agNameIdx >= 0 && r[agNameIdx] != null ? cleanCell(r[agNameIdx]) : (knownAgentNames[agCode] || (agCode ? `Agente ${agCode}` : ''));
      const custId = custIdIdx >= 0 && r[custIdIdx] != null ? cleanCell(r[custIdIdx]) : '';
      const custName = custNameIdx >= 0 && r[custNameIdx] != null ? cleanCell(r[custNameIdx]) : '';
      const curr = currIdx >= 0 && r[currIdx] != null ? cleanCell(r[currIdx]) : 'EUR';
      const outcome = outcomeIdx >= 0 && r[outcomeIdx] != null ? cleanCell(r[outcomeIdx]) : '';
      const rawStatus = statusIdx >= 0 && r[statusIdx] != null ? cleanCell(r[statusIdx]) : '';
      const status = outcome || rawStatus || 'Registrato';
      const version = verIdx >= 0 && r[verIdx] != null ? cleanCell(r[verIdx]) : '1';
      const notes = notesIdx >= 0 && r[notesIdx] != null ? cleanCell(r[notesIdx]) : '';
      const originOffer = origOfferIdx >= 0 && r[origOfferIdx] != null ? cleanCell(r[origOfferIdx]) : '';

      docs.push({
        id: id || num,
        number: num,
        offer_number: tab === 'Offerte' ? num : undefined,
        order_number: tab === 'Ordini' ? num : undefined,
        offerNumber: tab === 'Offerte' ? num : undefined,
        orderNumber: tab === 'Ordini' ? num : undefined,
        submitted_at: subAt,
        updated_at: updAt || subAt,
        agent_code: agCode,
        agent_name: agName,
        customer_id: custId,
        customer_name: custName,
        customerName: custName,
        total,
        currency: curr || 'EUR',
        status,
        raw_status: rawStatus,
        outcome,
        version,
        notes,
        origin_offer_id: originOffer
      });
    }

    return docs;
  } catch (err) {
    console.warn(`Error reading ${tab} from Google Sheets:`, err.message);
    return [];
  }
}

async function createDoc(tab, body, user) {
  const regId = runtimeConfig.repository.spreadsheetId;
  const number = body.offerNumber || body.orderNumber;
  const id = body.id || crypto.randomUUID();
  if (!number || !body.customerName) {
    return json(400, { error: 'Dati incompleti (manca numero documento o ragione sociale cliente)' });
  }

  const now = new Date().toISOString();
  const agentCode = normalizeAgentId(user?.agentCode || body.agentCode || 'AG01');
  const agentName = user?.name || body.agentName || knownAgentNames[agentCode] || 'Agente';
  const customerId = String(body.customerId || '').trim();
  const customerName = String(body.customerName || '').trim();
  const total = Number(body.total) || 0;
  const payloadStr = JSON.stringify(body.payload || {});

  try {
    const rawRows = await readRange(regId, `'${tab}'!A1:Z10`);
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const line = (rawRows[i] || []).map(c => String(c || '').toLowerCase().trim());
      if (
        line.includes('id') ||
        line.includes('id record') ||
        line.some(c => c.includes('numero documento') || c.includes('numero ordine') || c.includes('codice agente'))
      ) {
        headerIdx = i;
        break;
      }
    }

    let row;
    if (headerIdx >= 0) {
      const header = (rawRows[headerIdx] || []).map(c => String(c || '').toLowerCase().trim());
      const isOfficialTemplate = header.some(h => h.includes('esito azienda') || h.includes('stato avanzamento') || h.includes('id record'));

      if (isOfficialTemplate) {
        if (tab === 'Offerte') {
          row = [
            id,
            number,
            now,
            now,
            agentCode,
            agentName,
            customerId,
            customerName,
            total,
            'EUR',
            'submitted',
            1.0,
            'Da valutare',
            '',
            '',
            'No',
            now,
            payloadStr
          ];
        } else {
          row = [
            id,
            number,
            body.originOfferId || '',
            now,
            now,
            agentCode,
            agentName,
            customerId,
            customerName,
            total,
            'EUR',
            'submitted',
            1.0,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            'No',
            now
          ];
        }
      } else {
        row = [
          id,
          number,
          now,
          now,
          agentCode,
          agentName,
          customerId,
          customerName,
          total,
          'EUR',
          'submitted',
          1,
          payloadStr
        ];
      }
    } else {
      await ensureHeader(tab, registerHeaders, regId);
      row = [
        id,
        number,
        now,
        now,
        agentCode,
        agentName,
        customerId,
        customerName,
        total,
        'EUR',
        'submitted',
        1,
        payloadStr
      ];
    }

    await append(regId, `'${tab}'!A:Z`, [row]);
    return json(201, { ok: true, id, number, timestamp: now });
  } catch (err) {
    console.error(`Error saving ${tab} to Google Sheets:`, err);
    return json(500, { error: `Errore salvataggio su Google Sheets: ${err.message}` });
  }
}

// Netlify Function Entry Point
export default async (request, context) => {
  try {
    const url = new URL(request.url);
    const path = (context.params?.splat || url.pathname.split('/api/')[1] || '').replace(/^\/+|\/+$/g, '');

    // Auth endpoints
    if (path === 'login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const user = users().find(x => x.username === body.username && x.password === body.password);
      if (!user) {
        return json(401, { error: 'Credenziali non valide. Riprova con i dati forniti dall’amministrazione.' });
      }
      return json(200, { ok: true, user: { username: user.username, name: user.name, role: user.role, agentCode: user.agentCode } }, { 'set-cookie': sessionCookie(user) });
    }

    if (path === 'logout') {
      return json(200, { ok: true }, { 'set-cookie': 'oa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
    }

    // Diagnostics endpoint (accessible for admin check & configurazione)
    if (path === 'diagnostics') {
      let testCfg = {};
      if (request.method === 'POST') {
        testCfg = await request.json().catch(() => ({}));
      }
      const diag = await runDiagnostics(testCfg);
      return json(200, { ok: true, diagnostics: diag, config: runtimeConfig });
    }

    // Config endpoints
    if (path === 'config') {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (body && typeof body === 'object') {
          if (body.company) runtimeConfig.company = { ...runtimeConfig.company, ...body.company };
          if (body.agents) runtimeConfig.agents = { ...runtimeConfig.agents, ...body.agents };
          if (body.customers) runtimeConfig.customers = { ...runtimeConfig.customers, ...body.customers };
          if (body.products) runtimeConfig.products = { ...runtimeConfig.products, ...body.products };
          if (body.repository) runtimeConfig.repository = { ...runtimeConfig.repository, ...body.repository };
          if (body.googleDrive) runtimeConfig.googleDrive = { ...runtimeConfig.googleDrive, ...body.googleDrive };
        }
        return json(200, { ok: true, config: runtimeConfig, message: 'Configurazione aggiornata con successo' });
      }
      return json(200, { ok: true, config: runtimeConfig });
    }

    // Public / App data endpoints (with offline fallback & live Google Sheets)
    if (path === 'company' && request.method === 'GET') {
      const compRes = await fetchCompanyData();
      return json(200, compRes);
    }

    if (path === 'settings' && request.method === 'GET') {
      const compRes = await fetchCompanyData();
      const user = session(request);
      return json(200, { settings: { company_profile: compRes.company }, company: compRes.company, canEdit: user?.role === 'admin' });
    }

    if (path === 'agents' && request.method === 'GET') {
      const agRes = await fetchAgentsData();
      return json(200, agRes);
    }

    if (path === 'customers' && request.method === 'GET') {
      const user = session(request);
      const clRes = await fetchCustomersData(undefined, undefined, user);
      return json(200, clRes);
    }

    if (path === 'products' && request.method === 'GET') {
      const prRes = await fetchProductsData();
      return json(200, prRes);
    }

    // Protected endpoints requiring session
    const user = session(request);

    if (path === 'session') {
      if (!user) return json(401, { error: 'Sessione scaduta o non attiva' });
      return json(200, { user });
    }

    if (path === 'offers' && request.method === 'GET') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      return json(200, { offers: await listDocs(runtimeConfig.repository.tabOffers || 'Offerte', user), user });
    }

    if (path === 'orders' && request.method === 'GET') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      return json(200, { orders: await listDocs(runtimeConfig.repository.tabOrders || 'Ordini', user), user });
    }

    if (path === 'offers' && request.method === 'POST') {
      return createDoc(runtimeConfig.repository.tabOffers || 'Offerte', await request.json(), user);
    }

    if (path === 'orders' && request.method === 'POST') {
      return createDoc(runtimeConfig.repository.tabOrders || 'Ordini', await request.json(), user);
    }

    return json(404, { error: 'Servizio non disponibile: ' + path });
  } catch (error) {
    console.error('API Error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Errore inatteso nel servizio API' });
  }
};
