// Unified company and Google Sheets configuration
// Central cloud-synced architecture: configuration is stored in Google Drive and shared across all devices and agents.

const defaultConfig = {
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
  source: "Configurazione predefinita Google Drive"
};

function isMockId(id) {
  if (!id || typeof id !== 'string') return false;
  return id.includes('1mnW') || id.includes('1N6ZcGa');
}

function sanitizeConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return null;
  const c = JSON.parse(JSON.stringify(cfg));
  if (isMockId(c.company?.spreadsheetId)) c.company.spreadsheetId = defaultConfig.company.spreadsheetId;
  if (isMockId(c.agents?.spreadsheetId)) c.agents.spreadsheetId = defaultConfig.agents.spreadsheetId;
  if (isMockId(c.customers?.spreadsheetId)) c.customers.spreadsheetId = defaultConfig.customers.spreadsheetId;
  if (isMockId(c.products?.spreadsheetId)) c.products.spreadsheetId = defaultConfig.products.spreadsheetId;
  if (isMockId(c.repository?.spreadsheetId)) c.repository.spreadsheetId = defaultConfig.repository.spreadsheetId;
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

// Automatically sync cloud configuration in background on page load
if (typeof window !== 'undefined') {
  window.companyConfigPromise = loadCompanyConfig();
}
