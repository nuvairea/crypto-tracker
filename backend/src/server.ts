import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import type { CoinGeckoMarketData, ServerMessage, UpdateMessage, ConnectingMessage } from './types.js';

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const COIN_IDS = ['bitcoin', 'ethereum', 'solana'];

const COINGECKO_URL =
  `https://api.coingecko.com/api/v3/coins/markets` +
  `?vs_currency=usd&ids=${COIN_IDS.join(',')}` +
  `&sparkline=true&price_change_percentage=24h`;

let latestCoins: CoinGeckoMarketData[] | null = null;
let lastSuccessAt: number | null = null;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function fetchMarketData() {
  if (inFlight) return;
  inFlight = true;

  try {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);

    const data: unknown = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Unexpected response shape from CoinGecko');
    }

    const coins = data as CoinGeckoMarketData[];
    latestCoins = coins;
    lastSuccessAt = Date.now();

    broadcast({ type: 'update', coins: latestCoins, stale: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown CoinGecko error';

    console.error('[coingecko] Failed to fetch market data:', message);

    if (latestCoins) {
      broadcast({ type: 'update', coins: latestCoins, stale: true });
    } else {
      broadcast({ type: 'error', message: 'Failed to fetch market data from CoinGecko' });
    }
  } finally {
    inFlight = false;
  }
}

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  res.end('WebSocket server running');
});

const wss = new WebSocketServer({ server });

function broadcast(payload: ServerMessage) {
  const message = JSON.stringify(payload);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function startPolling() {
  if (pollTimer) return;

  const fresh = lastSuccessAt !== null && Date.now() - lastSuccessAt < POLL_INTERVAL_MS;
  if (!fresh) void fetchMarketData();

  pollTimer = setInterval(fetchMarketData, POLL_INTERVAL_MS);
  console.log('[poll] started');
}

function stopPolling() {
  if (!pollTimer) return;

  clearInterval(pollTimer);
  pollTimer = null;
  console.log('[poll] stopped (no clients)');
}

wss.on('connection', (ws: WebSocket) => {
  ws.on('error', (err) => {
    console.error('[ws] client error:', err.message);
  });

  ws.on('close', () => {
    if (wss.clients.size === 0) stopPolling();
  });

  if (latestCoins) {
    const stale = lastSuccessAt === null ? true : Date.now() - lastSuccessAt > POLL_INTERVAL_MS * 2;
    ws.send(
      JSON.stringify({
        type: 'update',
        coins: latestCoins,
        stale,
      } satisfies UpdateMessage)
    );
  } else {
    ws.send(JSON.stringify({ type: 'connecting' } satisfies ConnectingMessage));
  }

  startPolling();
});

server.listen(PORT, () => {
  console.log(`WebSocket server running at http://localhost:${PORT}`);
});