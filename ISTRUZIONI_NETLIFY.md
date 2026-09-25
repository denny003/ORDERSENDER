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

### Spreadsheet ID e Cartella Condivisa (Predefiniti di sistema e salvabili su Cloud)
- `COMPANY_SPREADSHEET_ID`: `1-ntNPKA3gdjZaxYntGNkXtKC5Kt4JIXGSoQfESO169M` (`Dati_Azienda_e_Mandanti`)
- `AGENTS_SPREADSHEET_ID`: `13HaTubf4_xVTtzkQUcYINkRtuSzLR2qGzJAiA-oAecU` (`Anagrafica_Agenti`)
- `CUSTOMERS_SPREADSHEET_ID`: `1rkFDBTCJD3JlrcvyOPGHjYTJDkjuMc24dJ7l6EqQ6I8` (`clienti`)
- `PRODUCTS_SPREADSHEET_ID`: `17ErnowHZDqA3WDTN5auHkyTBPVn4MqkI8BFkiqkDhmE` (`Articoli`)
- `REGISTER_SPREADSHEET_ID`: `1Hi1Nppj4szI4UwfSeC632KkpF0dEQjqxnIVIenn-Fjc` (`Registro offerte e ordini`)
- `DRIVE_FOLDER_ID`: `1lr8lThQr1SxP4LAx2n69_pDxwu36ifh9` (Cartella condivisa Google Drive)

> 💡 **Configurazione Centrale Unificata:** Quando l'Amministratore salva la configurazione da `/configurazione.html`, i parametri vengono memorizzati direttamente sul foglio Google Drive centrale (scheda `_Configurazione`) e propagati automaticamente in tempo reale a **tutti gli agenti e dispositivi**. Gli agenti accedono da smartphone e trovano già tutto configurato e funzionante.

## Pagina di Configurazione e Controllo Connessioni

La nuova pagina amministrativa è accessibile all'indirizzo `/configurazione.html` (o `/configurazione`) e contiene il pannello **CONTROLLO CONNESSIONI**:
- **Google Sheets API**: 🟢 Collegato / 🔴 Non collegato
- **Dati Azienda**: 🟢 Letto / 🔴 Non letto
- **Agenti**: 🟢 11 record
- **Clienti**: 🟢 [N] record caricati
- **Articoli**: 🟢 [N] record caricati
- **Repository**: 🟢 Scrittura attiva

## Nuova Gestione Ordini & Magazzino (`/gestione-ordini`)

Pagina dedicata all'Amministrazione e al Magazzino per seguire l'intero ciclo di evasione:
- **Pipeline Kanban & Tab di Stato**:
  - `Ricevuti`: nuovi ordini acquisiti dagli agenti da verificare.
  - `In lavorazione`: ordini confermati e approvati per evasione.
  - `Magazzino / Picking`: materiale in fase di prelievo con pulsante **Stampa Distinta Picking** (con codici, descrizioni, quantità e caselle di spunta).
  - `Spediti con DDT`: ordini spediti con bolla DDT generabile/stampabile, tracking corriere e link diretto di tracciamento.
  - `Fatturati`: ordini conclusi e registrati per fatturazione.
- **DDT & Tracking**:
  - Assegnazione automatica o manuale di Numero DDT, Data Bolla, Corriere (GLS, BRT, DHL, TNT/FedEx, Poste, etc.), Codice Tracking e Data Spedizione.
  - Aggiornamento in tempo reale sul foglio Google Drive centrale (colonne O-T del foglio `Ordini`).

## Giro Visite & Marketing Agenti (`/giro-visite`)

Tool dedicato agli agenti su smartphone/tablet per ottimizzare le visite commerciali e gestire prospect:
- **Agenda Giro Visite**:
  - Elenco visite pianificate, completate o in follow-up.
  - Tasto rapido **🗺️ Naviga GPS** (apre Google Maps con l'indirizzo del cliente o prospect).
  - Tasto rapido **📞 Chiama** (avvia la chiamata telefonica direttamente dal cellulare).
  - Esito visita, note commerciali e promemoria data di richiamo/follow-up.
- **Rubrica Contatti & Nuovi Prospect**:
  - Inserimento rapido di nuovi lead/contatti.
  - Pulsante **"Pianifica Visita"** e pulsante **"⚡ Crea Offerta"** (che precarica il cliente nella pagina di offerta).
- I dati vengono salvati sul foglio `Registro offerte e ordini` nelle nuove schede dedicate `Giro_Visite` e `Contatti_Prospect`.

## Funzioni Rapide per Agenti (Dashboard `/index.html`)

- **⚡ Trasforma in Ordine**: con 1 clic l'agente converte un'offerta accettata in ordine ufficiale (genera codice `ORD-...`, collega l'offerta di origine e aggiorna lo stato su Google Sheets).
- **✏️ Nuova Revisione**: crea al volo una copia di revisione versionata (`-R1`, `-R2`, ecc.) per modifiche contrattuali preservando lo storico.
- **Badge Stato Spedizione**: l'agente vede istantaneamente su smartphone lo stato dell'ordine (es. `📦 In magazzino`, `🚚 Spedito: DDT 2026/0412 - GLS (123456)`).

## Condivisione Fogli Google Drive
Condividere i fogli con l'indirizzo e-mail specificato in `GOOGLE_SERVICE_ACCOUNT_EMAIL`:
- I fogli catalogo (`Dati_Azienda_e_Mandanti`, `Anagrafica_Agenti`, `clienti`, `Articoli`): condivisione come **Visualizzatore** (Viewer) o **Editor**.
- Il foglio repository `Registro offerte e ordini`: condivisione obbligatoria come **Editor** (permettere la scrittura di nuove offerte, ordini, DDT/tracking, visite e prospect).

## Flusso Applicativo
```
offer-app.js & mobile dashboard
      │
      ├──> /api/company   ──> Google Sheets ("Dati azienda")
      ├──> /api/agents    ──> Google Sheets ("Agenti")
      ├──> /api/customers ──> Google Sheets ("clienti")
      ├──> /api/products  ──> Google Sheets ("q_listino_prezzi_catalogo")
      │
      ├──> /api/offers & /api/orders ──> Google Sheets ("Offerte", "Ordini")
      ├──> /api/orders/update-status ──> Aggiornamento stato ordine, DDT e Tracking
      ├──> /api/offers/convert-to-order ──> Conversione 1-Click Offerta -> Ordine
      ├──> /api/offers/revision      ──> Creazione revisioni versionate (-R1, -R2)
      └──> /api/visits & /api/prospects ──> Google Sheets ("Giro_Visite", "Contatti_Prospect")
```
Se la rete è offline, l'applicazione carica automaticamente l'ultima copia salvata in locale (IndexedDB / cache Service Worker) per garantire la continuità operativa degli agenti anche in assenza di copertura di rete.

