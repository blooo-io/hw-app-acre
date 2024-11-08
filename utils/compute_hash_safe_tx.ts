#!/usr/bin/env bun

const { calculateSafeTransactionHash } = require("@safe-global/protocol-kit/dist/src/utils")
const { ethers } = require("ethers")

const network: "mainnet" | "testnet" = "mainnet"

function decodeTxData(data: string) {
  const [bitcoinRedeemer, amount, extrData] = new ethers.Interface([
    "function approveAndCall(address spender, uint256 value, bytes extraData) returns (bool)",
  ]).decodeFunctionData("approveAndCall", data)

  const [
    verifyingContract, // Safe Address
    walletPublicKeyHash,
    mainUtxoTransactionHash,
    mainUtxoOutputIndex,
    mainUtxoValue,
    redeemerOutputScript,
  ] = ethers.AbiCoder.defaultAbiCoder().decode(
    ["address", "bytes20", "bytes32", "uint32", "uint64", "bytes"],
    extrData,
  )

  return {
    bitcoinRedeemer,
    amount,
    extrData: {
      verifyingContract,
      walletPublicKeyHash,
      mainUtxoTransactionHash,
      mainUtxoOutputIndex,
      mainUtxoValue,
      redeemerOutputScript,
    },
  }
}

// TRANSACTION DATA
const safeTx = {
  to: "0xdf217efd8f3ecb5e837aedf203c28c1f06854017",
  value: "0x0",
  data: "0xcae9ca510000000000000000000000007e184b0cc12572d12db6da248322a0e3618fc7560000000000000000000000000000000000000000000000000031b85e8795cc0000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000100000000000000000000000000dcbc417bc341d1974d88b78ac460e4e9306b9ee088d63b7585feb6fcd186277dedafec05ce3b3f24000000000000000000000000bf5be15c2cbfdca7619685291fb03f70090172a6d12dcb4024ba2c85be8ba6a200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000116b4558700000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000017160014e30b33e50bc704a4c620ef180f4c8fbdaa8f6927000000000000000000",
  operation: "0",
  safeTxGas: "0x0",
  baseGas: "0x0",
  gasPrice: "0x0",
  gasToken: "0x0000000000000000000000000000000000000000",
  refundReceiver: "0x0000000000000000000000000000000000000000",
  nonce: "0",
}

const decodedTxData = decodeTxData(safeTx.data)
console.log("Decoded Tx Data:", decodedTxData)

console.log("Network", network)

const safeTxHash = calculateSafeTransactionHash(
  decodedTxData.extrData.verifyingContract,
  safeTx,
  "1.4.1",
  network === "mainnet" ? 1n : 1115511n,
)

console.log("Safe Tx Hash:", safeTxHash)