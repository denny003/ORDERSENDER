# Aggiornamento GitHub - Configurazione Google Drive

## Nuova configurazione azienda

La configurazione deve contenere:

- sourceClientsFolder
- sourceProductsFolder
- sourceAgentsFolder
- repositoryFolder
- registerSpreadsheetId
- registerFileName

## Flusso

1. L'amministratore inserisce i collegamenti Google Drive.
2. L'app salva la configurazione aziendale.
3. Il gateway usa repositoryFolder e registerSpreadsheetId per sincronizzare:
   - Offerte
   - Ordini
   - Stati
   - Log sincronizzazione

## Commit consigliato

feat: add configurable Google Drive repository settings

## Variabili ambiente Netlify

Aggiungere:

GOOGLE_REPOSITORY_ID
REGISTER_SPREADSHEET_ID
SHEETS_SYNC_SECRET
