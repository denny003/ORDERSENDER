# Offerte Agenti — Connettore Google Drive & Netlify

## Architettura Google Drive

```
Google Drive condiviso (Cartella: 1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9)
│
├── Dati_Azienda_e_Mandanti (Google Sheet)
├── Anagrafica_Agenti (Google Sheet)
├── clienti (Google Sheet)
├── Articoli (Google Sheet)
│
└── Repository
      └── Registro offerte e ordini (Google Sheet)
```

Link cartella condivisa: [Cartella Google Drive](https://drive.google.com/drive/folders/1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9)

## Importazione e Deploy

1. Il codice è pronto per essere inviato a GitHub. Netlify ricostruirà automaticamente il sito ad ogni commit.
2. In Netlify (**Site configuration → Environment variables**) verificare o aggiungere le variabili d'ambiente.
3. Eseguire un nuovo deploy dopo aver salvato le variabili.

## Variabili Netlify

### Obbligatorie per Google Sheets API live
- `SESSION_SECRET`: stringa segreta casuale di almeno 32 caratteri.
- `PILOT_USERS`: elenco JSON degli utenti autorizzati. Esempio:
  ```json
  [
    {"username":"agente01","password":"cambiare-password","name":"Federico Micozzi","role":"agent","agentCode":"AG01"},
    {"username":"amministrazione","password":"cambiare-password","name":"Amministrazione","role":"admin","agentCode":"AG01"}
  ]
  ```
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: e-mail dell'account di servizio Google (es. `xxx@xxx.iam.gserviceaccount.com`).
- `GOOGLE_PRIVATE_KEY`: chiave privata RSA completa (`-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----`).

### Spreadsheet ID configurabili via Environment Variables o da `/configurazione.html`
- `COMPANY_SPREADSHEET_ID`: ID del foglio `Dati_Azienda_e_Mandanti` (predefinito: `1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0`)
- `AGENTS_SPREADSHEET_ID`: ID del foglio `Anagrafica_Agenti`
- `CUSTOMERS_SPREADSHEET_ID`: ID del foglio `clienti`
- `PRODUCTS_SPREADSHEET_ID`: ID del foglio `Articoli`
- `REGISTER_SPREADSHEET_ID`: ID del foglio `Registro offerte e ordini` (predefinito: `1N6ZcGa2r6Qc4KzkIIUg7cgfhkMajMnippGg6U_fx2Z4`)

## Pagina di Configurazione e Controllo Connessioni

La nuova pagina amministrativa è accessibile all'indirizzo `/configurazione.html` (o `/configurazione`) e contiene il pannello **CONTROLLO CONNESSIONI**:
- **Google Sheets API**: 🟢 Collegato / 🔴 Non collegato
- **Dati Azienda**: 🟢 Letto / 🔴 Non letto
- **Agenti**: 🟢 11 record
- **Clienti**: 🟢 [N] record caricati
- **Articoli**: 🟢 [N] record caricati
- **Repository**: 🟢 Scrittura attiva

## Condivisione Fogli Google Drive
Condividere i fogli con l'indirizzo e-mail specificato in `GOOGLE_SERVICE_ACCOUNT_EMAIL`:
- I fogli catalogo (`Dati_Azienda_e_Mandanti`, `Anagrafica_Agenti`, `clienti`, `Articoli`): condivisione come **Visualizzatore** (Viewer) o **Editor**.
- Il foglio repository `Registro offerte e ordini`: condivisione obbligatoria come **Editor** (permettere la scrittura di nuove offerte e ordini).

## Flusso Applicativo
```
offer-app.js
      │
      ├──> /api/company   ──> Google Sheets ("Dati azienda")
      ├──> /api/agents    ──> Google Sheets ("Agenti")
      ├──> /api/customers ──> Google Sheets ("clienti")
      ├──> /api/products  ──> Google Sheets ("q_listino_prezzi_catalogo")
      │
      └──> /api/offers & /api/orders ──> Google Sheets Repository ("Offerte", "Ordini")
```
Se la rete è offline, l'applicazione carica automaticamente l'ultima copia salvata in locale (IndexedDB / cache Service Worker) per garantire la continuità operativa degli agenti anche in assenza di copertura di rete.
