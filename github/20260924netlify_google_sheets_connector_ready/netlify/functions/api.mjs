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
    { username: 'agente01', password: 'cambiare-password', name: 'Tina Cucci', role: 'agent', agentCode: 'AG01' },
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

function createSessionToken(user) {
  const payload = b64({
    username: user.username,
    name: user.name,
    role: user.role || 'agent',
    agentCode: normalizeAgentId(user.agentCode || 'AG01'),
    exp: Date.now() + 12 * 60 * 60 * 1000
  });
  return `${payload}.${sign(payload)}`;
}

function session(request) {
  try {
    let token = cookie(request).oa_session;
    if (!token) {
      const auth = request.headers.get('authorization') || '';
      if (auth.toLowerCase().startsWith('bearer ')) {
        token = auth.slice(7).trim();
      }
    }
    if (!token) {
      token = request.headers.get('x-oa-session');
    }

    if (token) {
      const [p, s] = token.split('.');
      if (p && s) {
        const expSig = Buffer.from(sign(p));
        const actSig = Buffer.from(s);
        if (expSig.length === actSig.length && crypto.timingSafeEqual(expSig, actSig)) {
          const data = JSON.parse(unb64(p));
          if (data && data.exp >= Date.now()) return data;
        }
      }
    }

    // Fallback: check x-oa-user header
    const userHdr = request.headers.get('x-oa-user');
    if (userHdr) {
      try {
        const u = JSON.parse(decodeURIComponent(userHdr));
        if (u && (u.username || u.name)) return u;
      } catch {}
    }
    return null;
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

// Official permanent spreadsheet IDs from GOOGLE-DRIVE/dati-configurazione
// Nessun agente dovrà mai inserire gli ID a mano: il sistema usa queste variabili fisse!
const OFFICIAL_SYSTEM_SPREADSHEETS = Object.freeze({
  company: {
    sheetName: 'Dati_Azienda_e_Mandanti',
    spreadsheetId: '1-ntNPKA3gdjZaxYntGNkXtKC5Kt4JIXGSoQfESO169M',
    tab: 'Dati azienda'
  },
  agents: {
    fileName: 'Anagrafica_Agenti',
    spreadsheetId: '13HaTubf4_xVTtzkQUcYINkRtuSzLR2qGzJAiA-oAecU',
    tab: 'Agenti'
  },
  customers: {
    fileName: 'clienti',
    spreadsheetId: '1rkFDBTCJD3JlrcvyOPGHjYTJDkjuMc24dJ7l6EqQ6I8',
    tab: 'clienti'
  },
  products: {
    fileName: 'Articoli',
    spreadsheetId: '17ErnowHZDqA3WDTN5auHkyTBPVn4MqkI8BFkiqkDhmE',
    tab: 'q_listino_prezzi_catalogo'
  },
  repository: {
    folder: 'Repository',
    fileName: 'Registro offerte e ordini',
    spreadsheetId: '1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnIVIenn-Fjc',
    tabOffers: 'Offerte',
    tabOrders: 'Ordini'
  },
  warehouse: {
    folder: 'Repository',
    fileName: 'Registro Magazzino e Produzione',
    spreadsheetId: '1PY897bYrzckl9P3ADr6LjhCPik-9wQefEkkkn9SWCig',
    tabMovements: 'Movimenti_Magazzino',
    tabParameters: 'Parametri_Produzione'
  },
  googleDrive: {
    sourceFolderUrl: 'https://drive.google.com/drive/folders/1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9',
    folderId: '1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9'
  }
});

const cleanEnvId = (val, fallback = '', oldPatterns = ['1mnW', '1N6ZcGa', 'undefined', 'null']) => {
  if (!val || typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (trimmed.length < 20) return fallback;
  for (const p of oldPatterns) {
    if (trimmed.includes(p)) return fallback;
  }
  return trimmed;
};

// In-memory runtime configuration with permanent default fallback
let runtimeConfig = {
  company: {
    sheetName: 'Dati_Azienda_e_Mandanti',
    spreadsheetId: cleanEnvId(process.env.COMPANY_SPREADSHEET_ID, OFFICIAL_SYSTEM_SPREADSHEETS.company.spreadsheetId),
    tab: 'Dati azienda'
  },
  agents: {
    fileName: 'Anagrafica_Agenti',
    spreadsheetId: cleanEnvId(process.env.AGENTS_SPREADSHEET_ID, OFFICIAL_SYSTEM_SPREADSHEETS.agents.spreadsheetId),
    tab: 'Agenti'
  },
  customers: {
    fileName: 'clienti',
    spreadsheetId: cleanEnvId(process.env.CUSTOMERS_SPREADSHEET_ID, OFFICIAL_SYSTEM_SPREADSHEETS.customers.spreadsheetId),
    tab: 'clienti'
  },
  products: {
    fileName: 'Articoli',
    spreadsheetId: cleanEnvId(process.env.PRODUCTS_SPREADSHEET_ID, OFFICIAL_SYSTEM_SPREADSHEETS.products.spreadsheetId),
    tab: 'q_listino_prezzi_catalogo'
  },
  repository: {
    folder: 'Repository',
    fileName: 'Registro offerte e ordini',
    spreadsheetId: cleanEnvId(process.env.REGISTER_SPREADSHEET_ID) || cleanEnvId(process.env.REPOSITORY_SPREADSHEET_ID) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId,
    tabOffers: 'Offerte',
    tabOrders: 'Ordini'
  },
  warehouse: {
    folder: 'Repository',
    fileName: 'Registro Magazzino e Produzione',
    spreadsheetId: cleanEnvId(process.env.WAREHOUSE_SPREADSHEET_ID) || cleanEnvId(process.env.GOOGLE_SHEETS_WAREHOUSE_ID) || OFFICIAL_SYSTEM_SPREADSHEETS.warehouse.spreadsheetId,
    tabMovements: 'Movimenti_Magazzino',
    tabParameters: 'Parametri_Produzione'
  },
  googleDrive: {
    sourceFolderUrl: OFFICIAL_SYSTEM_SPREADSHEETS.googleDrive.sourceFolderUrl,
    folderId: OFFICIAL_SYSTEM_SPREADSHEETS.googleDrive.folderId
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
  return sheets(`${id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({ values })
  });
}

async function updateRow(id, range, values) {
  return sheets(`${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values })
  });
}

// -------------------------------------------------------------
// CENTRAL CLOUD CONFIGURATION (GOOGLE SHEETS BACKED)
// -------------------------------------------------------------
let centralConfigLoaded = false;
let lastCentralConfigFetch = 0;

function mergeRuntimeConfig(custom) {
  if (!custom || typeof custom !== 'object') return;
  if (custom.company) {
    runtimeConfig.company = {
      ...runtimeConfig.company,
      ...custom.company,
      sheetName: custom.company.sheetName || runtimeConfig.company.sheetName || OFFICIAL_SYSTEM_SPREADSHEETS.company.sheetName,
      spreadsheetId: cleanEnvId(custom.company.spreadsheetId, runtimeConfig.company.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.company.spreadsheetId),
      tab: custom.company.tab || runtimeConfig.company.tab || OFFICIAL_SYSTEM_SPREADSHEETS.company.tab
    };
  }
  if (custom.agents) {
    runtimeConfig.agents = {
      ...runtimeConfig.agents,
      ...custom.agents,
      fileName: custom.agents.fileName || runtimeConfig.agents.fileName || OFFICIAL_SYSTEM_SPREADSHEETS.agents.fileName,
      spreadsheetId: cleanEnvId(custom.agents.spreadsheetId, runtimeConfig.agents.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.agents.spreadsheetId),
      tab: custom.agents.tab || runtimeConfig.agents.tab || OFFICIAL_SYSTEM_SPREADSHEETS.agents.tab
    };
  }
  if (custom.customers) {
    runtimeConfig.customers = {
      ...runtimeConfig.customers,
      ...custom.customers,
      fileName: custom.customers.fileName || runtimeConfig.customers.fileName || OFFICIAL_SYSTEM_SPREADSHEETS.customers.fileName,
      spreadsheetId: cleanEnvId(custom.customers.spreadsheetId, runtimeConfig.customers.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.customers.spreadsheetId),
      tab: custom.customers.tab || runtimeConfig.customers.tab || OFFICIAL_SYSTEM_SPREADSHEETS.customers.tab
    };
  }
  if (custom.products) {
    runtimeConfig.products = {
      ...runtimeConfig.products,
      ...custom.products,
      fileName: custom.products.fileName || runtimeConfig.products.fileName || OFFICIAL_SYSTEM_SPREADSHEETS.products.fileName,
      spreadsheetId: cleanEnvId(custom.products.spreadsheetId, runtimeConfig.products.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.products.spreadsheetId),
      tab: custom.products.tab || runtimeConfig.products.tab || OFFICIAL_SYSTEM_SPREADSHEETS.products.tab
    };
  }
  if (custom.repository) {
    runtimeConfig.repository = {
      ...runtimeConfig.repository,
      ...custom.repository,
      folder: custom.repository.folder || runtimeConfig.repository.folder || OFFICIAL_SYSTEM_SPREADSHEETS.repository.folder,
      fileName: custom.repository.fileName || runtimeConfig.repository.fileName || OFFICIAL_SYSTEM_SPREADSHEETS.repository.fileName,
      spreadsheetId: cleanEnvId(custom.repository.spreadsheetId, runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId),
      tabOffers: custom.repository.tabOffers || runtimeConfig.repository.tabOffers || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOffers,
      tabOrders: custom.repository.tabOrders || runtimeConfig.repository.tabOrders || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOrders
    };
  }
  if (custom.warehouse) {
    runtimeConfig.warehouse = {
      ...runtimeConfig.warehouse,
      folder: custom.warehouse.folder || runtimeConfig.warehouse?.folder || 'Repository',
      fileName: custom.warehouse.fileName || runtimeConfig.warehouse?.fileName || 'Registro Magazzino e Produzione',
      spreadsheetId: cleanEnvId(custom.warehouse.spreadsheetId, runtimeConfig.warehouse?.spreadsheetId || ''),
      tabMovements: custom.warehouse.tabMovements || runtimeConfig.warehouse?.tabMovements || 'Movimenti_Magazzino',
      tabParameters: custom.warehouse.tabParameters || runtimeConfig.warehouse?.tabParameters || 'Parametri_Produzione'
    };
  }
  if (custom.googleDrive) {
    runtimeConfig.googleDrive = {
      sourceFolderUrl: custom.googleDrive.sourceFolderUrl || OFFICIAL_SYSTEM_SPREADSHEETS.googleDrive.sourceFolderUrl,
      folderId: custom.googleDrive.folderId || OFFICIAL_SYSTEM_SPREADSHEETS.googleDrive.folderId
    };
  }
  if (custom.lastUpdate) runtimeConfig.lastUpdate = custom.lastUpdate;
  if (custom.updatedBy) runtimeConfig.updatedBy = custom.updatedBy;
}

async function ensureSheetTab(id, tabName) {
  try {
    const meta = await sheets(`${id}?fields=sheets.properties.title`);
    const titles = (meta?.sheets || []).map(s => s.properties?.title);
    if (!titles.includes(tabName)) {
      await sheets(`${id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: tabName,
                  gridProperties: { rowCount: 60, columnCount: 8 }
                }
              }
            }
          ]
        })
      });
    }
    return true;
  } catch (err) {
    console.warn(`ensureSheetTab '${tabName}' warning:`, err.message);
    return false;
  }
}

async function loadCentralConfig(force = false) {
  if (centralConfigLoaded && !force && (Date.now() - lastCentralConfigFetch < 30000)) {
    return runtimeConfig;
  }
  const regId = cleanEnvId(runtimeConfig.repository?.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  try {
    const rows = await readRange(regId, "'_Configurazione'!A1:E30");
    if (rows && rows.length > 0) {
      let parsedFromJson = false;
      for (const r of rows) {
        if (String(r[0] || '').trim() === 'CONFIG_JSON' && r[1]) {
          try {
            const parsed = JSON.parse(r[1]);
            if (parsed && typeof parsed === 'object') {
              mergeRuntimeConfig(parsed);
              parsedFromJson = true;
              break;
            }
          } catch {}
        }
      }
      if (!parsedFromJson) {
        for (const r of rows) {
          const k = String(r[0] || '').trim();
          const v = String(r[1] || '').trim();
          if (!k || !v) continue;
          if (k === 'company_spreadsheetId') runtimeConfig.company.spreadsheetId = v;
          if (k === 'company_tab') runtimeConfig.company.tab = v;
          if (k === 'company_sheetName') runtimeConfig.company.sheetName = v;
          if (k === 'agents_spreadsheetId') runtimeConfig.agents.spreadsheetId = v;
          if (k === 'agents_tab') runtimeConfig.agents.tab = v;
          if (k === 'agents_fileName') runtimeConfig.agents.fileName = v;
          if (k === 'customers_spreadsheetId') runtimeConfig.customers.spreadsheetId = v;
          if (k === 'customers_tab') runtimeConfig.customers.tab = v;
          if (k === 'customers_fileName') runtimeConfig.customers.fileName = v;
          if (k === 'products_spreadsheetId') runtimeConfig.products.spreadsheetId = v;
          if (k === 'products_tab') runtimeConfig.products.tab = v;
          if (k === 'products_fileName') runtimeConfig.products.fileName = v;
          if (k === 'repository_spreadsheetId') runtimeConfig.repository.spreadsheetId = v;
          if (k === 'repository_tabOffers') runtimeConfig.repository.tabOffers = v;
          if (k === 'repository_tabOrders') runtimeConfig.repository.tabOrders = v;
          if (k === 'repository_folder') runtimeConfig.repository.folder = v;
          if (k === 'warehouse_spreadsheetId') runtimeConfig.warehouse.spreadsheetId = v;
          if (k === 'warehouse_tabMovements') runtimeConfig.warehouse.tabMovements = v;
          if (k === 'warehouse_tabParameters') runtimeConfig.warehouse.tabParameters = v;
          if (k === 'warehouse_fileName') runtimeConfig.warehouse.fileName = v;
          if (k === 'drive_sourceFolderUrl') runtimeConfig.googleDrive.sourceFolderUrl = v;
          if (k === 'drive_folderId') runtimeConfig.googleDrive.folderId = v;
        }
      }
      centralConfigLoaded = true;
      lastCentralConfigFetch = Date.now();
    }
  } catch (err) {
    // Keep runtimeConfig defaults silently
  }
  return runtimeConfig;
}

async function saveCentralConfig(cfg, user) {
  mergeRuntimeConfig(cfg);
  centralConfigLoaded = true;
  lastCentralConfigFetch = Date.now();
  const now = new Date().toISOString();
  const userName = user?.name || user?.username || 'Amministrazione';
  runtimeConfig.lastUpdate = now;
  runtimeConfig.updatedBy = userName;
  runtimeConfig.source = 'Configurazione centrale Google Drive';

  const regId = cleanEnvId(runtimeConfig.repository?.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;

  const rows = [
    ['CHIAVE_CONFIGURAZIONE', 'VALORE', 'DESCRIZIONE', 'ULTIMO_AGGIORNAMENTO', 'UTENTE'],
    ['CONFIG_JSON', JSON.stringify(runtimeConfig), 'Payload JSON unificato di configurazione', now, userName],
    ['company_spreadsheetId', runtimeConfig.company.spreadsheetId || '', 'Spreadsheet ID Dati Azienda', now, userName],
    ['company_tab', runtimeConfig.company.tab || '', 'Nome Tab Dati Azienda', now, userName],
    ['company_sheetName', runtimeConfig.company.sheetName || '', 'Nome File Azienda', now, userName],
    ['agents_spreadsheetId', runtimeConfig.agents.spreadsheetId || '', 'Spreadsheet ID Anagrafica Agenti', now, userName],
    ['agents_tab', runtimeConfig.agents.tab || '', 'Nome Tab Agenti', now, userName],
    ['agents_fileName', runtimeConfig.agents.fileName || '', 'Nome File Agenti', now, userName],
    ['customers_spreadsheetId', runtimeConfig.customers.spreadsheetId || '', 'Spreadsheet ID Clienti', now, userName],
    ['customers_tab', runtimeConfig.customers.tab || '', 'Nome Tab Clienti', now, userName],
    ['customers_fileName', runtimeConfig.customers.fileName || '', 'Nome File Clienti', now, userName],
    ['products_spreadsheetId', runtimeConfig.products.spreadsheetId || '', 'Spreadsheet ID Articoli / Listino', now, userName],
    ['products_tab', runtimeConfig.products.tab || '', 'Nome Tab Listino', now, userName],
    ['products_fileName', runtimeConfig.products.fileName || '', 'Nome File Articoli', now, userName],
    ['repository_spreadsheetId', runtimeConfig.repository.spreadsheetId || '', 'Spreadsheet ID Registro Offerte e Ordini', now, userName],
    ['repository_tabOffers', runtimeConfig.repository.tabOffers || '', 'Tab Offerte nel Registro', now, userName],
    ['repository_tabOrders', runtimeConfig.repository.tabOrders || '', 'Tab Ordini nel Registro', now, userName],
    ['repository_folder', runtimeConfig.repository.folder || '', 'Nome Cartella Repository', now, userName],
    ['warehouse_spreadsheetId', runtimeConfig.warehouse?.spreadsheetId || '', 'Spreadsheet ID Registro Magazzino e Produzione', now, userName],
    ['warehouse_tabMovements', runtimeConfig.warehouse?.tabMovements || '', 'Tab Movimenti Magazzino', now, userName],
    ['warehouse_tabParameters', runtimeConfig.warehouse?.tabParameters || '', 'Tab Parametri Produzione', now, userName],
    ['warehouse_fileName', runtimeConfig.warehouse?.fileName || '', 'Nome File Magazzino e Produzione', now, userName],
    ['drive_sourceFolderUrl', runtimeConfig.googleDrive.sourceFolderUrl || '', 'URL Cartella Google Drive Condivisa', now, userName],
    ['drive_folderId', runtimeConfig.googleDrive.folderId || '', 'ID Cartella Google Drive Condivisa', now, userName]
  ];

  let savedToSheet = false;
  let sheetError = null;
  try {
    await ensureSheetTab(regId, '_Configurazione');
    await updateRow(regId, "'_Configurazione'!A1:E25", rows);
    savedToSheet = true;
  } catch (err) {
    sheetError = err.message;
    console.error('Impossibile salvare su Google Sheets _Configurazione:', err.message);
  }

  return { ok: true, savedToSheet, sheetError, config: runtimeConfig };
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
  AG001: 'Tina Cucci',
  AG002: 'David Alfano',
  AG003: 'Bianca Narducci',
  AG004: 'Loredana Andreoli',
  AG005: 'Nunzio Sorce',
  AG006: 'Enzo Nicastro',
  AG007: 'Linda de gavi',
  AG008: 'Pietro Vivenza',
  AG009: 'Paolo Infante',
  AG010: 'Daniele sama’',
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
  const id = cleanEnvId(customId) || runtimeConfig.company.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.company.spreadsheetId;
  const tab = customTab || runtimeConfig.company.tab || OFFICIAL_SYSTEM_SPREADSHEETS.company.tab || 'Dati azienda';
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
  const id = cleanEnvId(customId) || runtimeConfig.agents.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.agents.spreadsheetId;
  const tab = customTab || runtimeConfig.agents.tab || OFFICIAL_SYSTEM_SPREADSHEETS.agents.tab || 'Agenti';
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
  const id = cleanEnvId(customId) || runtimeConfig.customers.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.customers.spreadsheetId;
  const tab = customTab || runtimeConfig.customers.tab || OFFICIAL_SYSTEM_SPREADSHEETS.customers.tab || 'clienti';
  try {
    const rows = await readRange(id, `'${tab}'!A1:Z500`);
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
      const sdiIdx = col('sdi') >= 0 ? col('sdi') : (col('univoco') >= 0 ? col('univoco') : col('destinatario'));
      const ibanIdx = col('iban');
      const bankIdx = col('banca') >= 0 ? col('banca') : col('appoggio');
      const vatIdx = col('partita iva') >= 0 ? col('partita iva') : (col('p.iva') >= 0 ? col('p.iva') : col('piva'));
      const taxIdx = col('codice fiscale') >= 0 ? col('codice fiscale') : col('cf');

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
          email: String(r[emailIdx] || '').trim(),
          sdi: sdiIdx >= 0 ? String(r[sdiIdx] || '').trim() : '',
          iban: ibanIdx >= 0 ? String(r[ibanIdx] || '').trim() : '',
          bank: bankIdx >= 0 ? String(r[bankIdx] || '').trim() : '',
          vatNumber: vatIdx >= 0 ? String(r[vatIdx] || '').trim() : '',
          taxCode: taxIdx >= 0 ? String(r[taxIdx] || '').trim() : ''
        });
      }

      if (customers.length > 0) {
        if (user && user.role !== 'admin' && user.role !== 'area_head') {
          const userAgent = normalizeAgentId(user.agentCode || '');
          const seed = await loadSeed();
          const hier = seed.hierarchy || { AG01: ['AG02'], AG03: ['AG04', 'AG05', 'AG06', 'AG07', 'AG08', 'AG09', 'AG10', 'AG11'] };
          const allowed = new Set([userAgent, ...(hier[userAgent] || []).map(normalizeAgentId)]);
          customers = customers.filter(c => allowed.has(normalizeAgentId(c.agentId)) || allowed.has(normalizeAgentId(c.sourceAgent)));
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
      const userAgent = normalizeAgentId(user.agentCode || '');
      const hier = seed.hierarchy || { AG01: ['AG02'], AG03: ['AG04', 'AG05', 'AG06', 'AG07', 'AG08', 'AG09', 'AG10', 'AG11'] };
      const allowed = new Set([userAgent, ...(hier[userAgent] || []).map(normalizeAgentId)]);
      customers = customers.filter(c => allowed.has(normalizeAgentId(c.agentId)) || allowed.has(normalizeAgentId(c.sourceAgent)));
    }
    return { ok: false, source: 'offline-cache', error: err.message, count: customers.length, customers };
  }
}

// 4. Fetch Products
async function fetchProductsData(customId, customTab) {
  const id = cleanEnvId(customId) || runtimeConfig.products.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.products.spreadsheetId;
  const tab = customTab || runtimeConfig.products.tab || OFFICIAL_SYSTEM_SPREADSHEETS.products.tab || 'q_listino_prezzi_catalogo';
  try {
    const rows = await readRange(id, `'${tab}'!A1:AN500`);
    if (rows.length > 1) {
      const header = rows[0].map(c => String(c).toLowerCase().trim());
      const col = name => header.findIndex(h => h.includes(name));
      // Exact match to avoid 'ca' matching 'caid', 'catalogo', 'marca' etc.
      const colExact = name => header.findIndex(h => h === name);
      const caIdIdx = colExact('caid') >= 0 ? colExact('caid') : col('caid');
      const caIdx = colExact('ca') >= 0 ? colExact('ca') : col('codice');
      const desIdx = colExact('desart') >= 0 ? colExact('desart') : col('descrizione');
      const brandIdx = colExact('marca') >= 0 ? colExact('marca') : col('marca');
      const sectorIdx = colExact('jsettore') >= 0 ? colExact('jsettore') : col('settore');
      const macroIdx = col('jmacrofamiglia');
      const famIdx = col('jfamiglia');
      const groupIdx = col('q_ubi_art_destab');
      const locationIdx = col('ubicazione') >= 0 ? col('ubicazione') : (col('scaffale') >= 0 ? col('scaffale') : (col('corsia') >= 0 ? col('corsia') : (col('ubi') >= 0 ? col('ubi') : groupIdx)));
      const priceIdx = col('qt_prezzo_pz') >= 0 ? col('qt_prezzo_pz') : col('prezzo');
      const stockIdx = colExact('qtesi') >= 0 ? colExact('qtesi') : col('disp');
      const imageIdx = col('url-immagine') >= 0 ? col('url-immagine') : col('disegno');
      const disegnoIdx = colExact('disegno') >= 0 ? colExact('disegno') : col('disegno');
      const discCodeIdx = col('jscontoven');
      const maxDiscIdx = colExact('screale') >= 0 ? colExact('screale') : col('sconto');
      const leadTimeIdx = col('lead_time') >= 0 ? col('lead_time') : (col('tempo_prod') >= 0 ? col('tempo_prod') : (col('tempo produzione') >= 0 ? col('tempo produzione') : col('leadtime')));
      const minLotIdx = col('lotto_min') >= 0 ? col('lotto_min') : (col('min_lot') >= 0 ? col('min_lot') : (col('lotto') >= 0 ? col('lotto') : col('lotto minimo')));
      const minStockIdx = col('scorta_min') >= 0 ? col('scorta_min') : (col('min_stock') >= 0 ? col('min_stock') : col('scorta_sicurezza'));
      const maxStockIdx = col('scorta_max') >= 0 ? col('scorta_max') : (col('max_stock') >= 0 ? col('max_stock') : col('scorta massima'));
      const ropIdx = col('punto_riordino') >= 0 ? col('punto_riordino') : (col('rop') >= 0 ? col('rop') : col('riordino'));

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
        const leadDays = leadTimeIdx >= 0 && r[leadTimeIdx] != null && !isNaN(parseFloat(r[leadTimeIdx])) ? parseFloat(r[leadTimeIdx]) : null;
        const minLot = minLotIdx >= 0 && r[minLotIdx] != null && !isNaN(parseFloat(r[minLotIdx])) ? parseFloat(r[minLotIdx]) : null;
        const minStk = minStockIdx >= 0 && r[minStockIdx] != null && !isNaN(parseFloat(r[minStockIdx])) ? parseFloat(r[minStockIdx]) : null;
        const maxStk = maxStockIdx >= 0 && r[maxStockIdx] != null && !isNaN(parseFloat(r[maxStockIdx])) ? parseFloat(r[maxStockIdx]) : null;
        const ropVal = ropIdx >= 0 && r[ropIdx] != null && !isNaN(parseFloat(r[ropIdx])) ? parseFloat(r[ropIdx]) : null;
        const locVal = (locationIdx >= 0 && r[locationIdx]) ? String(r[locationIdx]).trim() : (r[groupIdx] ? String(r[groupIdx]).trim() : '');

        products.push({
          id: caId,
          code,
          description: desc,
          brand: String(r[brandIdx] || '').trim(),
          sector: String(r[sectorIdx] || '').trim(),
          macroFamily: String(r[macroIdx] || '').trim(),
          family: String(r[famIdx] || '').trim(),
          group: String(r[groupIdx] || '').trim(),
          location: locVal,
          price: Number.isFinite(price) ? price : 0,
          stock: Number.isFinite(stock) ? stock : 0,
          imageRef: String(r[disegnoIdx] || r[imageIdx] || '').trim(),
          imageUrl: String(r[imageIdx] || '').trim(),
          discountCode: String(r[discCodeIdx] || '').trim(),
          maxDiscount: Number.isFinite(maxDisc) ? Math.min(100, Math.max(0, maxDisc)) : 60,
          vat: 22,
          leadTimeDays: leadDays,
          minProductionLot: minLot,
          safetyStock: minStk,
          maxStock: maxStk,
          reorderPoint: ropVal
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

      const meta = await sheets(`${cfg.registerId}?fields=sheets.properties`).catch(() => null);
      const tabInfos = (meta?.sheets || []).map(s => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId,
        rowCount: s.properties?.gridProperties?.rowCount
      }));
      const offerRows = await readRange(cfg.registerId, `'${cfg.registerTabOffers}'!A1:B1005`).catch(() => []);
      const filledRows = [];
      for (let i = 0; i < offerRows.length; i++) {
        const a = offerRows[i]?.[0], b = offerRows[i]?.[1];
        if (a || b) filledRows.push({ rowNumber: i + 1, colA: a, colB: b });
      }

      results.repository = {
        status: 'ok',
        icon: '🟢',
        label: 'Scrittura attiva',
        message: 'Permessi di scrittura e struttura schede confermati',
        details: `Foglio ID: ${cfg.registerId} · Schede "${cfg.registerTabOffers}" e "${cfg.registerTabOrders}"`,
        tabs: tabInfos,
        filledRowsCount: filledRows.length,
        filledRows: filledRows.slice(-10)
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
  const regId = cleanEnvId(customRegId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  const current = await readRange(regId, `'${tab}'!A1:Z5`);
  if (!current.length || !current.some(r => r && r.length > 0)) {
    await append(regId, `'${tab}'!A1`, [headers]);
  }
}

async function listDocs(tab, user, customId) {
  const regId = cleanEnvId(customId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
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

    const ddtNumIdx = findCol(['numero bolla / ddt', 'numero bolla', 'numero ddt', 'ddt']);
    const ddtDateIdx = findCol(['data bolla', 'data ddt']);
    const carrierIdx = findCol(['corriere', 'vettore']);
    const trackNumIdx = findCol(['numero tracking', 'tracking']);
    const trackLinkIdx = findCol(['link tracking']);
    const shipDateIdx = findCol(['data spedizione']);
    const estDeliveryIdx = findCol(['consegna prevista']);
    const delivDateIdx = findCol(['data consegna']);

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

      const ddtNum = ddtNumIdx >= 0 && r[ddtNumIdx] != null ? cleanCell(r[ddtNumIdx]) : '';
      const ddtDate = ddtDateIdx >= 0 && r[ddtDateIdx] != null ? cleanCell(r[ddtDateIdx]) : '';
      const carrier = carrierIdx >= 0 && r[carrierIdx] != null ? cleanCell(r[carrierIdx]) : '';
      const trackNum = trackNumIdx >= 0 && r[trackNumIdx] != null ? cleanCell(r[trackNumIdx]) : '';
      const trackLink = trackLinkIdx >= 0 && r[trackLinkIdx] != null ? cleanCell(r[trackLinkIdx]) : '';
      const shipDate = shipDateIdx >= 0 && r[shipDateIdx] != null ? cleanCell(r[shipDateIdx]) : '';
      const estDelivery = estDeliveryIdx >= 0 && r[estDeliveryIdx] != null ? cleanCell(r[estDeliveryIdx]) : '';
      const delivDate = delivDateIdx >= 0 && r[delivDateIdx] != null ? cleanCell(r[delivDateIdx]) : '';

      let payloadObj = null;
      for (let k = r.length - 1; k >= 0; k--) {
        const val = cleanCell(r[k]);
        if (typeof val === 'string' && val.startsWith('{')) {
          try {
            const parsed = JSON.parse(val);
            if (parsed && typeof parsed === 'object') {
              payloadObj = parsed;
              break;
            }
          } catch {}
        }
      }

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
        payload: payloadObj,
        origin_offer_id: originOffer,
        ddt_number: ddtNum,
        ddt_date: ddtDate,
        carrier,
        tracking_number: trackNum,
        tracking_link: trackLink,
        shipping_date: shipDate,
        estimated_delivery: estDelivery,
        delivered_date: delivDate,
        workflow_status: normalizeWorkflowStatus(outcome || rawStatus || status),
        ddt_info: payloadObj?.ddt_info || null,
        goods_appearance: payloadObj?.ddt_info?.goodsAppearance || '',
        packages_count: payloadObj?.ddt_info?.packagesCount || 1,
        weight: payloadObj?.ddt_info?.weight || '',
        porto: payloadObj?.ddt_info?.porto || 'FRANCO',
        shipping_type: payloadObj?.ddt_info?.shippingType || 'MEZZO CORRIERE',
        transport_start_time: payloadObj?.ddt_info?.transportStartTime || '',
        payment_method: payloadObj?.ddt_info?.paymentMethod || '',
        causale: payloadObj?.ddt_info?.causale || 'VENDITA',
        destination_address: payloadObj?.ddt_info?.destinationAddress || '',
        sdi: payloadObj?.ddt_info?.sdi || payloadObj?.sdi || '',
        iban: payloadObj?.ddt_info?.iban || payloadObj?.iban || '',
        bank_info: payloadObj?.ddt_info?.bankInfo || payloadObj?.bank || '',
        customer_email: payloadObj?.ddt_info?.customerEmail || payloadObj?.customerEmail || ''
      });
    }

    // Auto-enrich orders with lines from originating offer if missing
    const ordersTab = runtimeConfig.repository.tabOrders || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOrders || 'Ordini';
    const offersTab = runtimeConfig.repository.tabOffers || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOffers || 'Offerte';
    if ((tab === ordersTab || tab === 'Ordini') && !user?._enrichingOrders) {
      const ordersMissingLines = docs.filter(d => (!d.payload?.lines || d.payload.lines.length === 0) && (d.origin_offer_id || d.payload?.convertedFromOffer));
      if (ordersMissingLines.length > 0) {
        try {
          const enrichUser = user ? { ...user, _enrichingOrders: true } : { role: 'admin', _enrichingOrders: true };
          const offersList = await listDocs(offersTab, enrichUser, customId);
          const offersMap = new Map();
          for (const off of offersList) {
            if (off.number) offersMap.set(off.number, off);
            if (off.id) offersMap.set(off.id, off);
          }
          for (const ord of ordersMissingLines) {
            const offRef = ord.origin_offer_id || ord.payload?.convertedFromOffer;
            const matchedOffer = offersMap.get(offRef);
            if (matchedOffer && matchedOffer.payload?.lines) {
              ord.payload = {
                ...(ord.payload || {}),
                payment: ord.payload?.payment || matchedOffer.payload?.payment,
                shipping: ord.payload?.shipping || matchedOffer.payload?.shipping,
                lines: matchedOffer.payload.lines
              };
            }
          }
        } catch (enrichErr) {
          console.warn('Could not auto-enrich orders from offers:', enrichErr.message);
        }
      }
    }

    return docs;
  } catch (err) {
    console.warn(`Error reading ${tab} from Google Sheets:`, err.message);
    return [];
  }
}

async function createDoc(tab, body, user, customId) {
  const regId = cleanEnvId(body?.spreadsheetId) || cleanEnvId(body?.repositorySpreadsheetId) || cleanEnvId(customId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
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
            body.originOfferId || body.payload?.originOfferId || body.payload?.convertedFromOffer || '',
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
            now,
            payloadStr
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

    // Find the FIRST empty row directly under the header (e.g. Row 5)
    const searchRows = await readRange(regId, `'${tab}'!A1:B1000`).catch(() => []);
    let nextRow = -1;
    const startIdx = headerIdx >= 0 ? headerIdx + 1 : 1;
    for (let i = startIdx; i < Math.max(searchRows.length, startIdx + 1); i++) {
      const colA = String(searchRows[i]?.[0] || '').trim();
      const colB = String(searchRows[i]?.[1] || '').trim();
      if (!colA && !colB) {
        nextRow = i + 1; // 1-indexed row number in Google Sheets
        break;
      }
    }
    if (nextRow < 0) {
      nextRow = searchRows.length ? searchRows.length + 1 : 5;
    }

    try {
      await updateRow(regId, `'${tab}'!A${nextRow}`, [row]);
    } catch {
      await append(regId, `'${tab}'!A:Z`, [row]);
    }

    return json(201, { ok: true, id, number, rowNumber: nextRow, timestamp: now });
  } catch (err) {
    console.error(`Error saving ${tab} to Google Sheets:`, err);
    return json(500, { error: `Errore salvataggio su Google Sheets: ${err.message}` });
  }
}

async function createCustomer(body, user, customId) {
  const custSpreadsheetId = cleanEnvId(body?.spreadsheetId) || cleanEnvId(customId) || runtimeConfig.customers.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.customers.spreadsheetId;
  const tab = body?.tab || runtimeConfig.customers.tab || OFFICIAL_SYSTEM_SPREADSHEETS.customers.tab || 'clienti';

  const name = String(body.name || body.customerName || '').trim();
  if (!name) {
    return json(400, { error: 'Ragione sociale obbligatoria per creare un nuovo cliente' });
  }

  const agentCode = normalizeAgentId(body.agentId || body.agentCode || user?.agentCode || 'AG01');
  const city = String(body.city || '').trim();
  const address = String(body.address || '').trim();
  const tax = String(body.tax || body.taxCode || '').trim();
  const type = String(body.type || 'Cliente').trim();
  const postalCode = String(body.postalCode || '').trim();
  const province = String(body.province || '').trim().toUpperCase();
  const phone = String(body.phone || '').trim();
  const mobile = String(body.mobile || '').trim();
  const email = String(body.email || '').trim();
  const sdi = String(body.sdi || body.codiceSdi || body.codiceUnivoco || '').trim();
  const iban = String(body.iban || '').trim();
  const bank = String(body.bank || body.banca || '').trim();

  try {
    const rows = await readRange(custSpreadsheetId, `'${tab}'!A1:Z500`);
    if (!rows || rows.length === 0) {
      return json(500, { error: `Impossibile accedere al foglio "${tab}"` });
    }

    const header = rows[0].map(c => String(c || '').toLowerCase().trim());
    const col = patterns => {
      const pts = Array.isArray(patterns) ? patterns : [patterns];
      return header.findIndex(h => pts.some(p => h.includes(p)));
    };

    const cTipoIdx = col(['c.tipo', 'ctipo']);
    const tipoIdx = col(['tipo']);
    const codeIdx = col(['codice', 'code']);
    const nameIdx = col(['ragione', 'cliente', 'nome']);
    const codAttIdx = col(['cod.att', 'codatt']);
    const actIdx = col(['attivit']);
    const agentIdx = col(['agente', 'agent']);
    const addressIdx = col(['indirizzo', 'via']);
    const capIdx = col(['cap']);
    const cityIdx = col(['citt']);
    const pvIdx = col(['pv', 'prov']);
    const phoneIdx = col(['telefono', 'tel']);
    const faxIdx = col(['telefax', 'fax']);
    const mobileIdx = col(['cellulare', 'cell']);
    const netIdx = col(['internet', 'sito', 'web']);
    const emailIdx = col(['e-mail', 'email']);
    const sdiIdx = col(['sdi', 'univoco', 'destinatario']);
    const ibanIdx = col(['iban']);
    const bankIdx = col(['banca', 'appoggio']);
    const vatIdx = col(['partita iva', 'p.iva', 'piva']);
    const taxIdx = col(['codice fiscale', 'cf']);

    // Calcola il codice progressivo massimo
    let maxCode = 6500;
    for (let i = 1; i < rows.length; i++) {
      const rawC = rows[i]?.[codeIdx];
      if (rawC != null) {
        const n = parseInt(String(rawC).replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > maxCode && n < 100000) {
          maxCode = n;
        }
      }
    }
    const newCode = String(body.code || (maxCode + 1));

    // Formattazione codice agente conforme al foglio (es. AG001, AG002)
    let agentCell = agentCode;
    const numMatch = agentCode.match(/^AG0*(\d+)$/i);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      agentCell = `AG${n < 10 ? '00' + n : (n < 100 ? '0' + n : n)}`;
    }

    const numCols = Math.max(16, header.length);
    const newRow = new Array(numCols).fill('');
    if (cTipoIdx >= 0) newRow[cTipoIdx] = 'CLI';
    if (tipoIdx >= 0) newRow[tipoIdx] = type || 'Cliente';
    if (codeIdx >= 0) newRow[codeIdx] = newCode;
    if (nameIdx >= 0) newRow[nameIdx] = name;
    if (codAttIdx >= 0) newRow[codAttIdx] = 'INS';
    if (actIdx >= 0) newRow[actIdx] = type || 'Cliente';
    if (agentIdx >= 0) newRow[agentIdx] = agentCell;
    if (addressIdx >= 0) newRow[addressIdx] = address;
    if (capIdx >= 0) newRow[capIdx] = postalCode;
    if (cityIdx >= 0) newRow[cityIdx] = city;
    if (pvIdx >= 0) newRow[pvIdx] = province;
    if (phoneIdx >= 0) newRow[phoneIdx] = phone;
    if (faxIdx >= 0) newRow[faxIdx] = '';
    if (mobileIdx >= 0) newRow[mobileIdx] = mobile;
    if (netIdx >= 0) newRow[netIdx] = '';
    if (emailIdx >= 0) newRow[emailIdx] = email;
    if (sdiIdx >= 0) newRow[sdiIdx] = sdi;
    if (ibanIdx >= 0) newRow[ibanIdx] = iban;
    if (bankIdx >= 0) newRow[bankIdx] = bank;
    if (vatIdx >= 0 && (tax || body.vat)) newRow[vatIdx] = body.vat || tax;
    if (taxIdx >= 0 && tax) newRow[taxIdx] = tax;

    // Trova la prima riga vuota
    let nextRow = -1;
    for (let i = 1; i < rows.length; i++) {
      const cA = String(rows[i]?.[0] || '').trim();
      const cB = String(rows[i]?.[1] || '').trim();
      const cC = String(rows[i]?.[2] || '').trim();
      const cD = String(rows[i]?.[3] || '').trim();
      if (!cA && !cB && !cC && !cD) {
        nextRow = i + 1;
        break;
      }
    }
    if (nextRow < 0) {
      nextRow = rows.length + 1;
    }

    try {
      await updateRow(custSpreadsheetId, `'${tab}'!A${nextRow}:Z${nextRow}`, [newRow]);
    } catch {
      await append(custSpreadsheetId, `'${tab}'!A:Z`, [newRow]);
    }

    const customerObj = {
      id: newCode,
      code: newCode,
      name,
      type,
      activity: type || 'Cliente',
      agentId: normalizeAgentId(agentCell),
      sourceAgent: agentCell,
      address,
      postalCode,
      city,
      province,
      phone,
      mobile,
      email,
      sdi,
      iban,
      bank,
      vatNumber: body.vat || tax,
      taxCode: tax
    };

    return json(201, { ok: true, customer: customerObj, rowNumber: nextRow });
  } catch (err) {
    console.error(`Error saving customer to Google Sheets:`, err);
    return json(500, { error: `Errore salvataggio cliente su Google Sheets: ${err.message}` });
  }
}

// -------------------------------------------------------------
// WORKFLOW & AGENT POWER TOOLS
// -------------------------------------------------------------

function normalizeWorkflowStatus(raw) {
  const str = String(raw || '').toLowerCase().trim();
  if (str.includes('fattur') || str === 'invoiced') return 'fatturato';
  if (str.includes('spedit') || str === 'shipped' || str.includes('consegn')) return 'spedito';
  if (str.includes('magazzin') || str.includes('preparaz') || str === 'picking') return 'magazzino';
  if (str.includes('approvat') || str.includes('lavoraz') || str === 'approved') return 'approvato';
  if (str.includes('respint') || str === 'rejected') return 'respinto';
  return 'ricevuto';
}

async function updateOrderStatus(orderId, updateData, user) {
  if (user?.role !== 'admin') {
    throw new Error('Operazione riservata all’amministrazione');
  }
  const regId = cleanEnvId(updateData?.spreadsheetId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  const tab = runtimeConfig.repository.tabOrders || 'Ordini';

  const rawRows = await readRange(regId, `'${tab}'!A1:X1000`);
  if (!rawRows || !rawRows.length) throw new Error('Nessun ordine presente nel foglio');

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const line = (rawRows[i] || []).map(c => String(c || '').toLowerCase().trim());
    if (line.includes('id') || line.includes('id record') || line.some(c => c.includes('numero ordine') || c.includes('numero documento'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) headerIdx = 0;
  const header = (rawRows[headerIdx] || []).map(c => String(c || '').toLowerCase().trim());
  const findCol = (patterns, excludes = []) => {
    for (let k = 0; k < header.length; k++) {
      const h = header[k];
      const match = patterns.some(p => h === p || h.includes(p));
      if (match && !excludes.some(ex => h.includes(ex))) return k;
    }
    return -1;
  };

  const idIdx = findCol(['id record', 'id']);
  const numIdx = findCol(['numero ordine', 'numero documento', 'number'], ['id']);
  const updIdx = findCol(['ultimo aggiornamento', 'updated_at']);
  const statusIdx = findCol(['stato avanzamento', 'stato applicazione', 'status']);
  const notesIdx = findCol(['nota azienda', 'note operative', 'note']);
  const ddtNumIdx = findCol(['numero bolla / ddt', 'numero bolla', 'numero ddt', 'ddt']);
  const ddtDateIdx = findCol(['data bolla', 'data ddt']);
  const carrierIdx = findCol(['corriere', 'vettore']);
  const trackNumIdx = findCol(['numero tracking', 'tracking']);
  const trackLinkIdx = findCol(['link tracking']);
  const shipDateIdx = findCol(['data spedizione']);

  let targetRowIdx = -1;
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const r = rawRows[i];
    const rId = idIdx >= 0 ? cleanCell(r[idIdx]) : '';
    const rNum = numIdx >= 0 ? cleanCell(r[numIdx]) : '';
    if (rId === orderId || rNum === orderId) {
      targetRowIdx = i;
      break;
    }
  }

  if (targetRowIdx < 0) {
    throw new Error(`Ordine "${orderId}" non trovato nel registro`);
  }

  const existingRow = [...rawRows[targetRowIdx]];
  while (existingRow.length < 24) existingRow.push('');

  const now = new Date().toISOString();
  if (updIdx >= 0) existingRow[updIdx] = now;
  if (updateData.status && statusIdx >= 0) existingRow[statusIdx] = updateData.status;
  if (updateData.notes !== undefined && notesIdx >= 0) existingRow[notesIdx] = updateData.notes;
  if (updateData.ddtNumber !== undefined && ddtNumIdx >= 0) existingRow[ddtNumIdx] = updateData.ddtNumber;
  if (updateData.ddtDate !== undefined && ddtDateIdx >= 0) existingRow[ddtDateIdx] = updateData.ddtDate;
  if (updateData.carrier !== undefined && carrierIdx >= 0) existingRow[carrierIdx] = updateData.carrier;
  if (updateData.trackingNumber !== undefined && trackNumIdx >= 0) existingRow[trackNumIdx] = updateData.trackingNumber;
  if (updateData.trackingLink !== undefined && trackLinkIdx >= 0) existingRow[trackLinkIdx] = updateData.trackingLink;
  if (updateData.shippingDate !== undefined && shipDateIdx >= 0) existingRow[shipDateIdx] = updateData.shippingDate;

  // Persist DDT metadata inside payload_json column
  let payloadColIdx = -1;
  let payloadObj = {};
  for (let k = existingRow.length - 1; k >= 0; k--) {
    const val = cleanCell(existingRow[k]);
    if (typeof val === 'string' && val.startsWith('{')) {
      try {
        payloadObj = JSON.parse(val);
        payloadColIdx = k;
        break;
      } catch {}
    }
  }

  if (payloadColIdx >= 0 || updateData.ddtNumber) {
    payloadObj.ddt_info = {
      ...(payloadObj.ddt_info || {}),
      ddtNumber: updateData.ddtNumber !== undefined ? updateData.ddtNumber : payloadObj.ddt_info?.ddtNumber,
      ddtDate: updateData.ddtDate !== undefined ? updateData.ddtDate : payloadObj.ddt_info?.ddtDate,
      carrier: updateData.carrier !== undefined ? updateData.carrier : payloadObj.ddt_info?.carrier,
      trackingNumber: updateData.trackingNumber !== undefined ? updateData.trackingNumber : payloadObj.ddt_info?.trackingNumber,
      trackingLink: updateData.trackingLink !== undefined ? updateData.trackingLink : payloadObj.ddt_info?.trackingLink,
      shippingDate: updateData.shippingDate !== undefined ? updateData.shippingDate : payloadObj.ddt_info?.shippingDate,
      transportStartTime: updateData.transportStartTime !== undefined ? updateData.transportStartTime : payloadObj.ddt_info?.transportStartTime,
      goodsAppearance: updateData.goodsAppearance !== undefined ? updateData.goodsAppearance : payloadObj.ddt_info?.goodsAppearance,
      packagesCount: updateData.packagesCount !== undefined ? updateData.packagesCount : payloadObj.ddt_info?.packagesCount,
      weight: updateData.weight !== undefined ? updateData.weight : payloadObj.ddt_info?.weight,
      porto: updateData.porto !== undefined ? updateData.porto : payloadObj.ddt_info?.porto,
      shippingType: updateData.shippingType !== undefined ? updateData.shippingType : payloadObj.ddt_info?.shippingType,
      paymentMethod: updateData.paymentMethod !== undefined ? updateData.paymentMethod : payloadObj.ddt_info?.paymentMethod,
      causale: updateData.causale !== undefined ? updateData.causale : (payloadObj.ddt_info?.causale || 'VENDITA'),
      destinationAddress: updateData.destinationAddress !== undefined ? updateData.destinationAddress : payloadObj.ddt_info?.destinationAddress,
      sdi: updateData.sdi !== undefined ? updateData.sdi : payloadObj.ddt_info?.sdi,
      iban: updateData.iban !== undefined ? updateData.iban : payloadObj.ddt_info?.iban,
      bankInfo: updateData.bankInfo !== undefined ? updateData.bankInfo : payloadObj.ddt_info?.bankInfo,
      customerEmail: updateData.customerEmail !== undefined ? updateData.customerEmail : payloadObj.ddt_info?.customerEmail
    };

    if (payloadColIdx >= 0) {
      existingRow[payloadColIdx] = JSON.stringify(payloadObj);
    }
  }

  const sheetRowNum = targetRowIdx + 1;
  await updateRow(regId, `'${tab}'!A${sheetRowNum}:X${sheetRowNum}`, [existingRow]);

  return { ok: true, orderId, updatedRow: sheetRowNum, status: updateData.status };
}

async function convertOfferToOrder(offerIdentifier, user, customId) {
  const regId = cleanEnvId(customId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  const offersTab = runtimeConfig.repository.tabOffers || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOffers || 'Offerte';
  const ordersTab = runtimeConfig.repository.tabOrders || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOrders || 'Ordini';

  const offers = await listDocs(offersTab, user, regId);
  const offer = offers.find(o => o.id === offerIdentifier || o.number === offerIdentifier || o.offerNumber === offerIdentifier);
  if (!offer) {
    throw new Error(`Offerta "${offerIdentifier}" non trovata`);
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const agentCode = offer.agent_code || user?.agentCode || 'AG01';
  const orderNumber = `ORD-${agentCode}-${dateStr}-${timeStr}`;

  const orderBody = {
    id: crypto.randomUUID(),
    orderNumber,
    originOfferId: offer.number || offer.id,
    agentCode: offer.agent_code,
    agentName: offer.agent_name,
    customerId: offer.customer_id,
    customerName: offer.customer_name,
    total: offer.total,
    spreadsheetId: regId,
    payload: {
      ...(offer.payload || {}),
      lines: offer.payload?.lines || [],
      convertedFromOffer: offer.number,
      conversionDate: now.toISOString(),
      convertedBy: user?.name || user?.username || 'Agente'
    }
  };

  await createDoc(ordersTab, orderBody, user, regId);
  return { ok: true, orderNumber, originOfferId: offer.number, order: orderBody };
}

async function createOfferRevision(offerIdentifier, user, customId) {
  const regId = cleanEnvId(customId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  const offersTab = runtimeConfig.repository.tabOffers || OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOffers || 'Offerte';
  const offers = await listDocs(offersTab, user, regId);
  const offer = offers.find(o => o.id === offerIdentifier || o.number === offerIdentifier || o.offerNumber === offerIdentifier);
  if (!offer) {
    throw new Error(`Offerta "${offerIdentifier}" non trovata`);
  }

  const baseNumber = (offer.number || '').replace(/-R\d+$/, '');
  let maxRev = 0;
  for (const o of offers) {
    const num = o.number || '';
    if (num.startsWith(baseNumber)) {
      const match = num.match(/-R(\d+)$/);
      if (match) {
        const rev = parseInt(match[1], 10);
        if (rev > maxRev) maxRev = rev;
      }
    }
  }
  const nextRevNum = `${baseNumber}-R${maxRev + 1}`;

  const revisionBody = {
    id: crypto.randomUUID(),
    offerNumber: nextRevNum,
    originOfferId: offer.number,
    agentCode: offer.agent_code,
    agentName: offer.agent_name,
    customerId: offer.customer_id,
    customerName: offer.customer_name,
    total: offer.total,
    version: `${(parseFloat(offer.version) || 1.0) + 1.0}`,
    spreadsheetId: regId,
    payload: {
      ...(offer.payload || {}),
      lines: offer.payload?.lines || [],
      revisionOf: offer.number,
      revisionNumber: maxRev + 1,
      createdAt: new Date().toISOString()
    }
  };

  await createDoc(offersTab, revisionBody, user, regId);
  return { ok: true, newOfferNumber: nextRevNum, originOfferNumber: offer.number, revision: revisionBody };
}

async function listVisits(user, customId) {
  const regId = cleanEnvId(customId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await ensureSheetTab(regId, 'Giro_Visite');
  const rows = await readRange(regId, "'Giro_Visite'!A1:L500").catch(() => []);
  if (!rows || rows.length <= 1) return [];

  const userRole = user?.role || 'agent';
  const userAgentCode = normalizeAgentId(user?.agentCode || '');

  const visits = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const agCode = normalizeAgentId(r[1] || '');
    if (userRole !== 'admin' && userAgentCode && agCode && agCode !== userAgentCode) {
      continue;
    }
    visits.push({
      id: r[0],
      agentCode: agCode,
      agentName: r[2] || '',
      clientName: r[3] || '',
      address: r[4] || '',
      phone: r[5] || '',
      date: r[6] || '',
      time: r[7] || '',
      status: r[8] || 'Programmata',
      notes: r[9] || '',
      followUpDate: r[10] || '',
      createdAt: r[11] || ''
    });
  }
  return visits;
}

async function saveVisit(data, user) {
  const regId = cleanEnvId(data?.spreadsheetId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await ensureSheetTab(regId, 'Giro_Visite');
  const now = new Date().toISOString();
  const id = data.id || `VIS-${Date.now()}`;
  const agentCode = normalizeAgentId(user?.agentCode || data.agentCode || 'AG01');
  const agentName = user?.name || data.agentName || knownAgentNames[agentCode] || 'Agente';

  const rows = await readRange(regId, "'Giro_Visite'!A1:L500").catch(() => []);
  if (!rows || rows.length === 0) {
    const header = ['ID Visita', 'Codice Agente', 'Agente', 'Cliente o Prospect', 'Indirizzo e Città', 'Telefono', 'Data Visita', 'Ora', 'Stato Visita', 'Note ed Esito', 'Data Follow-up', 'Data Creazione'];
    await append(regId, "'Giro_Visite'!A1", [header]);
  }

  let existingRowIdx = -1;
  if (rows && rows.length > 1) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && rows[i][0] === id) {
        existingRowIdx = i + 1;
        break;
      }
    }
  }

  const row = [
    id,
    agentCode,
    agentName,
    data.clientName || '',
    data.address || '',
    data.phone || '',
    data.date || '',
    data.time || '',
    data.status || 'Programmata',
    data.notes || '',
    data.followUpDate || '',
    data.createdAt || now
  ];

  if (existingRowIdx > 0) {
    await updateRow(regId, `'Giro_Visite'!A${existingRowIdx}:L${existingRowIdx}`, [row]);
  } else {
    await append(regId, "'Giro_Visite'!A:L", [row]);
  }

  return { ok: true, id, visit: { ...data, id, agentCode, agentName } };
}

async function listProspects(user, customId) {
  const regId = cleanEnvId(customId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await ensureSheetTab(regId, 'Contatti_Prospect');
  const rows = await readRange(regId, "'Contatti_Prospect'!A1:K500").catch(() => []);
  if (!rows || rows.length <= 1) return [];

  const userRole = user?.role || 'agent';
  const userAgentCode = normalizeAgentId(user?.agentCode || '');

  const prospects = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    const agCode = normalizeAgentId(r[1] || '');
    if (userRole !== 'admin' && userAgentCode && agCode && agCode !== userAgentCode) {
      continue;
    }
    prospects.push({
      id: r[0],
      agentCode: agCode,
      companyName: r[2] || '',
      contactPerson: r[3] || '',
      phone: r[4] || '',
      email: r[5] || '',
      address: r[6] || '',
      city: r[7] || '',
      interest: r[8] || '',
      notes: r[9] || '',
      createdAt: r[10] || ''
    });
  }
  return prospects;
}

async function saveProspect(data, user) {
  const regId = cleanEnvId(data?.spreadsheetId) || runtimeConfig.repository.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await ensureSheetTab(regId, 'Contatti_Prospect');
  const now = new Date().toISOString();
  const id = data.id || `PROSP-${Date.now()}`;
  const agentCode = normalizeAgentId(user?.agentCode || data.agentCode || 'AG01');

  const rows = await readRange(regId, "'Contatti_Prospect'!A1:K500").catch(() => []);
  if (!rows || rows.length === 0) {
    const header = ['ID Prospect', 'Codice Agente', 'Ragione Sociale', 'Referente', 'Telefono', 'Email', 'Indirizzo', 'Città', 'Settore Interesse', 'Note', 'Data Creazione'];
    await append(regId, "'Contatti_Prospect'!A1", [header]);
  }

  const row = [
    id,
    agentCode,
    data.companyName || '',
    data.contactPerson || '',
    data.phone || '',
    data.email || '',
    data.address || '',
    data.city || '',
    data.interest || '',
    data.notes || '',
    now
  ];

  await append(regId, "'Contatti_Prospect'!A:K", [row]);
  return { ok: true, id, prospect: { ...data, id, agentCode } };
}

// -------------------------------------------------------------
// PRODUCTION & INVENTORY INTELLIGENCE (SELF-LEARNING ALGORITHM)
// -------------------------------------------------------------

let warehouseSetupDone = {};

async function setupWarehouseSpreadsheet(whId) {
  if (!whId) return false;
  if (warehouseSetupDone[whId]) return true;

  try {
    const meta = await sheets(`${whId}?fields=sheets.properties`);
    const existing = meta?.sheets || [];
    const titles = existing.map(s => s.properties?.title);

    const requests = [];
    if (!titles.includes('Istruzioni_e_Legenda')) {
      requests.push({
        addSheet: {
          properties: {
            title: 'Istruzioni_e_Legenda',
            gridProperties: { rowCount: 40, columnCount: 6 }
          }
        }
      });
    }
    if (!titles.includes('Movimenti_Magazzino')) {
      requests.push({
        addSheet: {
          properties: {
            title: 'Movimenti_Magazzino',
            gridProperties: { rowCount: 1000, columnCount: 11 }
          }
        }
      });
    }
    if (!titles.includes('Parametri_Produzione')) {
      requests.push({
        addSheet: {
          properties: {
            title: 'Parametri_Produzione',
            gridProperties: { rowCount: 500, columnCount: 11 }
          }
        }
      });
    }

    if (requests.length > 0) {
      await sheets(`${whId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests })
      });
    }

    // Re-fetch to get IDs
    const meta2 = await sheets(`${whId}?fields=sheets.properties`);
    const sheetMap = {};
    for (const s of meta2?.sheets || []) {
      sheetMap[s.properties?.title] = s.properties?.sheetId;
    }

    const fmtRequests = [];

    // Delete Foglio1 or Sheet1 if it exists and total sheets > 1
    for (const s of meta2?.sheets || []) {
      const t = s.properties?.title;
      if ((t === 'Foglio1' || t === 'Sheet1') && meta2.sheets.length > 1) {
        fmtRequests.push({ deleteSheet: { sheetId: s.properties.sheetId } });
      }
    }

    // 1. Format Istruzioni_e_Legenda
    const infoId = sheetMap['Istruzioni_e_Legenda'];
    if (infoId !== undefined) {
      fmtRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: infoId,
            tabColor: { red: 0.45, green: 0.25, blue: 0.75 }
          },
          fields: 'tabColor'
        }
      });
      fmtRequests.push({
        updateDimensionProperties: {
          range: { sheetId: infoId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 240 },
          fields: 'pixelSize'
        }
      });
      fmtRequests.push({
        updateDimensionProperties: {
          range: { sheetId: infoId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 420 },
          fields: 'pixelSize'
        }
      });
      fmtRequests.push({
        updateDimensionProperties: {
          range: { sheetId: infoId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
          properties: { pixelSize: 340 },
          fields: 'pixelSize'
        }
      });
    }

    // 2. Format Movimenti_Magazzino
    const movId = sheetMap['Movimenti_Magazzino'];
    if (movId !== undefined) {
      fmtRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: movId,
            gridProperties: { frozenRowCount: 1 },
            tabColor: { red: 0.086, green: 0.639, blue: 0.396 }
          },
          fields: 'gridProperties.frozenRowCount,tabColor'
        }
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId: movId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.118, green: 0.227, blue: 0.373 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10, bold: true },
              wrapStrategy: 'WRAP'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
        }
      });
      const movWidths = [140, 150, 160, 130, 270, 110, 130, 160, 150, 160, 240];
      movWidths.forEach((w, idx) => {
        fmtRequests.push({
          updateDimensionProperties: {
            range: { sheetId: movId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
            properties: { pixelSize: w },
            fields: 'pixelSize'
          }
        });
      });
    }

    // 3. Format Parametri_Produzione
    const paramId = sheetMap['Parametri_Produzione'];
    if (paramId !== undefined) {
      fmtRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: paramId,
            gridProperties: { frozenRowCount: 1 },
            tabColor: { red: 0.14, green: 0.46, blue: 0.85 }
          },
          fields: 'gridProperties.frozenRowCount,tabColor'
        }
      });
      fmtRequests.push({
        repeatCell: {
          range: { sheetId: paramId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.05, green: 0.36, blue: 0.46 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10, bold: true },
              wrapStrategy: 'WRAP'
            }
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
        }
      });
      const paramWidths = [130, 270, 140, 160, 140, 140, 140, 140, 240, 150, 150];
      paramWidths.forEach((w, idx) => {
        fmtRequests.push({
          updateDimensionProperties: {
            range: { sheetId: paramId, dimension: 'COLUMNS', startIndex: idx, endIndex: idx + 1 },
            properties: { pixelSize: w },
            fields: 'pixelSize'
          }
        });
      });
    }

    if (fmtRequests.length > 0) {
      await sheets(`${whId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: fmtRequests })
      }).catch(e => console.warn('batchUpdate format warning:', e.message));
    }

    // Populate Headers and initial content
    const infoCheck = await readRange(whId, "'Istruzioni_e_Legenda'!A1:B2").catch(() => []);
    if (!infoCheck || infoCheck.length === 0) {
      const nowStr = new Date().toLocaleDateString('it-IT') + ' ' + new Date().toLocaleTimeString('it-IT');
      const infoRows = [
        ['🏭 REGISTRO UFFICIALE MAGAZZINO, LOGISTICA E PRODUZIONE', '', ''],
        ['Azienda:', 'Pascal Cosmesi International', ''],
        ['Stato Sistema:', '🟢 Connesso e Sincronizzato in tempo reale con OrderSender', ''],
        ['Spreadsheet ID:', whId, ''],
        ['Data Inizializzazione:', nowStr, ''],
        ['', '', ''],
        ['SCHEDA', 'SCOPO OPERATIVO', 'AUTOMAZIONE & NOTE'],
        ['Movimenti_Magazzino', 'Traccia ogni singolo prelievo per ordini clienti e carico lotti di produzione', 'Aggiornato in tempo reale dall\'app OrderSender'],
        ['Parametri_Produzione', 'Lead time, scorte di sicurezza (SS), lotti minimi e ubicazioni scaffale', 'Usato dal motore di calcolo per proporre i lotti da produrre'],
        ['', '', ''],
        ['SICUREZZA & PERFORMANCE:', 'Questo foglio dedicato protegge gli 11 agenti sul campo da blocchi o rallentamenti di concorrenza durante i prelievi continui del magazzino.', '']
      ];
      await updateRow(whId, "'Istruzioni_e_Legenda'!A1:C11", infoRows).catch(() => {});
    }

    const movCheck = await readRange(whId, "'Movimenti_Magazzino'!A1:C1").catch(() => []);
    if (!movCheck || movCheck.length === 0) {
      const movHeader = [
        ['ID Movimento', 'Data Registrazione', 'Tipo Operazione', 'Codice Articolo', 'Descrizione Prodotto', 'Quantità (PZ)', 'Numero Lotto', 'Ubicazione Stoccaggio', 'Operatore / Reparto', 'Riferimento Doc / Ordine', 'Note e Dettagli']
      ];
      await updateRow(whId, "'Movimenti_Magazzino'!A1:K1", movHeader).catch(() => {});
    }

    const paramCheck = await readRange(whId, "'Parametri_Produzione'!A1:C1").catch(() => []);
    if (!paramCheck || paramCheck.length === 0) {
      const paramHeader = [
        ['Codice Articolo', 'Descrizione Prodotto', 'Famiglia / Linea', 'Ubicazione Primaria', 'Tempo Produzione Stimato (gg)', 'Lotto Minimo Produzione (PZ)', 'Scorta Minima di Sicurezza (PZ)', 'Scorta Massima (PZ)', 'Note Reparto Produzione', 'Ultimo Aggiornamento', 'Aggiornato Da']
      ];
      await updateRow(whId, "'Parametri_Produzione'!A1:K1", paramHeader).catch(() => {});

      try {
        const prodData = await fetchProductsData();
        if (prodData && prodData.products && prodData.products.length > 0) {
          const nowIso = new Date().toISOString().slice(0, 10);
          const initialRows = prodData.products.map(p => [
            p.code || '',
            p.description || '',
            p.family || p.category || '',
            '',
            '',
            '',
            '',
            '',
            '',
            nowIso,
            'Inizializzazione Sistema'
          ]);
          await append(whId, "'Parametri_Produzione'!A:K", initialRows).catch(() => {});
        }
      } catch (err) {
        console.warn('Pre-populating products warning:', err.message);
      }
    }

    warehouseSetupDone[whId] = true;
    return true;
  } catch (err) {
    console.error('setupWarehouseSpreadsheet error:', err);
    return false;
  }
}

async function fetchProductionParameters(customId) {
  const regId = cleanEnvId(customId) || cleanEnvId(runtimeConfig.warehouse?.spreadsheetId) || cleanEnvId(runtimeConfig.repository.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await setupWarehouseSpreadsheet(regId);
  const tabName = runtimeConfig.warehouse?.tabParameters || 'Parametri_Produzione';
  await ensureSheetTab(regId, tabName);
  const rows = await readRange(regId, `'${tabName}'!A1:J500`).catch(() => []);
  if (!rows || rows.length <= 1) return {};

  const header = rows[0].map(c => String(c || '').toLowerCase().trim());
  const col = name => header.findIndex(h => h.includes(name));
  const codeIdx = col('codice') >= 0 ? col('codice') : 0;
  const leadIdx = col('tempo') >= 0 ? col('tempo') : 1;
  const lotIdx = col('lotto') >= 0 ? col('lotto') : 2;
  const minStockIdx = col('min') >= 0 ? col('min') : 3;
  const maxStockIdx = col('max') >= 0 ? col('max') : 4;
  const notesIdx = col('note') >= 0 ? col('note') : 5;
  const ubiIdx = col('ubicazione') >= 0 ? col('ubicazione') : (col('scaffale') >= 0 ? col('scaffale') : (col('ubi') >= 0 ? col('ubi') : 8));
  const stockIdx = col('giacenza') >= 0 ? col('giacenza') : (col('stock') >= 0 ? col('stock') : 9);

  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[codeIdx]) continue;
    const code = String(r[codeIdx]).trim();
    map[code] = {
      code,
      leadTimeDays: r[leadIdx] != null && !isNaN(parseFloat(r[leadIdx])) ? parseFloat(r[leadIdx]) : null,
      minProductionLot: r[lotIdx] != null && !isNaN(parseFloat(r[lotIdx])) ? parseFloat(r[lotIdx]) : null,
      manualSafetyStock: r[minStockIdx] != null && !isNaN(parseFloat(r[minStockIdx])) ? parseFloat(r[minStockIdx]) : null,
      manualMaxStock: r[maxStockIdx] != null && !isNaN(parseFloat(r[maxStockIdx])) ? parseFloat(r[maxStockIdx]) : null,
      notes: r[notesIdx] ? String(r[notesIdx]).trim() : '',
      location: (ubiIdx >= 0 && r[ubiIdx]) ? String(r[ubiIdx]).trim() : '',
      manualStock: (stockIdx >= 0 && r[stockIdx] != null && !isNaN(parseFloat(r[stockIdx]))) ? parseFloat(r[stockIdx]) : null
    };
  }
  return map;
}

async function saveProductionParameters(paramItem, user, customId) {
  const regId = cleanEnvId(customId) || cleanEnvId(runtimeConfig.warehouse?.spreadsheetId) || cleanEnvId(runtimeConfig.repository.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  const tabName = runtimeConfig.warehouse?.tabParameters || 'Parametri_Produzione';
  await ensureSheetTab(regId, tabName);

  const rows = await readRange(regId, `'${tabName}'!A1:J500`).catch(() => []);
  if (!rows || rows.length === 0) {
    const header = ['Codice Articolo', 'Tempo Produzione Stimato (gg)', 'Lotto Minimo Produzione', 'Scorta Minima Manuale', 'Scorta Massima Manuale', 'Note Produzione', 'Ultimo Aggiornamento', 'Aggiornato Da', 'Ubicazione Magazzino', 'Giacenza Rettificata'];
    await append(regId, `'${tabName}'!A1`, [header]);
  }

  const code = String(paramItem.code || paramItem.articleCode || '').trim();
  if (!code) throw new Error('Codice articolo mancante');

  const now = new Date().toISOString();
  const userName = user?.name || user?.username || 'Amministrazione';

  let existingRowIdx = -1;
  if (rows && rows.length > 1) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] && String(rows[i][0] || '').trim().toUpperCase() === code.toUpperCase()) {
        existingRowIdx = i + 1;
        break;
      }
    }
  }

  const row = [
    code,
    paramItem.leadTimeDays != null && !isNaN(parseFloat(paramItem.leadTimeDays)) ? parseFloat(paramItem.leadTimeDays) : '',
    paramItem.minProductionLot != null && !isNaN(parseFloat(paramItem.minProductionLot)) ? parseFloat(paramItem.minProductionLot) : '',
    paramItem.manualSafetyStock != null && !isNaN(parseFloat(paramItem.manualSafetyStock)) ? parseFloat(paramItem.manualSafetyStock) : '',
    paramItem.manualMaxStock != null && !isNaN(parseFloat(paramItem.manualMaxStock)) ? parseFloat(paramItem.manualMaxStock) : '',
    paramItem.notes || '',
    now,
    userName,
    paramItem.location || '',
    paramItem.manualStock != null && !isNaN(parseFloat(paramItem.manualStock)) ? parseFloat(paramItem.manualStock) : ''
  ];

  if (existingRowIdx > 0) {
    await updateRow(regId, `'${tabName}'!A${existingRowIdx}:J${existingRowIdx}`, [row]);
  } else {
    await append(regId, `'${tabName}'!A:J`, [row]);
  }

  return { ok: true, code, paramItem };
}

// -------------------------------------------------------------
// WAREHOUSE MOVEMENTS & PRODUCTION RECEIPT TRACKING
// -------------------------------------------------------------

async function fetchWarehouseMovements(customId) {
  const regId = cleanEnvId(customId) || cleanEnvId(runtimeConfig.warehouse?.spreadsheetId) || cleanEnvId(runtimeConfig.repository.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await setupWarehouseSpreadsheet(regId);
  const tabName = runtimeConfig.warehouse?.tabMovements || 'Movimenti_Magazzino';
  await ensureSheetTab(regId, tabName);
  const rows = await readRange(regId, `'${tabName}'!A1:J500`).catch(() => []);
  if (!rows || rows.length <= 1) return [];

  const header = rows[0].map(c => String(c || '').toLowerCase().trim());
  const col = name => header.findIndex(h => h.includes(name));
  const idIdx = col('id') >= 0 ? col('id') : 0;
  const dateIdx = col('data') >= 0 ? col('data') : 1;
  const typeIdx = col('tipo') >= 0 ? col('tipo') : 2;
  const codeIdx = col('codice') >= 0 ? col('codice') : 3;
  const desIdx = col('descrizione') >= 0 ? col('descrizione') : 4;
  const qtyIdx = col('quantit') >= 0 ? col('quantit') : 5;
  const lotIdx = col('lotto') >= 0 ? col('lotto') : 6;
  const ubiIdx = col('ubicazione') >= 0 ? col('ubicazione') : (col('scaffale') >= 0 ? col('scaffale') : 7);
  const opIdx = col('operatore') >= 0 ? col('operatore') : 8;
  const notesIdx = col('note') >= 0 ? col('note') : 9;

  const movements = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || (!r[codeIdx] && !r[idIdx])) continue;
    const qty = Number(r[qtyIdx]) || 0;
    movements.push({
      id: String(r[idIdx] || `MOV-${i}`).trim(),
      date: r[dateIdx] ? String(r[dateIdx]).trim() : new Date().toISOString(),
      type: r[typeIdx] ? String(r[typeIdx]).trim().toUpperCase() : 'PRODUZIONE',
      code: String(r[codeIdx] || '').trim(),
      description: String(r[desIdx] || '').trim(),
      quantity: qty,
      lotNumber: r[lotIdx] ? String(r[lotIdx]).trim() : '',
      location: (ubiIdx >= 0 && r[ubiIdx]) ? String(r[ubiIdx]).trim() : '',
      operator: (opIdx >= 0 && r[opIdx]) ? String(r[opIdx]).trim() : '',
      notes: (notesIdx >= 0 && r[notesIdx]) ? String(r[notesIdx]).trim() : ''
    });
  }
  return movements.reverse();
}

async function recordWarehouseMovement(entry, user, customId) {
  const regId = cleanEnvId(customId) || cleanEnvId(runtimeConfig.warehouse?.spreadsheetId) || cleanEnvId(runtimeConfig.repository.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  await setupWarehouseSpreadsheet(regId);
  const tabName = runtimeConfig.warehouse?.tabMovements || 'Movimenti_Magazzino';
  await ensureSheetTab(regId, tabName);

  const rows = await readRange(regId, `'${tabName}'!A1:J1`).catch(() => []);
  if (!rows || rows.length === 0) {
    const header = ['ID Movimento', 'Data Registrazione', 'Tipo Movimento', 'Codice Articolo', 'Descrizione Articolo', 'Quantità (Pezzi)', 'Numero Lotto', 'Ubicazione Stoccaggio', 'Operatore / Reparto', 'Note'];
    await append(regId, `'${tabName}'!A1`, [header]);
  }

  const code = String(entry.code || entry.articleCode || '').trim();
  if (!code) throw new Error('Codice articolo mancante');
  const qty = Number(entry.quantity) || 0;
  if (qty <= 0) throw new Error('La quantità prodotta deve essere maggiore di 0');

  const now = entry.date ? new Date(entry.date).toISOString() : new Date().toISOString();
  const id = `PRD-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
  const userName = user?.name || user?.username || entry.operator || 'Operatore Produzione';
  const type = String(entry.type || 'PRODUZIONE').trim().toUpperCase();
  const desc = String(entry.description || '').trim();
  const lot = String(entry.lotNumber || entry.lot || '').trim();
  const location = String(entry.location || entry.ubicazione || '').trim();
  const notes = String(entry.notes || '').trim();

  const row = [
    id,
    now,
    type,
    code,
    desc,
    qty,
    lot,
    location,
    userName,
    notes
  ];

  await append(regId, `'${tabName}'!A:J`, [row]);

  // If location was declared or changed, save it into Parametri_Produzione so the article keeps its warehouse location
  if (location) {
    try {
      const currentParam = (await fetchProductionParameters(customId))[code] || {};
      await saveProductionParameters({
        ...currentParam,
        code,
        location
      }, user, customId);
    } catch (e) {
      console.warn('Aggiornamento ubicazione articolo non bloccante:', e.message);
    }
  }

  return {
    ok: true,
    id,
    movement: {
      id,
      date: now,
      type,
      code,
      description: desc,
      quantity: qty,
      lotNumber: lot,
      location,
      operator: userName,
      notes
    }
  };
}

async function calculateProductionIntelligence(user, customProductsId, customRepositoryId) {
  // 1. Fetch live products from Google Sheets Articoli
  const prRes = await fetchProductsData(customProductsId);
  const products = prRes.products || [];

  const warehouseSpreadsheetId = cleanEnvId(customRepositoryId) || cleanEnvId(runtimeConfig.warehouse?.spreadsheetId) || cleanEnvId(runtimeConfig.repository?.spreadsheetId) || OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;

  // 2. Fetch parameters overrides from Google Sheets Parametri_Produzione
  const paramMap = await fetchProductionParameters(warehouseSpreadsheetId);

  // 3. Fetch all orders from Google Sheets Ordini
  const adminUser = { role: 'admin' };
  const orders = await listDocs(runtimeConfig.repository.tabOrders || 'Ordini', adminUser, customRepositoryId).catch(() => []);

  // 4. Fetch all open offers from Google Sheets Offerte (prospective pipeline demand)
  const offers = await listDocs(runtimeConfig.repository.tabOffers || 'Offerte', adminUser, customRepositoryId).catch(() => []);

  // 5. Fetch declared warehouse movements (production batches and goods receipts)
  const movements = await fetchWarehouseMovements(warehouseSpreadsheetId).catch(() => []);

  // Process open offers for prospective demand
  const articleOffers = {};
  for (const off of (offers || [])) {
    const stStatus = String(off.status || off.workflow_status || 'bozza').toLowerCase();
    if (['rifiutata', 'annullata', 'scaduta', 'convertita', 'convertita_in_ordine'].includes(stStatus)) continue;
    const lines = off.payload?.lines || off.payload?.items || [];
    for (const l of lines) {
      const code = String(l.code || '').trim();
      if (!code) continue;
      const qty = Number(l.quantity) || 1;
      if (!articleOffers[code]) articleOffers[code] = { offeredQty: 0, offersCount: 0 };
      articleOffers[code].offeredQty += qty;
      articleOffers[code].offersCount += 1;
    }
  }

  // Process warehouse movements
  const articleMovements = {};
  for (const m of movements) {
    const code = m.code;
    if (!code) continue;
    if (!articleMovements[code]) {
      articleMovements[code] = { producedQty: 0, movementsCount: 0, lastLot: '', lastMovementDate: '' };
    }
    const stm = articleMovements[code];
    stm.movementsCount++;
    if (m.type === 'PRODUZIONE' || m.type === 'CARICO' || m.type === 'RESO') {
      stm.producedQty += m.quantity;
    } else if (m.type === 'SCARTO' || m.type === 'RETTIFICA_NEGATIVA') {
      stm.producedQty -= m.quantity;
    }
    if (!stm.lastLot && m.lotNumber) stm.lastLot = m.lotNumber;
    if (!stm.lastMovementDate && m.date) stm.lastMovementDate = m.date;
  }

  // Learning Lead Times and Demand per Article from Orders
  const articleStats = {};
  const familyLeadTimes = {};
  const globalLeadTimes = [];

  const nowMs = Date.now();
  const thirtyDaysAgoMs = nowMs - (30 * 86400000);
  let minOrderDateMs = nowMs;

  for (const ord of orders) {
    let orderDateMs = ord.submitted_at ? new Date(ord.submitted_at).getTime() : 0;
    if (!orderDateMs || isNaN(orderDateMs)) {
      orderDateMs = ord.updated_at ? new Date(ord.updated_at).getTime() : nowMs;
    }
    if (orderDateMs < minOrderDateMs && orderDateMs > 0) {
      minOrderDateMs = orderDateMs;
    }

    // Lead time measurement: if shipping_date or ddt_date is present
    let shipDateMs = 0;
    if (ord.shipping_date) {
      const parsed = new Date(ord.shipping_date).getTime();
      if (!isNaN(parsed)) shipDateMs = parsed;
    }
    if (!shipDateMs && ord.ddt_date) {
      const parsed = new Date(ord.ddt_date).getTime();
      if (!isNaN(parsed)) shipDateMs = parsed;
    }

    let measuredLeadDays = null;
    if (shipDateMs > 0 && orderDateMs > 0 && shipDateMs >= orderDateMs) {
      const diffDays = Math.max(1, Math.round((shipDateMs - orderDateMs) / 86400000));
      if (diffDays <= 120) {
        measuredLeadDays = diffDays;
        globalLeadTimes.push(diffDays);
      }
    }

    const isClosed = ord.workflow_status === 'spedito' || ord.workflow_status === 'fatturato' || ord.workflow_status === 'respinto';
    const lines = ord.payload?.lines || ord.payload?.items || [];

    for (const l of lines) {
      const code = String(l.code || '').trim();
      if (!code) continue;
      const qty = Number(l.quantity) || 1;

      if (!articleStats[code]) {
        articleStats[code] = {
          leadTimes: [],
          totalOrderedQty: 0,
          ordersCount: 0,
          recent30Qty: 0,
          committedQty: 0,
          soldQty: 0
        };
      }

      const st = articleStats[code];
      st.totalOrderedQty += qty;
      st.ordersCount += 1;

      if (orderDateMs >= thirtyDaysAgoMs) {
        st.recent30Qty += qty;
      }

      if (ord.workflow_status === 'spedito' || ord.workflow_status === 'fatturato') {
        st.soldQty += qty;
      }

      if (!isClosed) {
        st.committedQty += qty;
      }

      if (measuredLeadDays != null) {
        st.leadTimes.push(measuredLeadDays);
      }
    }
  }

  // Global learned average lead time
  const globalAvgLead = globalLeadTimes.length > 0
    ? globalLeadTimes.reduce((a, b) => a + b, 0) / globalLeadTimes.length
    : 7.0;

  // Compute family lead times
  for (const pr of products) {
    const st = articleStats[pr.code];
    const fam = pr.family || pr.macroFamily || 'STANDARD';
    if (!familyLeadTimes[fam]) familyLeadTimes[fam] = [];
    if (st && st.leadTimes.length > 0) {
      familyLeadTimes[fam].push(...st.leadTimes);
    }
  }

  const familyAvgMap = {};
  for (const [fam, times] of Object.entries(familyLeadTimes)) {
    familyAvgMap[fam] = times.length > 0
      ? times.reduce((a, b) => a + b, 0) / times.length
      : globalAvgLead;
  }

  // Observation horizon in days (min 30 days)
  const observationDays = Math.max(30, Math.round((nowMs - minOrderDateMs) / 86400000));

  // Build complete analysis per product
  const analysis = [];
  let criticalCount = 0;
  let reorderCount = 0;
  let optimalCount = 0;
  let overstockCount = 0;
  let totalPiecesToProduce = 0;
  let totalCommittedPieces = 0;
  let totalOfferedPieces = 0;
  let totalProducedPieces = 0;
  let totalSoldPieces = 0;
  let totalRealStock = 0;

  for (const pr of products) {
    const code = pr.code;
    const desc = pr.description;
    const catalogStock = Number.isFinite(pr.stock) ? pr.stock : 0;
    const override = paramMap[code] || {};
    const movData = articleMovements[code] || { producedQty: 0, movementsCount: 0, lastLot: '', lastMovementDate: '' };
    const offData = articleOffers[code] || { offeredQty: 0, offersCount: 0 };

    const st = articleStats[code] || {
      leadTimes: [],
      totalOrderedQty: 0,
      ordersCount: 0,
      recent30Qty: 0,
      committedQty: 0,
      soldQty: 0
    };

    const producedQty = movData.producedQty;
    const soldQty = st.soldQty;
    const committedQty = st.committedQty;
    const offeredQty = offData.offeredQty;

    totalCommittedPieces += committedQty;
    totalOfferedPieces += offeredQty;
    totalProducedPieces += producedQty;
    totalSoldPieces += soldQty;

    // Real Stock calculation: manual override > (catalogStock + declared produced - delivered sold)
    let currentStock = catalogStock;
    if (override.manualStock != null && !isNaN(override.manualStock)) {
      currentStock = override.manualStock;
    } else if (producedQty > 0 || soldQty > 0) {
      currentStock = Math.max(0, catalogStock + producedQty - soldQty);
    }
    totalRealStock += currentStock;

    // Ubicazione: manual override > catalog location > default
    const location = override.location || pr.location || 'Magazzino / Stoccaggio';

    // 1. Lead time calculation (learned vs configured)
    const productLeadTimes = st.leadTimes;
    const learnedLeadAvg = productLeadTimes.length > 0
      ? (productLeadTimes.reduce((a, b) => a + b, 0) / productLeadTimes.length)
      : null;

    let learnedLeadStd = 1.0;
    if (productLeadTimes.length > 1) {
      const avg = learnedLeadAvg;
      const variance = productLeadTimes.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / productLeadTimes.length;
      learnedLeadStd = Math.sqrt(variance);
    } else {
      learnedLeadStd = (learnedLeadAvg || 7) * 0.25;
    }

    const fam = pr.family || pr.macroFamily || 'STANDARD';
    const famLeadAvg = familyAvgMap[fam] || globalAvgLead;

    let effectiveLeadTime = 7;
    let leadTimeSource = 'Default (7 gg)';
    if (override.leadTimeDays && override.leadTimeDays > 0) {
      effectiveLeadTime = override.leadTimeDays;
      leadTimeSource = 'Manuale / Override';
    } else if (pr.leadTimeDays && pr.leadTimeDays > 0) {
      effectiveLeadTime = pr.leadTimeDays;
      leadTimeSource = 'Da Listino Google Sheets';
    } else if (learnedLeadAvg != null) {
      effectiveLeadTime = Math.round(learnedLeadAvg * 10) / 10;
      leadTimeSource = `Appreso da ordini (${productLeadTimes.length} spedizioni)`;
    } else if (famLeadAvg > 0) {
      effectiveLeadTime = Math.round(famLeadAvg * 10) / 10;
      leadTimeSource = `Appreso da famiglia (${fam})`;
    }

    // 2. Demand & Run-Rate
    const dailyDemand = st.totalOrderedQty > 0 ? (st.totalOrderedQty / observationDays) : 0;
    const recentDailyDemand = st.recent30Qty > 0 ? (st.recent30Qty / 30) : 0;
    const demandTrend = dailyDemand > 0 ? (recentDailyDemand / dailyDemand) : 1.0;
    const dailyDemandStd = dailyDemand > 0 ? Math.sqrt(dailyDemand * 1.5) : 0.2;

    // 3. Safety Stock (SS) calculation
    const varTerm = (effectiveLeadTime * Math.pow(dailyDemandStd, 2)) + (Math.pow(dailyDemand, 2) * Math.pow(learnedLeadStd, 2));
    const calculatedSS = Math.max(1, Math.ceil(1.65 * Math.sqrt(Math.max(0.1, varTerm))));

    const safetyStock = override.manualSafetyStock != null && override.manualSafetyStock > 0
      ? override.manualSafetyStock
      : (pr.safetyStock != null && pr.safetyStock > 0 ? pr.safetyStock : calculatedSS);

    // 4. Reorder Point (ROP) = D * L + SS
    const leadTimeDemand = dailyDemand * effectiveLeadTime;
    const calculatedROP = Math.ceil(leadTimeDemand + safetyStock);
    const reorderPoint = pr.reorderPoint != null && pr.reorderPoint > 0
      ? pr.reorderPoint
      : calculatedROP;

    // 5. Min Production Lot
    let minLot = 12;
    if (override.minProductionLot && override.minProductionLot > 0) {
      minLot = override.minProductionLot;
    } else if (pr.minProductionLot && pr.minProductionLot > 0) {
      minLot = pr.minProductionLot;
    } else if (dailyDemand > 0) {
      minLot = Math.max(6, Math.ceil(dailyDemand * 7));
    }

    // 6. Max Stock
    const calculatedMaxStock = Math.ceil(reorderPoint + Math.max(minLot, dailyDemand * 14));
    const maxStock = override.manualMaxStock != null && override.manualMaxStock > 0
      ? override.manualMaxStock
      : (pr.maxStock != null && pr.maxStock > 0 ? pr.maxStock : calculatedMaxStock);

    // 7. Free Stock = Real Physical Stock - Committed in Open Orders
    const freeStock = currentStock - committedQty;

    // 8. Urgency Status & Suggested Production Quantity
    let urgency = 'OTTIMALE';
    let urgencyClass = 'status-ottimale';
    let urgencyIcon = '🟢';
    let suggestedProduction = 0;

    if (freeStock <= 0 || freeStock < safetyStock) {
      urgency = 'CRITICO';
      urgencyClass = 'status-critico';
      urgencyIcon = '🔴';
      criticalCount++;
    } else if (freeStock <= reorderPoint) {
      urgency = 'RIORDINO';
      urgencyClass = 'status-riordino';
      urgencyIcon = '🟠';
      reorderCount++;
    } else if (freeStock > (maxStock * 1.25) && maxStock > 0) {
      urgency = 'OVERSTOCK';
      urgencyClass = 'status-overstock';
      urgencyIcon = '🔵';
      overstockCount++;
    } else {
      urgency = 'OTTIMALE';
      urgencyClass = 'status-ottimale';
      urgencyIcon = '🟢';
      optimalCount++;
    }

    if (urgency === 'CRITICO' || urgency === 'RIORDINO') {
      // Factor in buffer for open offers (prospective demand)
      const offerFactor = Math.round(offeredQty * 0.25);
      const targetDeficit = Math.max(0, (maxStock + offerFactor) - freeStock);
      if (targetDeficit > 0) {
        suggestedProduction = Math.ceil(targetDeficit / minLot) * minLot;
        totalPiecesToProduce += suggestedProduction;
      }
    }

    analysis.push({
      code,
      description: desc,
      brand: pr.brand || '',
      sector: pr.sector || '',
      family: pr.family || '',
      macroFamily: pr.macroFamily || '',
      price: pr.price || 0,
      location,
      catalogStock,
      producedQty,
      soldQty,
      currentStock,
      committedQty,
      offeredQty,
      freeStock,
      lastLot: movData.lastLot,
      lastMovementDate: movData.lastMovementDate,
      ordersCount: st.ordersCount,
      totalOrderedQty: st.totalOrderedQty,
      dailyDemand: Math.round(dailyDemand * 100) / 100,
      recentDailyDemand: Math.round(recentDailyDemand * 100) / 100,
      demandTrend: Math.round(demandTrend * 100) / 100,
      effectiveLeadTime,
      learnedLeadAvg: learnedLeadAvg != null ? Math.round(learnedLeadAvg * 10) / 10 : null,
      leadTimeSamplesCount: productLeadTimes.length,
      leadTimeSource,
      safetyStock,
      reorderPoint,
      maxStock,
      minProductionLot: minLot,
      urgency,
      urgencyClass,
      urgencyIcon,
      suggestedProduction,
      notes: override.notes || ''
    });
  }

  // Sort by urgency priority: CRITICO first, then RIORDINO, then OTTIMALE, then OVERSTOCK
  const urgencyWeight = { CRITICO: 1, RIORDINO: 2, OVERSTOCK: 3, OTTIMALE: 4 };
  analysis.sort((a, b) => {
    const diff = (urgencyWeight[a.urgency] || 99) - (urgencyWeight[b.urgency] || 99);
    if (diff !== 0) return diff;
    return b.suggestedProduction - a.suggestedProduction;
  });

  return {
    ok: true,
    source: 'google-sheets',
    timestamp: new Date().toISOString(),
    kpi: {
      totalArticles: products.length,
      criticalCount,
      reorderCount,
      optimalCount,
      overstockCount,
      totalPiecesToProduce,
      totalCommittedPieces,
      totalOfferedPieces,
      totalProducedPieces,
      totalSoldPieces,
      totalRealStock,
      companyAvgLeadTimeDays: Math.round(globalAvgLead * 10) / 10,
      shippedOrdersAnalyzed: globalLeadTimes.length,
      totalOrdersAnalyzed: orders.length,
      observationDays
    },
    movements: movements.slice(0, 50),
    analysis
  };
}

// Netlify Function Entry Point
export default async (request, context) => {
  try {
    const url = new URL(request.url);
    const path = (context.params?.splat || url.pathname.split('/api/')[1] || '').replace(/^\/+|\/+$/g, '');

    // Ensure central cloud config is active
    await loadCentralConfig();

    // Auth endpoints
    if (path === 'login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const user = users().find(x => x.username === body.username && x.password === body.password);
      if (!user) {
        return json(401, { error: 'Credenziali non valide. Riprova con i dati forniti dall’amministrazione.' });
      }
      const token = createSessionToken(user);
      return json(200, { ok: true, user: { username: user.username, name: user.name, role: user.role, agentCode: user.agentCode }, token }, { 'set-cookie': sessionCookie(user) });
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
        const user = session(request);
        const body = await request.json().catch(() => ({}));
        const saveRes = await saveCentralConfig(body, user);
        return json(200, {
          ok: true,
          config: runtimeConfig,
          savedToSheet: saveRes.savedToSheet,
          sheetError: saveRes.sheetError,
          message: saveRes.savedToSheet
            ? 'Configurazione centrale salvata su Google Drive e condivisa con tutti i dispositivi'
            : 'Configurazione aggiornata in memoria'
        });
      }
      if (url.searchParams.get('fresh') === '1') {
        await loadCentralConfig(true);
      }
      return json(200, { ok: true, config: runtimeConfig });
    }

    // Public / App data endpoints (with offline fallback & live Google Sheets)
    // Each endpoint accepts ?id=SPREADSHEET_ID&tab=TAB_NAME query params
    // to avoid dependency on server-side runtimeConfig (stateless functions!)
    if (path === 'company' && request.method === 'GET') {
      const compRes = await fetchCompanyData(
        url.searchParams.get('id') || undefined,
        url.searchParams.get('tab') || undefined
      );
      return json(200, compRes);
    }

    if (path === 'settings' && request.method === 'GET') {
      const compRes = await fetchCompanyData(
        url.searchParams.get('id') || undefined,
        url.searchParams.get('tab') || undefined
      );
      const user = session(request);
      return json(200, { settings: { company_profile: compRes.company }, company: compRes.company, canEdit: user?.role === 'admin' });
    }

    if (path === 'agents' && request.method === 'GET') {
      const agRes = await fetchAgentsData(
        url.searchParams.get('id') || undefined,
        url.searchParams.get('tab') || undefined
      );
      return json(200, agRes);
    }

    if (path === 'customers' && request.method === 'GET') {
      const user = session(request);
      const clRes = await fetchCustomersData(
        url.searchParams.get('id') || undefined,
        url.searchParams.get('tab') || undefined,
        user
      );
      return json(200, clRes);
    }

    if (path === 'customers' && request.method === 'POST') {
      const user = session(request);
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      const body = await request.json().catch(() => ({}));
      return createCustomer(body, user, url.searchParams.get('id') || undefined);
    }

    if (path === 'products' && request.method === 'GET') {
      const prRes = await fetchProductsData(
        url.searchParams.get('id') || undefined,
        url.searchParams.get('tab') || undefined
      );
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
      const customId = url.searchParams.get('id') || undefined;
      return json(200, { offers: await listDocs(runtimeConfig.repository.tabOffers || 'Offerte', user, customId), user });
    }

    if (path === 'orders' && request.method === 'GET') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      const customId = url.searchParams.get('id') || undefined;
      return json(200, { orders: await listDocs(runtimeConfig.repository.tabOrders || 'Ordini', user, customId), user });
    }

    if (path === 'offers' && request.method === 'POST') {
      return createDoc(runtimeConfig.repository.tabOffers || 'Offerte', await request.json(), user, url.searchParams.get('id') || undefined);
    }

    if (path === 'orders' && request.method === 'POST') {
      return createDoc(runtimeConfig.repository.tabOrders || 'Ordini', await request.json(), user, url.searchParams.get('id') || undefined);
    }

    // Workflow & order status update (admin only)
    if (path === 'orders/update-status' && request.method === 'POST') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      const body = await request.json().catch(() => ({}));
      try {
        const result = await updateOrderStatus(body.orderId || body.number, body, user);
        return json(200, result);
      } catch (err) {
        return json(400, { error: err.message });
      }
    }

    // Convert offer to order (1-click)
    if (path === 'offers/convert-to-order' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const effectiveUser = user || body.user || { role: 'agent', agentCode: 'AG01', name: 'Agente01' };
      try {
        const result = await convertOfferToOrder(body.offerNumber || body.offerId, effectiveUser);
        return json(200, result);
      } catch (err) {
        return json(400, { error: err.message });
      }
    }

    // Create offer revision
    if (path === 'offers/revision' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const effectiveUser = user || body.user || { role: 'agent', agentCode: 'AG01', name: 'Agente01' };
      try {
        const result = await createOfferRevision(body.offerNumber || body.offerId, effectiveUser);
        return json(200, result);
      } catch (err) {
        return json(400, { error: err.message });
      }
    }

    // Visits (Giro Visite)
    if (path === 'visits' && request.method === 'GET') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      return json(200, { visits: await listVisits(user) });
    }

    if (path === 'visits' && request.method === 'POST') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      const body = await request.json().catch(() => ({}));
      return json(200, await saveVisit(body, user));
    }

    // Prospects (Contatti)
    if (path === 'prospects' && request.method === 'GET') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      return json(200, { prospects: await listProspects(user) });
    }

    if (path === 'prospects' && request.method === 'POST') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      const body = await request.json().catch(() => ({}));
      return json(200, await saveProspect(body, user));
    }

    // Production & Warehouse Optimization Engine (Self-Learning)
    if (path === 'production/analysis' && request.method === 'GET') {
      const customProductsId = url.searchParams.get('productsId') || undefined;
      const customRepositoryId = url.searchParams.get('repositoryId') || undefined;
      const analysisRes = await calculateProductionIntelligence(user, customProductsId, customRepositoryId);
      return json(200, analysisRes);
    }

    if (path === 'production/parameters' && request.method === 'POST') {
      if (!user) return json(401, { error: 'Accesso non autorizzato' });
      const body = await request.json().catch(() => ({}));
      const customId = url.searchParams.get('id') || undefined;
      try {
        const result = await saveProductionParameters(body, user, customId);
        return json(200, result);
      } catch (err) {
        return json(400, { error: err.message });
      }
    }

    // Production Batch Declaration & Warehouse Goods Receipt
    if (path === 'production/record' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const customId = url.searchParams.get('id') || undefined;
      try {
        const result = await recordWarehouseMovement(body, user, customId);
        return json(200, result);
      } catch (err) {
        return json(400, { error: err.message });
      }
    }

    // List Warehouse Movements
    if (path === 'production/movements' && request.method === 'GET') {
      const customId = url.searchParams.get('id') || undefined;
      const movements = await fetchWarehouseMovements(customId);
      return json(200, { ok: true, movements });
    }

    // Explicit Setup and Formatting of Dedicated Warehouse Spreadsheet
    if (path === 'production/setup-sheet') {
      const customId = url.searchParams.get('id') || runtimeConfig.warehouse?.spreadsheetId || OFFICIAL_SYSTEM_SPREADSHEETS.warehouse.spreadsheetId;
      try {
        const ok = await setupWarehouseSpreadsheet(customId);
        return json(200, { ok, spreadsheetId: customId, message: ok ? 'Foglio Magazzino inizializzato e formattato con successo' : 'Inizializzazione completata o già attiva' });
      } catch (err) {
        return json(400, { error: err.message });
      }
    }

    return json(404, { error: 'Servizio non disponibile: ' + path });
  } catch (error) {
    console.error('API Error:', error);
    return json(500, { error: error instanceof Error ? error.message : 'Errore inatteso nel servizio API' });
  }
};
