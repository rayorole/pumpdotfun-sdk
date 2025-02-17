export type JitoConfig = {
  jitoEnabled: boolean;
  endpoint?: JitoEndpoint;
  tipLampports?: number;
};

const JITO_MAINNET_ENDPOINTS = [
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://tokyo.mainnet.block-engine.jito.wtf",
  "https://slc.mainnet.block-engine.jito.wtf",
] as const;

export type JitoEndpoint = (typeof JITO_MAINNET_ENDPOINTS)[number];

const TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export const TIP_LAMPORTS = 100000; // 0.0001 SOL

export const BATCH_SIZE = 5; // Maximum transactions per bundle

export const getRandomJitoMainnetEndpoint = (): JitoEndpoint => {
  return JITO_MAINNET_ENDPOINTS[
    Math.floor(Math.random() * JITO_MAINNET_ENDPOINTS.length)
  ] as JitoEndpoint;
};

/**
 * Gets a random tip account from the fetched list
 */
export function getRandomTipAccount(): string {
  const randomIndex = Math.floor(Math.random() * TIP_ACCOUNTS.length);
  return TIP_ACCOUNTS[randomIndex];
}

/**
 * Sends a bundle of transactions to the Jito block engine API
 */
export async function sendBundle(
  transactions: string[],
  endpoint: JitoEndpoint
) {
  if (!endpoint) {
    endpoint = getRandomJitoMainnetEndpoint();
  }

  const response = await fetch(`${endpoint}/api/v1/bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [transactions, { encoding: "base64" }],
    }),
  });

  return response.json();
}
