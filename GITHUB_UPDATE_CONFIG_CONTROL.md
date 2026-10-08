# Aggiornamento GitHub & Netlify — Risoluzione Agente 10 (Daniele Samà)

Commit consigliato:

`fix: resolve Agent 10 customer visibility and syntax initialization on offer page`

### Interventi eseguiti:
1. **Risolto blocco caricamento pagina offerte (`site/offer-app.js`):**
   - Eliminato l'errore di sintassi (`Unexpected end of input`) che bloccava l'esecuzione dello script.
   - Inizializzazione immediata della data, intestazione, numero offerta e profilo aziendale all'avvio.
   - Aggiunto `try/catch` difensivo sugli eventi del DOM.
2. **Visibilità e assegnazione clienti per Agente 10 (`AG10`, `AG010`, Daniele Samà):**
   - In `netlify/functions/api.mjs`: potenziata la funzione `normalizeAgentId` per riconoscere automaticamente tutte le varianti di codice (`AG10`, `AG010`, `10`, `Agente 10`) e i nomi anagrafici (`Daniele Samà`, `Daniele sama’`, `sama`).
   - Il filtro serverless `/api/customers` ora restituisce correttamente tutti i clienti associati all'Agente 10.
   - In `site/offer-app.js`: allineata la funzione `normalizeAgentCode` e il filtro `visibleClients()`.
3. **Invalidazione Cache & Service Worker:**
   - Aggiornata la versione della cache del Service Worker a `offerte-agenti-v38` (`site/sw.js`).
   - Aggiunto parametro di cache-busting `?v=20261008-fix10` su `site/offerta.html`.
   - Aggiunto script di recupero rapido per forzare la cancellazione della vecchia cache corrotta.

### Istruzioni operative per l'utente:
1. Effettuare il commit e push del repository su GitHub per innescare il deploy automatico di Netlify.
2. Una volta completato il deploy su Netlify:
   - Su Google Chrome, aprire `https://ordersender.netlify.app/offerta?new=1&type=offer` e premere **Ctrl + F5** (oppure **Ctrl + Shift + R**) per ricaricare la pagina bypassando la vecchia cache.
   - Effettuare il login come Agente 10: il menu clienti mostrerà immediatamente i clienti assegnati e sarà possibile generare e inviare offerte senza alcun blocco.

