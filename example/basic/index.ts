import dotenv from "dotenv";
import fs from "fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CreateTokenMetadata, DEFAULT_DECIMALS, PumpFunSDK } from "../../src";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  getOrCreateKeypair,
  getSPLBalance,
  printSOLBalance,
  printSPLBalance,
} from "../util";
import { TransactionError } from "../../src/util";

const KEYS_FOLDER = __dirname + "/.keys";
const SLIPPAGE_BASIS_POINTS = 500n; // This is 5%

//create token example:
//https://solscan.io/tx/bok9NgPeoJPtYQHoDqJZyRDmY88tHbPcAk1CJJsKV3XEhHpaTZhUCG3mA9EQNXcaUfNSgfPkuVbEsKMp6H7D9NY
//devnet faucet
//https://faucet.solana.com/

const main = async () => {
  dotenv.config();

  if (!process.env.HELIUS_RPC_URL) {
    console.error("Please set HELIUS_RPC_URL in .env file");
    console.error(
      "Example: HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your api key>"
    );
    console.error("Get one at: https://www.helius.dev");
    return;
  }

  let connection = new Connection(process.env.HELIUS_RPC_URL || "");

  let wallet = new NodeWallet(new Keypair()); //note this is not used
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "finalized",
  });

  const testAccount = getOrCreateKeypair(KEYS_FOLDER, "test-account");
  const mint = getOrCreateKeypair(KEYS_FOLDER, "mint");
  const bundler = getOrCreateKeypair(KEYS_FOLDER, "bundler");

  await printSOLBalance(
    connection,
    testAccount.publicKey,
    "Test Account keypair"
  );

  let sdk = new PumpFunSDK(provider);

  let globalAccount = await sdk.getGlobalAccount();
  console.log(globalAccount);

  let currentSolBalance = await connection.getBalance(testAccount.publicKey);
  if (currentSolBalance == 0) {
    console.log(
      "Please send some SOL to the test-account:",
      testAccount.publicKey.toBase58()
    );
    return;
  }

  console.log(await sdk.getGlobalAccount());

  // Check if mint already exists
  let boundingCurveAccount = await sdk.getBondingCurveAccount(mint.publicKey);
  if (!boundingCurveAccount) {
    let tokenMetadata: CreateTokenMetadata = {
      name: "TST-7",
      symbol: "TST-7",
      description: "TST-7: This is a test token",
      file: await fs.openAsBlob("example/basic/random.png"),
    };

    let createResults = await sdk.createAndBuy({
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

    if (!createResults.success) {
      if (createResults.error instanceof TransactionError) {
        console.error("Transaction failed:");
        console.error(createResults.error.toString());
        if (createResults.error.errorLogs) {
          console.error("Detailed error logs:", createResults.error.errorLogs);
        }
      } else {
        console.error("Unknown error:", createResults.error);
      }
      return;
    }

    console.log("Success:", `https://pump.fun/${mint.publicKey.toBase58()}`);
    boundingCurveAccount = await sdk.getBondingCurveAccount(
      mint.publicKey,
      "processed"
    );
    console.log("Bonding curve after create and buy", boundingCurveAccount);
    printSPLBalance(connection, mint.publicKey, testAccount.publicKey);
  } else {
    console.log("boundingCurveAccount", boundingCurveAccount);
    console.log("Success:", `https://pump.fun/${mint.publicKey.toBase58()}`);
    printSPLBalance(connection, mint.publicKey, testAccount.publicKey);
  }

  if (boundingCurveAccount) {
    //buy 0.0001 SOL worth of tokens
    let buyResults = await sdk.buy({
      buyer: testAccount,
      mint: mint.publicKey,
      buyAmountSol: BigInt(0.0001 * LAMPORTS_PER_SOL),
      slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
      priorityFees: {
        unitLimit: 250000,
        unitPrice: 250000,
      },
    });

    if (buyResults.success) {
      printSPLBalance(connection, mint.publicKey, testAccount.publicKey);
      console.log(
        "Bonding curve after buy",
        await sdk.getBondingCurveAccount(mint.publicKey)
      );
    } else {
      console.log("Buy failed");
    }

    //sell all tokens
    let currentSPLBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      testAccount.publicKey
    );
    console.log("currentSPLBalance", currentSPLBalance);
    if (currentSPLBalance) {
      let sellResults = await sdk.sell({
        seller: testAccount,
        mint: mint.publicKey,
        sellTokenAmount: BigInt(
          currentSPLBalance * Math.pow(10, DEFAULT_DECIMALS)
        ),
        slippageBasisPoints: SLIPPAGE_BASIS_POINTS,
        priorityFees: {
          unitLimit: 250000,
          unitPrice: 250000,
        },
      });
      if (sellResults.success) {
        await printSOLBalance(
          connection,
          testAccount.publicKey,
          "Test Account keypair"
        );

        printSPLBalance(
          connection,
          mint.publicKey,
          testAccount.publicKey,
          "After SPL sell all"
        );
        console.log(
          "Bonding curve after sell",
          await sdk.getBondingCurveAccount(mint.publicKey)
        );
      } else {
        console.log("Sell failed");
      }
    }
  }
};

main();
