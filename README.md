# PumpFunSDK README

## Important

Never click links in this repository leaving github, never click links in Issues, don't run code that others post without reading it, this software is provided "as is," without warranty.

## Overview

The `PumpDotFunSDK` is designed to interact with the Pump.fun decentralized application. It provides methods for creating, buying, and selling tokens using the Solana blockchain. The SDK handles the necessary transactions and interactions with the Pump.fun program.

## Installation

```bash
npm i pumpdotfun-jito-sdk
```

## Usage Example

First you need to create a `.env` file and set your RPC URL like in the `.env.example`

Then you need to fund an account with at least 0.004 SOL that is generated when running the command below

```bash
npx ts-node example/basic/index.ts
```

### Basic Example

````typescript
import dotenv from "dotenv";
import fs from "fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CreateTokenMetadata, DEFAULT_DECIMALS, PumpFunSDK } from "pumpdotfun-sdk";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";

dotenv.config();

const KEYS_FOLDER = __dirname + "/.keys";
const SLIPPAGE_BASIS_POINTS = 500n; // 5%

const main = async () => {
  if (!process.env.HELIUS_RPC_URL) {
    throw new Error("Please set HELIUS_RPC_URL in .env file");
  }

  const connection = new Connection(process.env.HELIUS_RPC_URL);
  const wallet = new NodeWallet(new Keypair());
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "finalized",
  });

  const testAccount = getOrCreateKeypair(KEYS_FOLDER, "test-account");
  const mint = getOrCreateKeypair(KEYS_FOLDER, "mint");
  const bundler = getOrCreateKeypair(KEYS_FOLDER, "bundler");

  const sdk = new PumpFunSDK(provider);

  // Create and buy token
  const tokenMetadata: CreateTokenMetadata = {
    name: "TST-7",
    symbol: "TST-7",
    description: "TST-7: This is a test token",
    file: await fs.openAsBlob("example/basic/random.png"),
  };

  const createResults = await sdk.createAndBuy({
    creator: testAccount,
    mint,
    createTokenMetadata: tokenMetadata,
    buyAmountSol: BigInt(0.0001 * LAMPORTS_PER_SOL),
    slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
    priorityFees: {
      unitLimit: 300000,
      unitPrice: 200000,
    },
    jitoConfig: {
      jitoEnabled: false,
      tipLampports: 0.001 * LAMPORTS_PER_SOL,
    },
    bundledBuys: [
      {
        amountInSol: BigInt(0.01 * LAMPORTS_PER_SOL),
        signer: bundler,
      },
    ],
  });

  // Buy more tokens
  const buyResults = await sdk.buy({
    buyer: testAccount,
    mint: mint.publicKey,
    buyAmountSol: BigInt(0.0001 * LAMPORTS_PER_SOL),
    slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
    priorityFees: {
      unitLimit: 250000,
      unitPrice: 250000,
    },
    jitoConfig: {
      jitoEnabled: false,
      tipLampports: 0.001 * LAMPORTS_PER_SOL,
    },
  });

  // Sell tokens
  const sellResults = await sdk.sell({
    seller: testAccount,
    mint: mint.publicKey,
    sellTokenAmount: BigInt(currentSPLBalance * Math.pow(10, DEFAULT_DECIMALS)),
    slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
    priorityFees: {
      unitLimit: 250000,
      unitPrice: 250000,
    },
    jitoConfig: {
      jitoEnabled: false,
      tipLampports: 0.001 * LAMPORTS_PER_SOL,
    },
  });
};

### PumpDotFunSDK Class

The `PumpDotFunSDK` class provides methods to interact with the PumpFun protocol. Below are the method signatures and their descriptions.

#### Types

```typescript
interface JitoConfig {
  jitoEnabled: boolean;
  tipLampports?: number;
  endpoint?: string;
}

interface PriorityFee {
  unitPrice: number;
  unitLimit: number;
}

interface CreateTokenMetadata {
  name: string;
  symbol: string;
  description: string;
  file: Blob;
  twitter?: string;
  telegram?: string;
  website?: string;
}

interface BundledBuy {
  amountInSol: bigint;
  signer: Keypair;
}
````

#### createAndBuy

```typescript
interface CreateAndBuyParams {
  creator: Keypair;
  mint: Keypair;
  createTokenMetadata: CreateTokenMetadata;
  buyAmountSol: bigint;
  slippageBasisPoints?: bigint;
  priorityFees?: PriorityFee;
  commitment?: Commitment;
  finality?: Finality;
  jitoConfig?: JitoConfig;
  bundledBuys?: BundledBuy[];
}

async createAndBuy(params: CreateAndBuyParams): Promise<TransactionResult>
```

Creates a new token and optionally buys it. Can include bundled buys from other accounts.

#### buy

```typescript
interface BuyParams {
  buyer: Keypair;
  mint: PublicKey;
  buyAmountSol: bigint;
  slippageBasisPoints?: bigint;
  priorityFees?: PriorityFee;
  commitment?: Commitment;
  finality?: Finality;
  jitoConfig?: JitoConfig;
}

async buy(params: BuyParams): Promise<TransactionResult>
```

Buys a specified amount of tokens.

#### sell

```typescript
interface SellParams {
  seller: Keypair;
  mint: PublicKey;
  sellTokenAmount: bigint;
  slippageBasisPoints?: bigint;
  priorityFees?: PriorityFee;
  commitment?: Commitment;
  finality?: Finality;
  jitoConfig?: JitoConfig;
}

async sell(params: SellParams): Promise<TransactionResult>
```

Sells a specified amount of tokens.

### Jito MEV Configuration

The SDK supports Jito MEV protection through the `jitoConfig` parameter:

```typescript
const jitoConfig = {
  jitoEnabled: true, // Enable Jito MEV protection
  tipLampports: 0.001 * LAMPORTS_PER_SOL, // Optional tip amount
  endpoint: "https://jito-api.example.com", // Optional custom endpoint
};
```

Add this configuration to any transaction to enable MEV protection.

## Contributing

We welcome contributions! Please submit a pull request or open an issue to discuss any changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Here is a sample "Use at Your Own Risk" disclaimer for a GitHub repository:

---

## Disclaimer

This software is provided "as is," without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability, whether in an action of contract, tort, or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.

**Use at your own risk.** The authors take no responsibility for any harm or damage caused by the use of this software. Users are responsible for ensuring the suitability and safety of this software for their specific use cases.

By using this software, you acknowledge that you have read, understood, and agree to this disclaimer.

---

Feel free to customize it further to suit the specific context and requirements of your project.

---

By following this README, you should be able to install the PumpDotFun SDK, run the provided examples, and understand how to set up event listeners and perform token operations.
