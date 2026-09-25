// Unified company and Google Sheets configuration
// ID fissi immutabili da GOOGLE-DRIVE/dati-configurazione: nessun agente deve mai inserirli a mano!

const OFFICIAL_SYSTEM_SPREADSHEETS = Object.freeze({
  company: {
    sheetName: "Dati_Azienda_e_Mandanti",
    spreadsheetId: "1-ntNPKA3gdjZaxYntGNkXtKC5Kt4JIXGSoQfESO169M",
    tab: "Dati azienda"
  },
  agents: {
    fileName: "Anagrafica_Agenti",
    spreadsheetId: "13HaTubf4_xVTtzkQUcYINkRtuSzLR2qGzJAiA-oAecU",
    tab: "Agenti"
  },
  customers: {
    fileName: "clienti",
    spreadsheetId: "1rkFDBTCJD3JlrcvyOPGHjYTJDkjuMc24dJ7l6EqQ6I8",
    tab: "clienti"
  },
  products: {
    fileName: "Articoli",
    spreadsheetId: "17ErnowHZDqA3WDTN5auHkyTBPVn4MqkI8BFkiqkDhmE",
    tab: "q_listino_prezzi_catalogo"
  },
  repository: {
    folder: "Repository",
    fileName: "Registro offerte e ordini",
    spreadsheetId: "1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnIVIenn-Fjc",
    tabOffers: "Offerte",
    tabOrders: "Ordini"
  },
  googleDrive: {
    sourceFolderUrl: "https://drive.google.com/drive/folders/1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9",
    folderId: "1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9"
  },
  lastUpdate: "",
  source: "Configurazione fissa di sistema (Google Drive)"
});

const defaultConfig = JSON.parse(JSON.stringify(OFFICIAL_SYSTEM_SPREADSHEETS));

function isInvalidSpreadsheetId(id) {
  if (!id || typeof id !== 'string') return true;
  const s = id.trim();
  if (s.length < 20) return true;
  if (s.includes('1mnW') || s.includes('1N6ZcGa') || s.includes('undefined') || s.includes('null')) return true;
  return false;
}

function sanitizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return JSON.parse(JSON.stringify(OFFICIAL_SYSTEM_SPREADSHEETS));
  const c = JSON.parse(JSON.stringify(cfg));
  c.company = c.company || {};
  c.agents = c.agents || {};
  c.customers = c.customers || {};
  c.products = c.products || {};
  c.repository = c.repository || {};
  c.googleDrive = c.googleDrive || {};

  if (isInvalidSpreadsheetId(c.company?.spreadsheetId)) c.company.spreadsheetId = OFFICIAL_SYSTEM_SPREADSHEETS.company.spreadsheetId;
  if (!c.company.sheetName) c.company.sheetName = OFFICIAL_SYSTEM_SPREADSHEETS.company.sheetName;
  if (!c.company.tab) c.company.tab = OFFICIAL_SYSTEM_SPREADSHEETS.company.tab;

  if (isInvalidSpreadsheetId(c.agents?.spreadsheetId)) c.agents.spreadsheetId = OFFICIAL_SYSTEM_SPREADSHEETS.agents.spreadsheetId;
  if (!c.agents.fileName) c.agents.fileName = OFFICIAL_SYSTEM_SPREADSHEETS.agents.fileName;
  if (!c.agents.tab) c.agents.tab = OFFICIAL_SYSTEM_SPREADSHEETS.agents.tab;

  if (isInvalidSpreadsheetId(c.customers?.spreadsheetId)) c.customers.spreadsheetId = OFFICIAL_SYSTEM_SPREADSHEETS.customers.spreadsheetId;
  if (!c.customers.fileName) c.customers.fileName = OFFICIAL_SYSTEM_SPREADSHEETS.customers.fileName;
  if (!c.customers.tab) c.customers.tab = OFFICIAL_SYSTEM_SPREADSHEETS.customers.tab;

  if (isInvalidSpreadsheetId(c.products?.spreadsheetId)) c.products.spreadsheetId = OFFICIAL_SYSTEM_SPREADSHEETS.products.spreadsheetId;
  if (!c.products.fileName) c.products.fileName = OFFICIAL_SYSTEM_SPREADSHEETS.products.fileName;
  if (!c.products.tab) c.products.tab = OFFICIAL_SYSTEM_SPREADSHEETS.products.tab;

  if (isInvalidSpreadsheetId(c.repository?.spreadsheetId)) c.repository.spreadsheetId = OFFICIAL_SYSTEM_SPREADSHEETS.repository.spreadsheetId;
  if (!c.repository.folder) c.repository.folder = OFFICIAL_SYSTEM_SPREADSHEETS.repository.folder;
  if (!c.repository.fileName) c.repository.fileName = OFFICIAL_SYSTEM_SPREADSHEETS.repository.fileName;
  if (!c.repository.tabOffers) c.repository.tabOffers = OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOffers;
  if (!c.repository.tabOrders) c.repository.tabOrders = OFFICIAL_SYSTEM_SPREADSHEETS.repository.tabOrders;

  if (!c.googleDrive.folderId) c.googleDrive.folderId = OFFICIAL_SYSTEM_SPREADSHEETS.googleDrive.folderId;
  if (!c.googleDrive.sourceFolderUrl) c.googleDrive.sourceFolderUrl = OFFICIAL_SYSTEM_SPREADSHEETS.googleDrive.sourceFolderUrl;

  return c;
}

