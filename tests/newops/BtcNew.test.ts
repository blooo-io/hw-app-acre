/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { openTransportReplayer, RecordStore } from "@ledgerhq/hw-transport-mocker";
import { TransportReplayer } from "@ledgerhq/hw-transport-mocker/lib/openTransportReplayer";
import ecc from "tiny-secp256k1";
import { getXpubComponents, pathArrayToString } from "../../src/bip32";
import BtcNew from "../../src/BtcNew";
import { DefaultDescriptorTemplate, WalletPolicy } from "../../src/newops/policy";
import { PsbtV2 } from "../../src/newops/psbtv2";
import { splitTransaction } from "../../src/splitTransaction";
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
test("testGetWalletPublicKeyRealClient p2wpkh", async () => {
  await testGetWalletPublicKeyRealClient("m/84'/1'/0'", "wpkh(@0)");
});
test("testSignMessageRealClient", async () => {
  await testSignMessageRealClient("m/84'/1'/0'");
});
test("getWalletPublicKey wrapped p2wpkh", async () => {
  await testGetWalletPublicKey("m/49'/1'/0'", "sh(wpkh(@0))");
  await testGetWalletPublicKey("m/49'/0'/17'", "sh(wpkh(@0))");
});
test("getWalletPublicKey p2tr", async () => {
  await testGetWalletPublicKey("m/86'/1'/0'", "tr(@0)");
  await testGetWalletPublicKey("m/86'/0'/17'", "tr(@0)");
});

test("signWithdrawalRealClient", async () => {
  await testSignWithdrawalRealClient();
}, 10 * 60 * 1000);

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
  const btc = new BtcNew(client);
  const result = await btc.getWalletXpub({ path: path, xpubVersion: version });
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

  const btcNew = new BtcNew(client);
  const addressFormat = addressFormatFromDescriptorTemplate(expectedDescriptorTemplate);
  const result = await btcNew.getWalletPublicKey(path, { format: addressFormat });
  log('address', result.bitcoinAddress)
  verifyGetWalletPublicKeyResult(result, keyXpub, "testaddress");
  console.log('notworkingforsure')
  const resultAccount = await btcNew.getWalletPublicKey(accountPath);
  verifyGetWalletPublicKeyResult(resultAccount, accountXpub);
}

async function testGetWalletPublicKeyRealClient(
  accountPath: string,
  expectedDescriptorTemplate: DefaultDescriptorTemplate,
) {
  const transport = await openTransportReplayer(RecordStore.fromString(`
    => e10000001600058000005480000001800000000000000000000000
    <= 74707562444742337234346d37666a654c36676a6b75456e6e5a6e586677646e7a71524b6b713961636576354d464755653631766179326e6e3270427a56654e546d613563745733415746524a644c65707a737a35503332676a4d426268687837684b6434664a4d587361635a364c9000
    => e10000000e0003800000548000000180000000
    <= 747075624443744b66734e795268554c6a5a39584d5334564b4b7456635064564469384d4b5562635344394d4a44796a52753141324e44354d6969706f7a797973704254396267387570457037613845416746784e78586e316437516b64624c35325479356a69534c6378507431509000
    => e105000000
    <= f5acc2fd9000
    => e10300004600893198490079bb0667594bfa902274b1cd28d7ed9df140121dc69021bead679f00000000000000000000000000000000000000000000000000000000000000000000000000
    <= 4000893198490079bb0667594bfa902274b1cd28d7ed9df140121dc69021bead679fe000
    => f80100002e2c2c01000877706b682840302901ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe340
    <= 41ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe3400100e000
    => f801000022ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe3400000
    <= 4000ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe340e000
    => f8010000898787005b66356163633266642f3834272f31272f30275d747075624443744b66734e795268554c6a5a39584d5334564b4b7456635064564469384d4b5562635344394d4a44796a52753141324e44354d6969706f7a797973704254396267387570457037613845416746784e78586e316437516b64624c35325479356a69534c6378507431502f2a2a
    <= 41ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe3400100e000
    => f801000022ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe3400000
    <= 4000ac0efe99ff9d292d0e7bd2eab1b24480f963c52afe2e655d966827d3efbbe340e000
    => f8010000898787005b66356163633266642f3834272f31272f30275d747075624443744b66734e795268554c6a5a39584d5334564b4b7456635064564469384d4b5562635344394d4a44796a52753141324e44354d6969706f7a797973704254396267387570457037613845416746784e78586e316437516b64624c35325479356a69534c6378507431502f2a2a
    <= 746231717a647237733273723064776d6b777830333372346e756a7a6b38367530637936666d7a666a6b9000
    => e10000000e0003800000548000000180000000
    <= 747075624443744b66734e795268554c6a5a39584d5334564b4b7456635064564469384d4b5562635344394d4a44796a52753141324e44354d6969706f7a797973704254396267387570457037613845416746784e78586e316437516b64624c35325479356a69534c6378507431509000
    `));
  const client = new AppClient(transport);
  const path = accountPath + "/0/0";
  // const accountXpub =
  //   "tpubDCwYjpDhUdPGP5rS3wgNg13mTrrjBuG8V9VpWbyptX6TRPbNoZVXsoVUSkCjmQ8jJycjuDKBb9eataSymXakTTaGifxR6kmVsfFehH1ZgJT";
  // const keyXpub =
  //   "tpubDHcN44A4UHqdHJZwBxgTbu8Cy87ZrZkN8tQnmJGhcijHqe4rztuvGcD4wo36XSviLmiqL5fUbDnekYaQ7LzAnaqauBb9RsyahsTTFHdeJGd";
  // client.getPubkeyResponse(accountPath, accountXpub);
  // client.mockGetPubkeyResponse(path, keyXpub);
  // const key = `[${masterFingerprint.toString("hex")}${accountPath.substring(1)}]${accountXpub}/**`;
  // client.mockGetWalletAddressResponse(
  //   new WalletPolicy(expectedDescriptorTemplate, key),
  //   0,
  //   0,
  //   "testaddress",
  // );

  const btcNew = new BtcNew(client);
  const addressFormat = addressFormatFromDescriptorTemplate(expectedDescriptorTemplate);
  const result = await btcNew.getWalletPublicKey(path, { format: addressFormat });
  log('address', result.bitcoinAddress)
  // verifyGetWalletPublicKeyResult(result, keyXpub, "testaddress");
  const resultAccount = await btcNew.getWalletPublicKey(accountPath);
  // verifyGetWalletPublicKeyResult(resultAccount, accountXpub);
}

