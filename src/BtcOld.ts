import bs58 from "bs58";
import RIPEMD160 from "ripemd160";
import sha from "sha.js";
import type Transport from "@ledgerhq/hw-transport";
import type { CreateTransactionArg } from "./createTransaction";
import { createTransaction } from "./createTransaction";
import type { AddressFormat } from "./getWalletPublicKey";
import { getWalletPublicKey } from "./getWalletPublicKey";
import { pathArrayToString, pathStringToArray } from "./bip32";
import { signMessage } from "./signMessage";
import { AcreWithdrawalData } from "./types";
export type { AddressFormat };

/**
 * @class BtcOld
 * @description This Bitcoin old API is compatible with versions of the Bitcoin nano app that are earlier than 2.1.0
 *
 */

export default class BtcOld {
  constructor(private transport: Transport) {}

  private derivationsCache = {};
  private async derivatePath(path: string) {
    if (this.derivationsCache[path]) return this.derivationsCache[path];
    const res = await getWalletPublicKey(this.transport, {
      path,
    });
    this.derivationsCache[path] = res;
    return res;
  }

  async getWalletXpub({
    path,
    xpubVersion,
  }: {
    path: string;
    xpubVersion: number;
  }): Promise<string> {
    const pathElements = pathStringToArray(path);
    const parentPath = pathElements.slice(0, -1);
    const parentDerivation = await this.derivatePath(pathArrayToString(parentPath));
    const accountDerivation = await this.derivatePath(path);
    const fingerprint = makeFingerprint(
      compressPublicKeySECP256(Buffer.from(parentDerivation.publicKey, "hex")),
    );
    const xpub = makeXpub(
      xpubVersion,
      pathElements.length,
      fingerprint,
      pathElements[pathElements.length - 1],
      Buffer.from(accountDerivation.chainCode, "hex"),
      compressPublicKeySECP256(Buffer.from(accountDerivation.publicKey, "hex")),
    );
    return xpub;
  }

  /**
   * @param path a BIP 32 path
   * @param options an object with optional these fields:
   *
   * - verify (boolean) will ask user to confirm the address on the device
   *
   * - format ("legacy" | "p2sh" | "bech32" | "bech32m" | "cashaddr") to use different bitcoin address formatter.
   *
   * NB The normal usage is to use:
   *
   * - legacy format with 44' paths
   *
   * - p2sh format with 49' paths
   *
   * - bech32 format with 84' paths
   *
   * - bech32m format with 86' paths
   *
   * - cashaddr in case of Bitcoin Cash
   *
   * @example
   * btc.getWalletPublicKey("44'/0'/0'/0/0").then(o => o.bitcoinAddress)
   * btc.getWalletPublicKey("49'/0'/0'/0/0", { format: "p2sh" }).then(o => o.bitcoinAddress)
   */
  getWalletPublicKey(
    path: string,
    opts?: {
      verify?: boolean;
      format?: AddressFormat;
    },
  ): Promise<{
    publicKey: string;
    bitcoinAddress: string;
    chainCode: string;
  }> {
    if (opts?.format === "bech32m") {
      throw new Error("Unsupported address format bech32m");
    }
    return getWalletPublicKey(this.transport, { ...opts, path });
  }

  /**
   * To sign a transaction involving standard (P2PKH) inputs, call createTransaction with the following parameters
   * @param inputs is an array of [ transaction, output_index, optional redeem script, optional sequence ] where
   *
   * * transaction is the previously computed transaction object for this UTXO
   * * output_index is the output in the transaction used as input for this UTXO (counting from 0)
   * * redeem script is the optional redeem script to use when consuming a Segregated Witness input
   * * sequence is the sequence number to use for this input (when using RBF), or non present
   * @param associatedKeysets is an array of BIP 32 paths pointing to the path to the private key used for each UTXO
   * @param changePath is an optional BIP 32 path pointing to the path to the public key used to compute the change address
   * @param outputScriptHex is the hexadecimal serialized outputs of the transaction to sign
   * @param lockTime is the optional lockTime of the transaction to sign, or default (0)
   * @param sigHashType is the hash type of the transaction to sign, or default (all)
   * @param segwit is an optional boolean indicating wether to use segwit or not
   * @param additionals list of additionnal options
   *
   * - "bech32" for spending native segwit outputs
   * - "abc" for bch
   * - "gold" for btg
   * - "decred" for decred
   * - "zcash" for zcash
   * - "bipxxx" for using BIPxxx
   * - "sapling" to indicate a zec transaction is supporting sapling (to be set over block 419200)
   * @param expiryHeight is an optional Buffer for zec overwinter / sapling Txs
   * @param useTrustedInputForSegwit trust inputs for segwit transactions
   * @return the signed transaction ready to be broadcast
   * @example
  btc.createTransaction({
   inputs: [ [tx1, 1] ],
   associatedKeysets: ["0'/0/0"],
   outputScriptHex: "01905f0100000000001976a91472a5d75c8d2d0565b656a5232703b167d50d5a2b88ac"
  }).then(res => ...);
   */
  createPaymentTransaction(arg: CreateTransactionArg): Promise<string> {
    if (arguments.length > 1) {
      throw new Error(
        "@blooo/hw-app-acre: createPaymentTransaction multi argument signature is deprecated. please switch to named parameters.",
      );
    }
    return createTransaction(this.transport, arg);
  }

  async signMessage({ path, messageHex }: { path: string; messageHex: string }): Promise<{
    v: number;
    r: string;
    s: string;
  }> {
    return signMessage(this.transport, {
      path,
      messageHex,
    });
  }

 /**
  * This function will never be called from a BtcOld context, it is only delcared here for compatibility with
  * the current framework, throwing an error in case it is ever reached.
  */
  async signWithdrawal({ path, withdrawalData }: { path: string; withdrawalData: AcreWithdrawalData }): Promise<{
    v: number;
    r: string;
    s: string;
  }> {
    throw new Error(
      "@blooo/hw-app-acre: Acre Withdrawal transaction is not compatible with the legacy BtcOld client. Please use the BtcNew client",
    );
  }
}

function makeFingerprint(compressedPubKey) {
  return hash160(compressedPubKey).slice(0, 4);
}

function asBufferUInt32BE(n: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(n, 0);
  return buf;
}

const compressPublicKeySECP256 = (publicKey: Buffer) =>
  Buffer.concat([Buffer.from([0x02 + (publicKey[64] & 0x01)]), publicKey.slice(1, 33)]);

function makeXpub(
  version: number,
  depth: number,
  parentFingerprint: Buffer,
  index: number,
  chainCode: Buffer,
  pubKey: Buffer,
) {
  const indexBuffer = asBufferUInt32BE(index);
  indexBuffer[0] |= 0x80;
  const extendedKeyBytes = Buffer.concat([
    asBufferUInt32BE(version),
    Buffer.from([depth]),
    parentFingerprint,
    indexBuffer,
    chainCode,
    pubKey,
  ]);
  const checksum = hash256(extendedKeyBytes).slice(0, 4);
  return bs58.encode(Buffer.concat([extendedKeyBytes, checksum]));
}

function sha256(buffer: Buffer | string) {
  return sha("sha256").update(buffer).digest();
}
function hash256(buffer: Buffer | string) {
  return sha256(sha256(buffer));
}
function ripemd160(buffer: Buffer | string) {
  return new RIPEMD160().update(buffer).digest();
}
function hash160(buffer: Buffer | string) {
  return ripemd160(sha256(buffer));
}
