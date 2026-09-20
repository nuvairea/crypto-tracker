import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = 30_000;
const COIN_IDS = ['bitcoin', 'ethereum', 'solana'];

type CoinGeckoMarketData = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number | null;
  sparkline_in_7d?: {
    price: number[];
  };
};

type ConnectingMessage = { type: 'connecting' };
type UpdateMessage = {
  type: 'update';
  coins: CoinGeckoMarketData[];
  stale: boolean;
};
type ErrorMessage = {
  type: 'error';
  message: string;
};

type ServerMessage = ConnectingMessage | UpdateMessage | ErrorMessage;

const COINGECKO_URL =
  `https://api.coingecko.com/api/v3/coins/markets` +
  `?vs_currency=usd&ids=${COIN_IDS.join(',')}` +
  `&sparkline=true&price_change_percentage=24h`;

let latestCoins: CoinGeckoMarketData[] | null = null;
let lastSuccessAt: number | null = null;

async function fetchMarketData() {
  try {
    const res = await fetch(COINGECKO_URL);
    if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);

    const data: unknown = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Unexpected response shape from CoinGecko');
    }

    const coins = data as CoinGeckoMarketData[];
    latestCoins = coins;
    lastSuccessAt = Date.now();

    broadcast({ type: 'update', coins: latestCoins, stale: false });
  } catch (error : unknown) {
    const message = error instanceof Error ? error.message : 'Unknown CoinGecko error';

    console.error('[coingecko] Failed to fetch market data:', message);

    if (latestCoins) {
      broadcast({ type: 'update', coins: latestCoins, stale: true });
    } else {
      broadcast({ type: 'error', message: 'Failed to fetch market data from CoinGecko' });
    }
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

wss.on('connection', (ws: WebSocket) => {
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
});

fetchMarketData();
setInterval(fetchMarketData, POLL_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`WebSocket server running at http://localhost:${PORT}`);
});