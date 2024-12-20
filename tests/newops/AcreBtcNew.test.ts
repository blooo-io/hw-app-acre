/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { openTransportReplayer, RecordStore } from "@ledgerhq/hw-transport-mocker";
import { TransportReplayer } from "@ledgerhq/hw-transport-mocker/lib/openTransportReplayer";
import SpeculosTransport from "../speculosTransport";
import ecc from "tiny-secp256k1";
import { getXpubComponents, pathArrayToString } from "../../src/bip32";
import AcreBtcNew from "../../src/AcreBtcNew";
import { DefaultDescriptorTemplate, WalletPolicy } from "../../src/newops/policy";
import { PsbtV2 } from "../../src/newops/psbtv2";
import { splitTransaction } from "../../src/splitTransaction";
import { withdrawalAPDUs, signMessageAPDUs, signERC4361APDUs } from "./apdus";
import {
  StandardPurpose,
  addressFormatFromDescriptorTemplate,
  creatDummyXpub,
  masterFingerprint,
  runSignTransaction,
  TestingClient,
} from "./integrationtools";
import {
  CoreInput,
  CoreTx,
  p2pkh,
  p2tr,
  p2wpkh,
  wrappedP2wpkh,
  wrappedP2wpkhTwoInputs,
} from "./testtx";
import { AppClient } from "../../src/newops/appClient";
import { AcreWithdrawalData } from '../../src/types';
import { listen, log } from "@ledgerhq/logs";
listen(log => console.log(log));

test("getWalletPublicKey p2pkh", async () => {
  await testGetWalletPublicKey("m/44'/1'/0'", "pkh(@0)");
  await testGetWalletPublicKey("m/44'/0'/17'", "pkh(@0)");
});
test("getWalletPublicKey p2wpkh", async () => {
  await testGetWalletPublicKey("m/84'/1'/0'", "wpkh(@0)");
  await testGetWalletPublicKey("m/84'/0'/17'", "wpkh(@0)");
});
test("getWalletPublicKey wrapped p2wpkh", async () => {
  await testGetWalletPublicKey("m/49'/1'/0'", "sh(wpkh(@0))");
  await testGetWalletPublicKey("m/49'/0'/17'", "sh(wpkh(@0))");
});
test("getWalletPublicKey p2tr", async () => {
  await testGetWalletPublicKey("m/86'/1'/0'", "tr(@0)");
  await testGetWalletPublicKey("m/86'/0'/17'", "tr(@0)");
});

test("getWalletXpub normal path", async () => {
  await testGetWalletXpub("m/11'/12'");
  await testGetWalletXpub("m/11");
  await testGetWalletXpub("m/44'/0'/0'");
});

test("testSignMessage", async () => {
  await testSignMessageReplayer("m/44'/0'/0'");
});

test("signWithdrawal", async () => {
  await testSignWithdrawalReplayer();
});

test("Sign ERC4361 message", async () => {
  await testSignERC4361MessageReplayer("m/44'/0'/0'");
});

function testPaths(type: StandardPurpose): { ins: string[]; out?: string } {
  const basePath = `m/${type}/1'/0'/`;
  const ins = [
    basePath + "0/0",
    basePath + "1/0",
    basePath + "0/1",
    basePath + "1/1",
    basePath + "0/2",
    basePath + "1/2",
  ];
  return { ins };
}

test("Sign p2pkh", async () => {
  const changePubkey = "037ed58c914720772c59f7a1e7e76fba0ef95d7c5667119798586301519b9ad2cf";
  await runSignTransactionTest(p2pkh, StandardPurpose.p2pkh, changePubkey);
});
test("Sign p2wpkh wrapped", async () => {
  let changePubkey = "03efc6b990c1626d08bd176aab0e545a4f55c627c7ddee878d12bbbc46a126177a";
  await runSignTransactionTest(wrappedP2wpkh, StandardPurpose.p2wpkhInP2sh, changePubkey);
  changePubkey = "031175a985c56e310ce3496a819229b427a2172920fd20b5972dda62758c6def09";
  await runSignTransactionTest(wrappedP2wpkhTwoInputs, StandardPurpose.p2wpkhInP2sh, changePubkey);
});
test("Sign p2wpkh", async () => {
  await runSignTransactionTest(p2wpkh, StandardPurpose.p2wpkh);
});
test("Sign p2tr", async () => {
  // This tx uses locktime, so this test verifies that locktime is propagated to/from
  // the psbt correctly.
  await runSignTransactionTest(p2tr, StandardPurpose.p2tr);
});

