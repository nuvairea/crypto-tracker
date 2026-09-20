export type CoinGeckoMarketData = {
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

export type ConnectingMessage = { type: 'connecting' };
export type UpdateMessage = {
  type: 'update';
  coins: CoinGeckoMarketData[];
  stale: boolean;
};
export type ErrorMessage = {
  type: 'error';
  message: string;
};

export type ServerMessage = ConnectingMessage | UpdateMessage | ErrorMessage;