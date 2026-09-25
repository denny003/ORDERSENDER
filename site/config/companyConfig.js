// Unified company and Google Sheets configuration
function getStoredConfig() {
  try {
    const raw = localStorage.getItem('companyConfig');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (e) {}
  return null;
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
    spreadsheetId: "1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnlVlenn-Fjc",
    tabOffers: "Offerte",
    tabOrders: "Ordini"
  },
  googleDrive: {
    sourceFolderUrl: "https://drive.google.com/drive/folders/1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9",
    folderId: "1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9"
  },
  lastUpdate: "",
  source: ""
};

// Immediate synchronous initialization from localStorage if available
const storedInitial = getStoredConfig();
window.companyConfig = deepMergeConfig(defaultConfig, storedInitial || {});

async function loadCompanyConfig() {
  const local = getStoredConfig();
  // If localStorage has user-saved configuration, it is the primary authority
  if (local && (local.source === 'Configurazione amministratore' || local.lastUpdate)) {
    window.companyConfig = deepMergeConfig(defaultConfig, local);
    // Sync to server in background so serverless functions know the custom IDs
    try {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(window.companyConfig)
      }).catch(() => {});
    } catch (e) {}
    return window.companyConfig;
  }

  // Fallback: try fetching from server (only when no local admin config exists)
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      if (data && data.config) {
        window.companyConfig = deepMergeConfig(defaultConfig, data.config);
        // Only write to localStorage if there's no existing admin config
        const existingLocal = getStoredConfig();
        if (!existingLocal || (!existingLocal.source && !existingLocal.lastUpdate)) {
          try { localStorage.setItem('companyConfig', JSON.stringify(window.companyConfig)); } catch (e) {}
        }
        return window.companyConfig;
      }
    }
  } catch (e) {}

  return window.companyConfig;
}

async function saveCompanyConfig(cfg) {
  window.companyConfig = deepMergeConfig(window.companyConfig || defaultConfig, {
    ...cfg,
    lastUpdate: new Date().toISOString(),
    source: 'Configurazione amministratore'
  });

  try {
    localStorage.setItem('companyConfig', JSON.stringify(window.companyConfig));
  } catch (e) {}

  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(window.companyConfig)
    });
  } catch (e) {}

  return window.companyConfig;
}