test("Sign p2tr with sigHashType", async () => {
  const testTx = JSON.parse(JSON.stringify(p2tr));
  testTx.vin.forEach((input: CoreInput) => {
    // Test SIGHASH_SINGLE | SIGHASH_ANYONECANPAY, 0x83
    const sig = input.txinwitness![0] + "83";
    input.txinwitness = [sig];
  });
  await runSignTransactionNoVerification(testTx, StandardPurpose.p2tr);
  // The verification of the sighashtype is done in MockClient.signPsbt
});

test("Sign p2tr sequence 0", async () => {
  const testTx = JSON.parse(JSON.stringify(p2tr));
  testTx.vin.forEach((input: CoreInput) => {
    input.sequence = 0;
  });
  const tx = await runSignTransactionNoVerification(testTx, StandardPurpose.p2tr);
  const txObj = splitTransaction(tx, true);
  txObj.inputs.forEach(input => {
    expect(input.sequence.toString("hex")).toEqual("00000000");
  });
});

async function runSignTransactionTest(
  testTx: CoreTx,
  accountType: StandardPurpose,
  changePubkey?: string,
) {
  const tx = await runSignTransactionNoVerification(testTx, accountType, changePubkey);
  expect(tx).toEqual(testTx.hex);
}

async function runSignTransactionNoVerification(
  testTx: CoreTx,
  accountType: StandardPurpose,
  changePubkey?: string,
): Promise<string> {
  const [client, transport] = await createClient();
  const accountXpub =
    "tpubDCwYjpDhUdPGP5rS3wgNg13mTrrjBuG8V9VpWbyptX6TRPbNoZVXsoVUSkCjmQ8jJycjuDKBb9eataSymXakTTaGifxR6kmVsfFehH1ZgJT";
  client.mockGetPubkeyResponse(`m/${accountType}/1'/0'`, accountXpub);
  const paths = testPaths(accountType);
  if (changePubkey) {
    paths.out = `m/${accountType}/1'/0'` + "/1/3";
    client.mockGetPubkeyResponse(paths.out, creatDummyXpub(Buffer.from(changePubkey, "hex")));
  }
  const tx = await runSignTransaction(testTx, paths, client, transport);
  await transport.close();
  return tx;
}

async function testGetWalletXpub(path: string, version = 0x043587cf) {
  const [client] = await createClient();
  const expectedXpub =
    "tpubDCwYjpDhUdPGP5rS3wgNg13mTrrjBuG8V9VpWbyptX6TRPbNoZVXsoVUSkCjmQ8jJycjuDKBb9eataSymXakTTaGifxR6kmVsfFehH1ZgJT";
  client.mockGetPubkeyResponse(path, expectedXpub);
  const acre = new AcreBtcNew(client);
  const result = await acre.getWalletXpub({ path: path, xpubVersion: version });
  expect(result).toEqual(expectedXpub);
}
async function testGetWalletPublicKey(
  accountPath: string,
  expectedDescriptorTemplate: DefaultDescriptorTemplate,
) {
  const [client, transport] = await createClient();
  const path = accountPath + "/0/0";
  const accountXpub =
    "tpubDCwYjpDhUdPGP5rS3wgNg13mTrrjBuG8V9VpWbyptX6TRPbNoZVXsoVUSkCjmQ8jJycjuDKBb9eataSymXakTTaGifxR6kmVsfFehH1ZgJT";
  const keyXpub =
    "tpubDHcN44A4UHqdHJZwBxgTbu8Cy87ZrZkN8tQnmJGhcijHqe4rztuvGcD4wo36XSviLmiqL5fUbDnekYaQ7LzAnaqauBb9RsyahsTTFHdeJGd";
  client.mockGetPubkeyResponse(accountPath, accountXpub);
  client.mockGetPubkeyResponse(path, keyXpub);
  const key = `[${masterFingerprint.toString("hex")}${accountPath.substring(1)}]${accountXpub}/**`;
  client.mockGetWalletAddressResponse(
    new WalletPolicy(expectedDescriptorTemplate, key),
    0,
    0,
    "testaddress",
  );

  const acreBtcNew = new AcreBtcNew(client);
  const addressFormat = addressFormatFromDescriptorTemplate(expectedDescriptorTemplate);
  const result = await acreBtcNew.getWalletPublicKey(path, { format: addressFormat });
  log('address', result.bitcoinAddress)
  verifyGetWalletPublicKeyResult(result, keyXpub, "testaddress");
  const resultAccount = await acreBtcNew.getWalletPublicKey(accountPath);
  verifyGetWalletPublicKeyResult(resultAccount, accountXpub);
}