function deepMergeConfig(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMergeConfig(result[key] || {}, override[key]);
    } else if (override[key] !== undefined && override[key] !== null) {
      result[key] = override[key];
    }
  }
  return result;
}

function getStoredConfig() {
  try {
    const raw = localStorage.getItem('companyConfig');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const cleaned = sanitizeConfig(parsed);
        if (JSON.stringify(cleaned) !== raw) {
          try { localStorage.setItem('companyConfig', JSON.stringify(cleaned)); } catch (e) {}
        }
        return cleaned;
      }
    }
  } catch (e) {}
  return null;
}

// Immediate synchronous initialization from localStorage or defaults
const storedInitial = getStoredConfig();
window.companyConfig = deepMergeConfig(defaultConfig, storedInitial || {});

// Fetch central cloud configuration from server (Google Sheets backed)
async function loadCompanyConfig(forceFresh = false) {
  try {
    const url = forceFresh ? `/api/config?fresh=1&_t=${Date.now()}` : '/api/config';
    const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.config) {
        const serverCfg = sanitizeConfig(data.config);
        window.companyConfig = deepMergeConfig(defaultConfig, serverCfg);
        try {
          localStorage.setItem('companyConfig', JSON.stringify(window.companyConfig));
        } catch (e) {}
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('companyConfigUpdated', { detail: window.companyConfig }));
        }
        return window.companyConfig;
      }
    }
  } catch (e) {
    console.warn('Impossibile contattare /api/config per la configurazione centrale (fallback locale/offline):', e.message);
  }

  // Fallback to local storage (offline)
  const local = getStoredConfig();
  if (local) {
    window.companyConfig = deepMergeConfig(defaultConfig, local);
  } else {
    window.companyConfig = { ...defaultConfig };
  }
  return window.companyConfig;
}

// Save central configuration (persists in Google Sheets via /api/config so all devices share it)
async function saveCompanyConfig(cfg) {
  const merged = deepMergeConfig(window.companyConfig || defaultConfig, {
    ...cfg,
    lastUpdate: new Date().toISOString(),
    source: 'Configurazione centrale Google Drive'
  });
  window.companyConfig = sanitizeConfig(merged);

  try {
    localStorage.setItem('companyConfig', JSON.stringify(window.companyConfig));
  } catch (e) {}

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(window.companyConfig)
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.config) {
        window.companyConfig = deepMergeConfig(defaultConfig, sanitizeConfig(data.config));
        try {
          localStorage.setItem('companyConfig', JSON.stringify(window.companyConfig));
        } catch (e) {}
      }
    }
  } catch (e) {
    console.warn('Errore salvataggio configurazione centrale su server:', e.message);
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('companyConfigUpdated', { detail: window.companyConfig }));
  }
  return window.companyConfig;
}

if (typeof window !== 'undefined') {
  window.OFFICIAL_SYSTEM_SPREADSHEETS = OFFICIAL_SYSTEM_SPREADSHEETS;
  window.companyConfigPromise = loadCompanyConfig();
}