async function testSignMessageRealClient(
  accountPath: string,
) {
  // try createTransportRecorder
  const transport = await openTransportReplayer(RecordStore.fromString(`
    => e11000003605800000548000000180000000000000000000000004dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058e
    <= 41dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058e0100e000
    => f801000022dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058e0000
    <= 4000dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058ee000
    => f80100000705050074657374
    <= 41dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058e0100e000
    => f801000022dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058e0000
    <= 4000dbebd10e61bc8c28591273feafbbef95d544f874693301d8f7f8e54c6e30058ee000
    => f80100000705050074657374
    <= 1f32af834dbf7e64f730a1fb76d1970cb66517222bfb017f46a75f91cc1fa216b76fd35df48d28b9c2c4b994e7799608cc1353ae810d1049a8ab8af047e16a1a999000
    `));
  const client = new AppClient(transport);
  const path = accountPath + "/0/0";

  const btcNew = new BtcNew(client);
  const result = await btcNew.signMessage({ path: path, messageHex: Buffer.from("test").toString("hex") });
  console.log('v,r,s: ', result)
}

async function testSignWithdrawalRealClient() {
  
  const transport = new SpeculosTransport("http://localhost:5000")

  const withdrawalData: AcreWithdrawalData = {
    to: "0xc14972DC5a4443E4f5e89E3655BE48Ee95A795aB",
    value: "0x0",
    data: "0xcae9ca510000000000000000000000000e781e9d538895ee99bd6e9bf28664942beff32f00000000000000000000000000000000000000000000000000470de4df820000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001000000000000000000000000006083Bde64CCBF08470a1a0dAa9a0281B4951be7C4b5e4623765ec95cfa6e261406d5c446012eff9300000000000000000000000008dcc842b8ed75efe1f222ebdc22d1b06ef35efff6469f708057266816f0595200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000587f579c500000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000001a1976a9143c6480044cfafde6dad7f718f76938cc87d0679a88ac000000000000",
    operation: "0",
    safeTxGas: "0x0",
    baseGas: "0x0",
    gasPrice: "0x0",
    gasToken: "0x0000000000000000000000000000000000000000",
    refundReceiver: "0x0000000000000000000000000000000000000000",
    nonce: "0xC",
  };
  const client = new AppClient(transport);
  const path = "m/44'/0'/0'/0/0";

  const btcNew = new BtcNew(client);
  const result = await btcNew.signWithdrawal({path: path, withdrawalData: withdrawalData});
  console.log('signed withdrawal:', result);
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