async function testSignMessageReplayer(
  accountPath: string,
) {
  const transport = await openTransportReplayer(RecordStore.fromString(signMessageAPDUs));
  const client = new AppClient(transport);
  const path = accountPath + "/0/0";

  const acreBtcNew = new AcreBtcNew(client);
  const result = await acreBtcNew.signMessage({ path: path, messageHex: Buffer.from("test").toString("hex") });
  expect(result).toEqual({
    v: 0,
    r: 'df44ce2f8f6f62fec9b0d01bd66bc91aa73984e0cf02ad8ff7bf12f8013ba779',
    s: '6d8ed4d795a542509ec7f63539ec6521a3d61a29e4cf9c6d9a386b06b32f224b'
  })

}

async function testSignWithdrawalReplayer() {

  const transport = await openTransportReplayer(RecordStore.fromString(withdrawalAPDUs));
  const client = new AppClient(transport);

  const withdrawalData: AcreWithdrawalData = {
    to: "0xc14972DC5a4443E4f5e89E3655BE48Ee95A795aB",
    value: "0x0",
    data: "0xcae9ca510000000000000000000000000e781e9d538895ee99bd6e9bf28664942beff32f00000000000000000000000000000000000000000000000000470de4df820000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001000000000000000000000000006083Bde64CCBF08470a1a0dAa9a0281B4951be7C4b5e4623765ec95cfa6e261406d5c446012eff9300000000000000000000000008dcc842b8ed75efe1f222ebdc22d1b06ef35efff6469f708057266816f0595200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000587f579c500000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000001a1976a914c8e9edf5e915c0482b1b236fc917011a4b943e6e88ac000000000000",
    operation: "0",
    safeTxGas: "0x0",
    baseGas: "0x0",
    gasPrice: "0x0",
    gasToken: "0x0000000000000000000000000000000000000000",
    refundReceiver: "0x0000000000000000000000000000000000000000",
    nonce: "0xC",
  };
  const path = "m/44'/0'/0'/0/0";

  const acreBtcNew = new AcreBtcNew(client);
  const result = await acreBtcNew.signWithdrawal({path: path, withdrawalData: withdrawalData});
  expect(result).toEqual({
    v: 0,
    r: '88c6c773f8d3101e30bbcc7811f8b553d222265023b981ad2f12dfa0da8ae8c2',
    s: '3f718ebdfc1990b5baa0a908ae9b093c6719fd7251d7cb5c75355cb9196b6410',
  });
}

