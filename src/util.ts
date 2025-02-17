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

export async function sendTx(
  connection: Connection,
  tx: Transaction,
  payer: PublicKey,
  signers: Keypair[],
  priorityFees?: PriorityFee,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY,
  jito: boolean = true,
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
    let sig: string;
    if (jito) {
      const serializedTx = Buffer.from(versionedTx.serialize()).toString(
        "base64"
      );
      const endpoint = jitoEndpoint || getRandomJitoMainnetEndpoint();
      const response = await sendBundle([serializedTx], endpoint);

      if (response.error) {
        throw new Error(`Jito bundle error: ${JSON.stringify(response.error)}`);
      }
      sig = response.result;
    } else {
      sig = await connection.sendTransaction(versionedTx, {
        skipPreflight: false,
      });
    }

    console.log("sig:", `https://solscan.io/tx/${sig}`);

    let txResult = await getTxDetails(connection, sig, commitment, finality);
    if (!txResult) {
      return {
        success: false,
        error: "Transaction failed",
      };
    }
    return {
      success: true,
      signature: sig,
      results: txResult,
    };
  } catch (e) {
    if (e instanceof SendTransactionError) {
      let ste = e as SendTransactionError;
      console.log("SendTransactionError" + (await ste.getLogs(connection)));
    } else {
      console.error(e);
    }
    return {
      error: e,
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
