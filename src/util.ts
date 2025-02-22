import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import { PriorityFee, TransactionResult } from "./types";
import {
  getRandomJitoMainnetEndpoint,
  getRandomTipAccount,
  JitoEndpoint,
  sendBundle,
  TIP_LAMPORTS,
} from "./jito";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { AnchorError, ProgramError } from "@coral-xyz/anchor";

export const DEFAULT_COMMITMENT: Commitment = "finalized";
export const DEFAULT_FINALITY: Finality = "finalized";

export const calculateWithSlippageBuy = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount + (amount * basisPoints) / 10000n;
};

export const calculateWithSlippageSell = (
  amount: bigint,
  basisPoints: bigint
) => {
  return amount - (amount * basisPoints) / 10000n;
};

export class TransactionError extends Error {
  public logs?: string[];
  public errorLogs?: string[];

  constructor(message: string, logs?: string[]) {
    super(message);
    this.name = "TransactionError";
    this.logs = logs;

    if (logs) {
      this.errorLogs = logs.filter(
        (log) =>
          log.includes("failed") ||
          log.includes("error") ||
          log.includes("Error") ||
          log.includes("exceeded")
      );
    }
  }

  toString(): string {
    let result = `${this.name}: ${this.message}`;
    if (this.errorLogs && this.errorLogs.length > 0) {
      result += `\nError details:\n${this.errorLogs.join("\n")}`;
    }
    return result;
  }
}

export async function sendTx(
  connection: Connection,
  tx: Transaction,
  payer: PublicKey,
  signers: Keypair[],
  priorityFees?: PriorityFee,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY,
  jito: boolean = false,
  tipLampports: number = TIP_LAMPORTS,
  jitoEndpoint?: JitoEndpoint
): Promise<TransactionResult> {
  let newTx = new Transaction();

  if (priorityFees) {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: priorityFees.unitLimit,
    });

    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFees.unitPrice,
    });
    newTx.add(modifyComputeUnits);
    newTx.add(addPriorityFee);
  }

  if (jito) {
    const TIP_ACCOUNT = getRandomTipAccount();
    const tipAccountPubkey = new PublicKey(TIP_ACCOUNT);
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: tipAccountPubkey,
      lamports: tipLampports,
    });
    newTx.add(tipInstruction);
  }

  newTx.add(tx);

  let versionedTx = await buildVersionedTx(
    connection,
    payer,
    newTx,
    commitment
  );
  versionedTx.sign(signers);

  try {
    if (jito) {
      const serializedTx = Buffer.from(versionedTx.serialize()).toString(
        "base64"
      );
      const endpoint = jitoEndpoint || getRandomJitoMainnetEndpoint();
      const response = await sendBundle([serializedTx], endpoint);

      if (response.error) {
        throw new Error(`Jito bundle error: ${JSON.stringify(response.error)}`);
      }
      const signature = response.result;

      return {
        success: true,
        signature: signature,
        results: undefined,
      };
    } else {
      const signature = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
        preflightCommitment: commitment,
      });

      let txResult = await getTxDetails(
        connection,
        signature,
        commitment,
        finality
      );
      if (!txResult) {
        return {
          success: false,
          error: "Transaction failed",
        };
      }
      return {
        success: true,
        signature: signature,
        results: txResult,
      };
    }
  } catch (e) {
    let errorMessage: string;
    let logs: string[] | undefined;

    if (e instanceof SendTransactionError) {
      logs = await e.getLogs(connection);

      if (logs?.some((log) => log.includes("exceeded CUs meter"))) {
        errorMessage =
          "Transaction failed: Compute budget exceeded. Try increasing compute unit limit.";
      } else if (e.message.includes("custom program error:")) {
        try {
          const anchorError = AnchorError.parse(logs || [e.message]);
          errorMessage = `Anchor Error: ${
            anchorError?.error?.errorMessage || "Unknown anchor error"
          }`;
        } catch {
          errorMessage = "Program Error: " + e.message;
        }
      } else {
        errorMessage = "Transaction Error: " + e.message;
      }
    } else if (e instanceof ProgramError) {
      errorMessage = `Program Error: ${e.msg || e.message}`;
      logs = e.logs;
    } else {
      errorMessage = `Unknown Error: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }

    const txError = new TransactionError(errorMessage, logs);
    console.error(txError.toString());

    return {
      error: txError,
      success: false,
    };
  }
}

export const buildVersionedTx = async (
  connection: Connection,
  payer: PublicKey,
  tx: Transaction,
  commitment: Commitment = DEFAULT_COMMITMENT
): Promise<VersionedTransaction> => {
  const blockHash = (await connection.getLatestBlockhash(commitment)).blockhash;

  let messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockHash,
    instructions: tx.instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
};

export const getTxDetails = async (
  connection: Connection,
  sig: string,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY
): Promise<VersionedTransactionResponse | null> => {
  try {
    bs58.decode(sig);
  } catch (e) {
    console.log("Not a base58 signature");
    return null;
  }

  const latestBlockHash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    {
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: sig,
    },
    commitment
  );

  return connection.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: finality,
  });
};
