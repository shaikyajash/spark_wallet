import type { SparkWallet } from "@buildonspark/spark-sdk";

let wallet: SparkWallet | null = null;
let connectedAddress: string | null = null;
let connectedNetwork: string | null = null;

export function setWallet(w: SparkWallet, address: string, network: string) {
  wallet = w;
  connectedAddress = address;
  connectedNetwork = network;
}

export function getWallet() { return wallet; }

export function getStatus() {
  return { connected: wallet !== null, address: connectedAddress, network: connectedNetwork };
}

export function clearWallet() {
  wallet = null;
  connectedAddress = null;
  connectedNetwork = null;
}
