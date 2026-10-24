import os
import sys
import json
import socket
import urllib.request
import urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8080
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SITE_DIR = os.path.join(BASE_DIR, 'site')
DATA_FILE = os.path.join(BASE_DIR, 'scripts', 'local_transfers.json')
REMOTE_API_BASE = 'https://ordersender.netlify.app'

# In-memory mock transfers seed if local_transfers.json doesn't exist
DEFAULT_TRANSFERS = [
    {
        "id": "MV-2026-001",
        "palletCode": "PAL-2026-001",
        "palletBarcode": "PAL-2026-001",
        "status": "allestito",
        "originSede": "Sede Centrale (Milano Hub)",
        "destinationSede": "Sede Logistica Nord (Bologna)",
        "createdAt": "2026-10-24T07:30:00Z",
        "departureDate": "",
        "arrivalDate": "",
        "carrier": "Mezzo Interno / Navetta",
        "operatorDeparture": "Mario Rossi",
        "operatorArrival": "",
        "notes": "Spedizione prioritaria per riassortimento scorte filiale",
        "totalBoxes": 12,
        "totalPieces": 288,
        "items": [
            {
                "code": "1610",
                "description": "CREMA IDRATANTE 50ML",
                "barcode": "8012345678901",
                "boxes": 5,
                "piecesPerBox": 24,
                "totalPieces": 120,
                "lot": "L2610-A",
                "pickedPieces": 0,
                "remainingPieces": 120
            },
            {
                "code": "1620",
                "description": "SIERO ANTI-AGE 30ML",
                "barcode": "8012345678918",
                "boxes": 7,
                "piecesPerBox": 24,
                "totalPieces": 168,
                "lot": "L2620-B",
                "pickedPieces": 0,
                "remainingPieces": 168
            }
        ],
        "pickupHistory": []
    },
    {
        "id": "MV-2026-002",
        "palletCode": "PAL-2026-002",
        "palletBarcode": "PAL-2026-002",
        "status": "in_transito",
        "originSede": "Sede Centrale (Milano Hub)",
        "destinationSede": "Sede Centro-Sud (Roma)",
        "createdAt": "2026-10-24T06:15:00Z",
        "departureDate": "2026-10-24T07:00:00Z",
        "arrivalDate": "",
        "carrier": "GLS Logistica Espressa",
        "operatorDeparture": "Marco Bianchi",
        "operatorArrival": "",
        "notes": "Camion partito stamattina ore 07:00",
        "totalBoxes": 15,
        "totalPieces": 360,
        "items": [
            {
                "code": "COMP-04",
                "description": "FLACONE VETRO 50ML AMBRATO",
                "barcode": "8023456789012",
                "boxes": 10,
                "piecesPerBox": 24,
                "totalPieces": 240,
                "lot": "VET-04",
                "pickedPieces": 0,
                "remainingPieces": 240
            },
            {
                "code": "COMP-08",
                "description": "POMPA DOSATRICE BIANCA",
                "barcode": "8023456789029",
                "boxes": 5,
                "piecesPerBox": 24,
                "totalPieces": 120,
                "lot": "POMP-08",
                "pickedPieces": 0,
                "remainingPieces": 120
            }
        ],
        "pickupHistory": []
    }
]

def load_transfers():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return list(DEFAULT_TRANSFERS)

