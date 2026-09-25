# Aggiornamento GitHub

Commit consigliato:

`feat: integrate Google Drive and Sheets architecture with diagnostic connection panel and dynamic endpoints`

Contenuto aggiornato:
- Nuova pagina configurazione amministratore (`site/configurazione.html`) con gestione di:
  - Azienda (`Dati_Azienda_e_Mandanti`)
  - Agenti (`Anagrafica_Agenti`)
  - Clienti (`clienti`)
  - Articoli (`Articoli`)
  - Repository (`Registro offerte e ordini`)
- Pannello diagnostico live **CONTROLLO CONNESSIONI**:
  - Google Sheets API
  - Dati Azienda
  - Agenti (11 record)
  - Clienti (record caricati)
  - Articoli (record caricati)
  - Repository (Scrittura attiva)
- Endpoint serverless Netlify dedicati in `netlify/functions/api.mjs`:
  - `/api/company`
  - `/api/agents`
  - `/api/customers`
  - `/api/products`
  - `/api/diagnostics`
  - `/api/config`
  - `/api/offers` & `/api/orders`
- Eliminata la logica di dati scritti nel codice in `site/offer-app.js`.
- Conservata la piena resilienza offline (IndexedDB + PWA cache Service Worker).
- Generato pacchetto `netlify_google_sheets_connector_ready.zip`.
