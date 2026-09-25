// Unified company and Google Sheets configuration
window.companyConfig = window.companyConfig || {
  company: {
    sheetName: "Dati_Azienda_e_Mandanti",
    spreadsheetId: "1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0",
    tab: "Dati azienda"
  },
  agents: {
    fileName: "Anagrafica_Agenti",
    spreadsheetId: "1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0",
    tab: "Agenti"
  },
  customers: {
    fileName: "clienti",
    spreadsheetId: "1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0",
    tab: "clienti"
  },
  products: {
    fileName: "Articoli",
    spreadsheetId: "1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0",
    tab: "q_listino_prezzi_catalogo"
  },
  repository: {
    folder: "Repository",
    fileName: "Registro offerte e ordini",
    spreadsheetId: "1N6ZcGa2r6Qc4KzkIIUg7cgfhkMajMnippGg6U_fx2Z4",
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

async function loadCompanyConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      if (data && data.config) {
        window.companyConfig = { ...window.companyConfig, ...data.config };
        try { localStorage.setItem('companyConfig', JSON.stringify(window.companyConfig)); } catch (e) {}
        return window.companyConfig;
      }
    }
  } catch (e) {}

  try {
    const saved = localStorage.getItem('companyConfig');
    if (saved) {
      window.companyConfig = { ...window.companyConfig, ...JSON.parse(saved) };
    }
  } catch (e) {}
  return window.companyConfig;
}

async function saveCompanyConfig(cfg) {
  window.companyConfig = {
    ...window.companyConfig,
    ...cfg,
    lastUpdate: new Date().toISOString(),
    source: 'Configurazione amministratore'
  };
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