def save_transfers(transfers):
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(transfers, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("Errore salvataggio local_transfers.json:", e)

class LocalDevHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS and caching headers for testing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        url_path = self.path.split('?')[0]

        # Route: GET /api/warehouse/transfers
        if url_path == '/api/warehouse/transfers':
            transfers = load_transfers()
            resp = json.dumps({'success': True, 'transfers': transfers}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        # Clean URLs redirects as per netlify.toml
        clean_routes = {
            '/': '/index.html',
            '/gestione-ordini': '/gestione-ordini.html',
            '/pianificazione-produzione': '/pianificazione-produzione.html',
            '/offerta': '/offerta.html',
            '/configurazione': '/configurazione.html',
            '/giro-visite': '/giro-visite.html',
            '/privacy': '/privacy.html'
        }
        if url_path in clean_routes:
            self.path = clean_routes[url_path] + (('?' + self.path.split('?')[1]) if '?' in self.path else '')
            return super().do_GET()

        # If it's another /api/ call, proxy to remote live netlify server
        if url_path.startswith('/api/'):
            self.proxy_remote_get()
            return

        return super().do_GET()

    def do_POST(self):
        url_path = self.path.split('?')[0]

        # Read POST body
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len).decode('utf-8') if content_len > 0 else '{}'
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        # Route: POST /api/warehouse/transfers (create transfer)
        if url_path == '/api/warehouse/transfers':
            transfers = load_transfers()
            # Check duplicate
            pallet_code = payload.get('palletCode')
            existing_idx = next((i for i, t in enumerate(transfers) if t.get('palletCode') == pallet_code), None)
            if existing_idx is not None:
                transfers[existing_idx] = payload
            else:
                transfers.insert(0, payload)
            save_transfers(transfers)
            self.send_json_response({'success': True, 'palletCode': pallet_code, 'message': 'Movimento registrato con successo'})
            return

        # Route: POST /api/warehouse/transfers/update-status (departure / arrival check-in)
        if url_path == '/api/warehouse/transfers/update-status':
            transfers = load_transfers()
            pallet_code = (payload.get('palletCode') or '').strip().upper()
            new_status = payload.get('status')
            matched = next((t for t in transfers if (t.get('palletCode') or '').strip().upper() == pallet_code), None)
            if not matched:
                self.send_json_response({'error': f'Bancale {pallet_code} non trovato'}, status=404)
                return

            matched['status'] = new_status
            if new_status == 'in_transito' and not matched.get('departureDate'):
                matched['departureDate'] = payload.get('timestamp') or '2026-10-24T08:00:00Z'
                if payload.get('operator'):
                    matched['operatorDeparture'] = payload['operator']
            elif new_status == 'ricevuto':
                matched['arrivalDate'] = payload.get('timestamp') or '2026-10-24T08:30:00Z'
                if payload.get('operator'):
                    matched['operatorArrival'] = payload['operator']

            save_transfers(transfers)
            self.send_json_response({'success': True, 'transfer': matched, 'message': f'Stato bancale aggiornato a {new_status}'})
            return

        # Route: POST /api/warehouse/transfers/partial-pickup
        if url_path == '/api/warehouse/transfers/partial-pickup':
            transfers = load_transfers()
            pallet_code = (payload.get('palletCode') or '').strip().upper()
            item_code = (payload.get('itemCode') or '').strip().upper()
            boxes_picked = int(payload.get('boxesPicked') or 0)
            pcs_picked = int(payload.get('piecesPicked') or 0)

            matched = next((t for t in transfers if (t.get('palletCode') or '').strip().upper() == pallet_code), None)
            if not matched:
                self.send_json_response({'error': f'Bancale {pallet_code} non trovato'}, status=404)
                return

            target_item = next((i for i in (matched.get('items') or []) if (i.get('code') or '').strip().upper() == item_code), None)
            if not target_item:
                self.send_json_response({'error': f'Articolo {item_code} non presente sul bancale'}, status=404)
                return

            current_picked = int(target_item.get('pickedPieces') or 0)
            new_picked = current_picked + pcs_picked
            target_item['pickedPieces'] = new_picked
            target_item['remainingPieces'] = max(0, int(target_item.get('totalPieces') or 0) - new_picked)

            if 'pickupHistory' not in matched:
                matched['pickupHistory'] = []
            matched['pickupHistory'].append({
                'itemCode': item_code,
                'boxesPicked': boxes_picked,
                'piecesPicked': pcs_picked,
                'pickedAt': payload.get('timestamp') or '2026-10-24T08:30:00Z',
                'operator': payload.get('operator') or 'Operatore Magazzino',
                'reason': payload.get('reason') or ''
            })

            save_transfers(transfers)
            self.send_json_response({'success': True, 'transfer': matched, 'remainingPieces': target_item['remainingPieces']})
            return

        # Proxy other POST requests to live remote if available
        self.proxy_remote_post(payload)

    def proxy_remote_get(self):
        remote_url = REMOTE_API_BASE + self.path
        try:
            req = urllib.request.Request(remote_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                content = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        except Exception as e:
            # Return empty data fallback
            self.send_json_response({'data': [], 'note': f'Proxy fallback: {e}'})

    def proxy_remote_post(self, payload):
        remote_url = REMOTE_API_BASE + self.path
        try:
            data_bytes = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(remote_url, data=data_bytes, headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                content = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', resp.headers.get('Content-Type', 'application/json'))
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
        except Exception as e:
            self.send_json_response({'success': True, 'mock': True, 'note': f'Local fallback: {e}'})

    def send_json_response(self, data, status=200):
        resp = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

if __name__ == '__main__':
    local_ip = get_local_ip()
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, LocalDevHandler)

    print("=" * 64)
    print("🚀 ORDER SENDER — SERVER LOCALE ATTIVO")
    print("=" * 64)
    print(f"💻 Da questo computer (PC):")
    print(f"   👉 http://localhost:{PORT}/gestione-ordini.html")
    print(f"   👉 http://localhost:{PORT}/ (Dashboard)")
    print("")
    print(f"📱 Dal tuo SMARTPHONE (connesso allo stesso Wi-Fi):")
    print(f"   👉 http://{local_ip}:{PORT}/gestione-ordini.html")
    print("=" * 64)
    print("Premi Ctrl+C per arrestare il server.")
    print("=" * 64)
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer arrestato.")
