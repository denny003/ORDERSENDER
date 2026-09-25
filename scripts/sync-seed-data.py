import urllib.request
import json

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode('utf-8'))

print("Fetching agents...")
ag = fetch_json('https://ordersender.netlify.app/api/agents?id=13HaTubf4_xVTtzkQUcYINkRtuSzLR2qGzJAiA-oAecU&tab=Agenti')
print("Fetching customers...")
cust = fetch_json('https://ordersender.netlify.app/api/customers?id=1rkFDBTCJD3JlrcvyOPGHjYTJDkjuMc24dJ7l6EqQ6I8&tab=clienti')
print("Fetching products...")
prod = fetch_json('https://ordersender.netlify.app/api/products?id=17ErnowHZDqA3WDTN5auHkyTBPVn4MqkI8BFkiqkDhmE&tab=q_listino_prezzi_catalogo')
print("Fetching company...")
comp = fetch_json('https://ordersender.netlify.app/api/company?id=1-ntNPKA3gdjZaxYntGNkXtKC5Kt4JIXGSoQfESO169M&tab=Dati%20azienda')

seed = {
    'company': comp.get('company', {}),
    'agents': ag.get('agents', []),
    'hierarchy': ag.get('hierarchy', {}),
    'clients': cust.get('customers', []),
    'articles': prod.get('products', []),
    'meta': {
        'generatedAt': '2026-09-25T09:30:00Z',
        'source': 'Google Sheets Live API',
        'articleCount': len(prod.get('products', [])),
        'clientCount': len(cust.get('customers', [])),
        'agentCount': len(ag.get('agents', []))
    }
}

with open('site/seed-data.json', 'w', encoding='utf-8') as f:
    json.dump(seed, f, ensure_ascii=False, indent=2)

print('Updated seed-data.json successfully!')
print("Agents count:", len(seed['agents']))
print("Clients count:", len(seed['clients']))
print("Articles count:", len(seed['articles']))