async function testSignERC4361MessageReplayer(
  accountPath: string,
) {
  const transport = await openTransportReplayer(RecordStore.fromString(signERC4361APDUs));
  const client = new AppClient(transport);
  const path = accountPath + "/0/0";

  const acreBtcNew = new AcreBtcNew(client);
  const message = "stake.acre.fi wants you to sign in with your Bitcoin account:\nbc1q8fq0vs2f9g52cuk8px9f664qs0j7vtmx3r7wvx\n\n\nURI: https://stake.acre.fi\nVersion: 1\nNonce: cw73Kfdfn1lY42Jj8\nIssued At: 2024-10-01T11:03:05.707Z\nExpiration Time: 2024-10-08T11:03:05.707Z"
  const result = await acreBtcNew.signERC4361Message({messageHex: Buffer.from(message).toString("hex"), path: path});
  expect(result).toEqual({
    v: 1,
    r: 'f30ff91331b840cc97560b468d9dce0647afbef7fd74819773721a096905da7e',
    s: '664a3ce374f1951e40222d433cd8d6977dde08af6320acc8dd90fa35ed1c8ed8'
  });

}

function verifyGetWalletPublicKeyResult(
  result: { publicKey: string; bitcoinAddress: string; chainCode: string },
  expectedXpub: string,
  expectedAddress?: string,
) {
  expect(result.bitcoinAddress).toEqual(expectedAddress ?? "");
  const expectedComponents = getXpubComponents(expectedXpub);
  const expectedPubKey = Buffer.from(ecc.pointCompress(expectedComponents.pubkey, false));
  expect(expectedPubKey.length).toEqual(65);
  expect(result.chainCode).toEqual(expectedComponents.chaincode.toString("hex"));
  expect(result.publicKey).toEqual(expectedPubKey.toString("hex"));
}

export async function createClient(): Promise<[MockClient, TransportReplayer]> {
  const transport = await openTransportReplayer(RecordStore.fromString(""));
  return [new MockClient(transport), transport];
}

class MockClient extends TestingClient {
  getPubkeyResponses = new Map();
  getWalletAddressResponses = new Map();
  yieldSigs: Map<number, Buffer>[] = [];
  mockGetPubkeyResponse(pathElements: string, response: string) {
    this.getPubkeyResponses.set(pathElements, response);
  }
  mockGetWalletAddressResponse(
    walletPolicy: WalletPolicy,
    change: number,
    addressIndex: number,
    response: string,
  ) {
    const key = this.getWalletAddressKey(walletPolicy, change, addressIndex);
    this.getWalletAddressResponses.set(key, response);
  }
  mockSignPsbt(yieldSigs: Map<number, Buffer>) {
    this.yieldSigs.push(yieldSigs);
  }
  async getExtendedPubkey(display: boolean, pathElements: number[]): Promise<string> {
    const path = pathArrayToString(pathElements);
    const response = this.getPubkeyResponses.get(path);
    if (!response) {
      throw new Error("No getPubkey response prepared for " + path);
    }
    return response;
  }

  async getWalletAddress(
    walletPolicy: WalletPolicy,
    walletHMAC: Buffer | null,
    change: number,
    addressIndex: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    display: boolean,
  ): Promise<string> {
    const key = this.getWalletAddressKey(walletPolicy, change, addressIndex);
    const response = this.getWalletAddressResponses.get(key);
    if (!response) {
      throw new Error("No getWalletAddress response prepared for " + key);
    }
    return response;
  }
  async getMasterFingerprint(): Promise<Buffer> {
    return masterFingerprint;
  }
  async signPsbt(
    psbt: PsbtV2,
    _walletPolicy: WalletPolicy,
    _walletHMAC: Buffer | null,
  ): Promise<Map<number, Buffer>> {
    const sigs = this.yieldSigs.splice(0, 1)[0];
    const sig0 = sigs.get(0)!;
    if (sig0.length == 64) {
      // Taproot may leave out sighash type, which defaults to 0x01 SIGHASH_ALL
      return sigs;
    }
    const sigHashType = sig0.readUInt8(sig0.length - 1);
    if (sigHashType != 0x01) {
      for (let i = 0; i < psbt.getGlobalInputCount(); i++) {
        expect(psbt.getInputSighashType(i)).toEqual(sigHashType);
      }
    }
    return sigs;
  }
  private getWalletAddressKey(
    walletPolicy: WalletPolicy,
    change: number,
    addressIndex: number,
  ): string {
    return walletPolicy.serialize().toString("hex") + change + addressIndex;
  }
}