# Offerte Agenti — pilota Netlify

## Importazione

Poiché il pilota comprende funzioni protette lato server, non va pubblicato con il semplice trascinamento in Netlify Drop, che carica soltanto pagine statiche.

1. Estrarre lo ZIP in una cartella.
2. Caricare la cartella in un repository GitHub privato e scegliere in Netlify **Add new site → Import an existing project**. In alternativa, dalla cartella usare `npx netlify-cli deploy --build --prod`.
3. Lasciare le impostazioni di compilazione vuote: Netlify leggerà automaticamente `netlify.toml`.
4. In **Site configuration → Environment variables** aggiungere le variabili elencate sotto.
5. Eseguire un nuovo deploy dopo aver salvato le variabili.

## Variabili obbligatorie

- `SESSION_SECRET`: stringa casuale lunga almeno 32 caratteri.
- `PILOT_USERS`: elenco JSON degli utenti autorizzati. Esempio:
  `[{"username":"agente01","password":"cambiare-password","name":"Federico Micozzi","role":"agent","agentCode":"AG01"},{"username":"amministrazione","password":"cambiare-password","name":"Amministrazione","role":"admin","agentCode":"AG01"}]`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: e-mail dell’account di servizio Google.
- `GOOGLE_PRIVATE_KEY`: chiave privata completa dell’account di servizio.

## Variabili già preimpostate, modificabili

- `COMPANY_SPREADSHEET_ID`: `1mnW70V3qcnc5nOeIMeLb5tANSl8VeDBi9Awn4H9qSJ0`
- `REGISTER_SPREADSHEET_ID`: `1N6ZcGa2r6Qc4KzkIIUg7cgfhkMajMnippGg6U_fx2Z4`

## Autorizzazione Google Drive

Condividere i fogli **Dati_Azienda_e_Mandanti** e **Registro offerte e ordini** con l’e-mail indicata in `GOOGLE_SERVICE_ACCOUNT_EMAIL`. Il primo può essere condiviso in lettura; il registro deve essere condiviso come editor.

## Note di sicurezza

Non inserire password o chiavi direttamente nei file del progetto. Le credenziali restano nelle variabili protette di Netlify. Per il test iniziale usare password temporanee e cambiarle prima dell’uso reale.

## Funzionamento

- I dati aziendali vengono letti quando si apre una nuova offerta o un nuovo ordine, non a intervalli periodici.
- Le offerte sono registrate nella scheda `Offerte`.
- Gli ordini sono registrati nella scheda `Ordini`.
- Ogni agente vede soltanto le pratiche associate al proprio `agentCode`; l’amministratore vede tutte le pratiche.
- Catalogo e clienti sono disponibili anche offline attraverso l’archivio incluso nel pacchetto.
