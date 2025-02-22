import {
  Commitment,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import { Program, Provider } from "@coral-xyz/anchor";
import { GlobalAccount } from "./globalAccount";
import {
  BundledBuy,
  CompleteEvent,
  CreateEvent,
  CreateTokenMetadata,
  PriorityFee,
  PumpFunEventHandlers,
  PumpFunEventType,
  SetParamsEvent,
  TradeEvent,
  TransactionResult,
} from "./types";
import {
  toCompleteEvent,
  toCreateEvent,
  toSetParamsEvent,
  toTradeEvent,
} from "./events";
import {
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { BondingCurveAccount } from "./bondingCurveAccount";
import { BN } from "bn.js";
import {
  DEFAULT_COMMITMENT,
  DEFAULT_FINALITY,
  buildVersionedTx,
  calculateWithSlippageBuy,
  calculateWithSlippageSell,
  sendTx,
} from "./util";
import { PumpFun, IDL } from "./IDL";
import {
  getRandomJitoMainnetEndpoint,
  getRandomTipAccount,
  JitoConfig,
  sendBundle,
  TIP_LAMPORTS,
} from "./jito";
const PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const MPL_TOKEN_METADATA_PROGRAM_ID =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const GLOBAL_ACCOUNT_SEED = "global";
export const MINT_AUTHORITY_SEED = "mint-authority";
export const BONDING_CURVE_SEED = "bonding-curve";
export const METADATA_SEED = "metadata";

export const DEFAULT_DECIMALS = 6;

export const MAX_BUNDLED_BUYS_PER_TX = 4; // Adjust this number based on testing

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

export class PumpFunSDK {
  public program: Program<PumpFun>;
  public connection: Connection;
  constructor(provider?: Provider) {
    this.program = new Program<PumpFun>(IDL as PumpFun, provider);
    this.connection = this.program.provider.connection;
  }

  async createAndBuy({
    creator,
    mint,
    createTokenMetadata,
    buyAmountSol,
    slippageBasisPoints = 500n,
    priorityFees,
    commitment = DEFAULT_COMMITMENT,
    finality = DEFAULT_FINALITY,
    jitoConfig,
    bundledBuys,
  }: CreateAndBuyParams): Promise<TransactionResult> {
    let tokenMetadata = await this.createTokenMetadata(createTokenMetadata);

    // Create all transactions but don't send them yet
    const allTransactions: Transaction[] = [];
    const allSigners: Keypair[][] = [];

    // First transaction: Create token and initial buy
    let createTx = await this.getCreateInstructions(
      creator.publicKey,
      createTokenMetadata.name,
      createTokenMetadata.symbol,
      tokenMetadata.metadataUri,
      mint
    );

    let firstTx = new Transaction();

    // Add Jito tip instruction if enabled
    if (jitoConfig?.jitoEnabled) {
      const tipAccount = new PublicKey(getRandomTipAccount());
      firstTx.add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: tipAccount,
          lamports: jitoConfig.tipLampports || TIP_LAMPORTS,
        })
      );
    }

    firstTx.add(createTx);

    if (buyAmountSol > 0) {
      const globalAccount = await this.getGlobalAccount(commitment);
      const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
      const buyAmountWithSlippage = calculateWithSlippageBuy(
        buyAmountSol,
        slippageBasisPoints
      );

      const buyTx = await this.getBuyInstructions(
        creator.publicKey,
        mint.publicKey,
        globalAccount.feeRecipient,
        buyAmount,
        buyAmountWithSlippage
      );

      firstTx.add(buyTx);
    }

    allTransactions.push(firstTx);
    allSigners.push([creator, mint]);

    // Process bundled buys in batches
    if (bundledBuys && bundledBuys.length > 0) {
      const batches: BundledBuy[][] = [];
      for (let i = 0; i < bundledBuys.length; i += MAX_BUNDLED_BUYS_PER_TX) {
        batches.push(bundledBuys.slice(i, i + MAX_BUNDLED_BUYS_PER_TX));
      }

      for (const batch of batches) {
        const batchTx = new Transaction();
        const globalAccount = await this.getGlobalAccount(commitment);

        // Add Jito tip instruction for each batch transaction if enabled
        if (jitoConfig?.jitoEnabled) {
          const tipAccount = new PublicKey(getRandomTipAccount());
          batchTx.add(
            SystemProgram.transfer({
              fromPubkey: batch[0].signer.publicKey,
              toPubkey: tipAccount,
              lamports: jitoConfig.tipLampports || TIP_LAMPORTS,
            })
          );
        }

        for (const buy of batch) {
          const buyAmount = globalAccount.getInitialBuyPrice(buy.amountInSol);
          const buyAmountWithSlippage = calculateWithSlippageBuy(
            buy.amountInSol,
            slippageBasisPoints
          );

          batchTx.add(
            await this.getBuyInstructions(
              buy.signer.publicKey,
              mint.publicKey,
              globalAccount.feeRecipient,
              buyAmount,
              buyAmountWithSlippage
            )
          );
        }

        allTransactions.push(batchTx);
        allSigners.push(batch.map((buy) => buy.signer));
      }
    }

    // If using Jito, send all transactions as a bundle
    if (jitoConfig?.jitoEnabled) {
      const serializedTxs: string[] = [];

      for (let i = 0; i < allTransactions.length; i++) {
        const tx = allTransactions[i];
        const signers = allSigners[i];
        const payer = signers[0];

        const versionedTx = await buildVersionedTx(
          this.connection,
          payer.publicKey,
          tx,
          commitment
        );
        versionedTx.sign(signers);

        serializedTxs.push(
          Buffer.from(versionedTx.serialize()).toString("base64")
        );
      }

      const endpoint = jitoConfig.endpoint || getRandomJitoMainnetEndpoint();
      const response = await sendBundle(serializedTxs, endpoint);

      if (response.error) {
        return {
          success: false,
          error: new Error(
            `Jito bundle error: ${JSON.stringify(response.error)}`
          ),
        };
      }

      return {
        success: true,
        signature: response.result,
      };
    }
    // If not using Jito, send transactions sequentially
    else {
      let result0: TransactionResult | undefined;
      for (let i = 0; i < allTransactions.length; i++) {
        const tx = allTransactions[i];
        const signers = allSigners[i];
        const payer = signers[0];

        const result = await sendTx(
          this.connection,
          tx,
          payer.publicKey,
          signers,
          priorityFees,
          commitment,
          finality
        );

        if (!result.success) {
          return result;
        }
        if (i === 0) {
          result0 = result;
        }
      }

      return result0!;
    }
  }

  async buy({
    buyer,
    mint,
    buyAmountSol,
    slippageBasisPoints = 500n,
    priorityFees,
    commitment = DEFAULT_COMMITMENT,
    finality = DEFAULT_FINALITY,
    jitoConfig,
  }: BuyParams): Promise<TransactionResult> {
    let buyTx = await this.getBuyInstructionsBySolAmount(
      buyer.publicKey,
      mint,
      buyAmountSol,
      slippageBasisPoints,
      commitment
    );

    let buyResults = await sendTx(
      this.connection,
      buyTx,
      buyer.publicKey,
      [buyer],
      priorityFees,
      commitment,
      finality,
      jitoConfig?.jitoEnabled,
      jitoConfig?.tipLampports,
      jitoConfig?.endpoint
    );
    return buyResults;
  }

  async sell({
    seller,
    mint,
    sellTokenAmount,
    slippageBasisPoints = 500n,
    priorityFees,
    commitment = DEFAULT_COMMITMENT,
    finality = DEFAULT_FINALITY,
    jitoConfig,
  }: SellParams): Promise<TransactionResult> {
    let sellTx = await this.getSellInstructionsByTokenAmount(
      seller.publicKey,
      mint,
      sellTokenAmount,
      slippageBasisPoints,
      commitment
    );

    let sellResults = await sendTx(
      this.connection,
      sellTx,
      seller.publicKey,
      [seller],
      priorityFees,
      commitment,
      finality,
      jitoConfig?.jitoEnabled,
      jitoConfig?.tipLampports,
      jitoConfig?.endpoint
    );
    return sellResults;
  }

  //create token instructions
  async getCreateInstructions(
    creator: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    mint: Keypair
  ) {
    const mplTokenMetadata = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(METADATA_SEED),
        mplTokenMetadata.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      mplTokenMetadata
    );

    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint.publicKey,
      this.getBondingCurvePDA(mint.publicKey),
      true
    );

    return this.program.methods
      .create(name, symbol, uri)
      .accounts({
        mint: mint.publicKey,
        associatedBondingCurve: associatedBondingCurve,
        metadata: metadataPDA,
        user: creator,
      })
      .signers([mint])
      .transaction();
  }

  async getBuyInstructionsBySolAmount(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    let bondingCurveAccount = await this.getBondingCurveAccount(
      mint,
      commitment
    );
    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
    let buyAmountWithSlippage = calculateWithSlippageBuy(
      buyAmountSol,
      slippageBasisPoints
    );

    let globalAccount = await this.getGlobalAccount(commitment);

    return await this.getBuyInstructions(
      buyer,
      mint,
      globalAccount.feeRecipient,
      buyAmount,
      buyAmountWithSlippage
    );
  }

  //buy
  async getBuyInstructions(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint,
      this.getBondingCurvePDA(mint),
      true
    );

    const associatedUser = await getAssociatedTokenAddress(mint, buyer, false);

    let transaction = new Transaction();

    try {
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          buyer,
          associatedUser,
          buyer,
          mint
        )
      );
    }

    transaction.add(
      await this.program.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: buyer,
        })
        .transaction()
    );

    return transaction;
  }

  //sell
  async getSellInstructionsByTokenAmount(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    let bondingCurveAccount = await this.getBondingCurveAccount(
      mint,
      commitment
    );
    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    let globalAccount = await this.getGlobalAccount(commitment);

    let minSolOutput = bondingCurveAccount.getSellPrice(
      sellTokenAmount,
      globalAccount.feeBasisPoints
    );

    let sellAmountWithSlippage = calculateWithSlippageSell(
      minSolOutput,
      slippageBasisPoints
    );

    return await this.getSellInstructions(
      seller,
      mint,
      globalAccount.feeRecipient,
      sellTokenAmount,
      sellAmountWithSlippage
    );
  }

  async getSellInstructions(
    seller: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    minSolOutput: bigint
  ) {
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mint,
      this.getBondingCurvePDA(mint),
      true
    );

    const associatedUser = await getAssociatedTokenAddress(mint, seller, false);

    let transaction = new Transaction();

    transaction.add(
      await this.program.methods
        .sell(new BN(amount.toString()), new BN(minSolOutput.toString()))
        .accounts({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedBondingCurve: associatedBondingCurve,
          associatedUser: associatedUser,
          user: seller,
        })
        .transaction()
    );

    return transaction;
  }

  async getBondingCurveAccount(
    mint: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    const tokenAccount = await this.connection.getAccountInfo(
      this.getBondingCurvePDA(mint),
      commitment
    );
    if (!tokenAccount) {
      return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount!.data);
  }

  async getGlobalAccount(commitment: Commitment = DEFAULT_COMMITMENT) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_ACCOUNT_SEED)],
      new PublicKey(PROGRAM_ID)
    );

    const tokenAccount = await this.connection.getAccountInfo(
      globalAccountPDA,
      commitment
    );

    return GlobalAccount.fromBuffer(tokenAccount!.data);
  }

  getBondingCurvePDA(mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
      this.program.programId
    )[0];
  }

  async createTokenMetadata(create: CreateTokenMetadata) {
    // Validate file
    if (!(create.file instanceof Blob)) {
      throw new Error("File must be a Blob or File object");
    }

    let formData = new FormData();
    formData.append("file", create.file, "image.png"); // Add filename
    formData.append("name", create.name);
    formData.append("symbol", create.symbol);
    formData.append("description", create.description);
    formData.append("twitter", create.twitter || "");
    formData.append("telegram", create.telegram || "");
    formData.append("website", create.website || "");
    formData.append("showName", "true");

    try {
      const request = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
        credentials: "same-origin",
      });

      if (request.status === 500) {
        // Try to get more error details
        const errorText = await request.text();
        throw new Error(
          `Server error (500): ${errorText || "No error details available"}`
        );
      }

      if (!request.ok) {
        throw new Error(`HTTP error! status: ${request.status}`);
      }

      const responseText = await request.text();
      if (!responseText) {
        throw new Error("Empty response received from server");
      }

      try {
        return JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
    } catch (error) {
      console.error("Error in createTokenMetadata:", error);
      throw error;
    }
  }
  //EVENTS
  addEventListener<T extends PumpFunEventType>(
    eventType: T,
    callback: (
      event: PumpFunEventHandlers[T],
      slot: number,
      signature: string
    ) => void
  ) {
    return this.program.addEventListener(
      eventType,
      (event: any, slot: number, signature: string) => {
        let processedEvent;
        switch (eventType) {
          case "createEvent":
            processedEvent = toCreateEvent(event as CreateEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "tradeEvent":
            processedEvent = toTradeEvent(event as TradeEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "completeEvent":
            processedEvent = toCompleteEvent(event as CompleteEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            console.log("completeEvent", event, slot, signature);
            break;
          case "setParamsEvent":
            processedEvent = toSetParamsEvent(event as SetParamsEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          default:
            console.error("Unhandled event type:", eventType);
        }
      }
    );
  }

  removeEventListener(eventId: number) {
    this.program.removeEventListener(eventId);
  }
}
