const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = 30_000;
const COIN_IDS = ['bitcoin', 'ethereum', 'solana'];

const COINGECKO_URL =
  `https://api.coingecko.com/api/v3/coins/markets` +
  `?vs_currency=usd&ids=${COIN_IDS.join(',')}` +
  `&sparkline=true&price_change_percentage=24h`;

let latestCoins = null;
let lastSuccessAt = null;

async function fetchMarketData() {
  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Unexpected response shape from CoinGecko');
    }

    latestCoins = data;
    lastSuccessAt = Date.now();
    broadcast({ type: 'update', coins: latestCoins, stale: false });
  } catch (err) {
    console.error('[coingecko] fetch failed:', err.message);

    if (latestCoins) {
      broadcast({ type: 'update', coins: latestCoins, stale: true });
    } else {
      broadcast({ type: 'error', message: 'Unable to reach price data' });
    }
  }
}

const server = http.createServer((req, res) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  res.end('WebSocket server running');
});

const wss = new WebSocket.Server({ server });

function broadcast(payload) {
  const message = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

wss.on('connection', (ws) => {
  if (latestCoins) {
    const isStale = Date.now() - lastSuccessAt > POLL_INTERVAL_MS * 2;
    ws.send(JSON.stringify({ type: 'update', coins: latestCoins, stale: isStale }));
  } else {
    ws.send(JSON.stringify({ type: 'connecting' }));
  }
});

fetchMarketData();
setInterval(fetchMarketData, POLL_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`WebSocket server running at http://localhost:${PORT}`);
});