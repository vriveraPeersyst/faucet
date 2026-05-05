import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NATIVE_XRP_ERC20 = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
const MINT_AMOUNT = parseEther("100");
// Receipt wait window — XRPL EVM finalises in ~5s, so 30s is generous.
const RECEIPT_TIMEOUT_MS = 30_000;

const xrplEvmDevnet = defineChain({
  id: 1449900,
  name: "XRPL EVM Devnet",
  nativeCurrency: { name: "XRP", symbol: "XRP", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.devnet.xrplevm.org"] } },
});

const mintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const address = (body as { address?: unknown })?.address;
  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid EVM address" }, { status: 400 });
  }

  const rawKey = process.env.DEVNET_FAUCET_PRIVATE_KEY;
  if (!rawKey) {
    console.error("[devnet-faucet] DEVNET_FAUCET_PRIVATE_KEY is not set");
    return NextResponse.json({ error: "Faucet not configured" }, { status: 500 });
  }
  const pk = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

  const account = privateKeyToAccount(pk);
  const transport = http();
  const walletClient = createWalletClient({ account, chain: xrplEvmDevnet, transport });
  const publicClient = createPublicClient({ chain: xrplEvmDevnet, transport });

  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
      address: NATIVE_XRP_ERC20,
      abi: mintAbi,
      functionName: "mint",
      args: [address, MINT_AMOUNT],
    });
  } catch (err) {
    console.error("[devnet-faucet] writeContract failed", err);
    const message = err instanceof Error ? err.message : "Mint submission failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success") {
      return NextResponse.json(
        { error: "Mint reverted on-chain", txHash },
        { status: 500 },
      );
    }
  } catch (err) {
    // Receipt timed out — the tx is still pending. Return the hash so the client
    // can link to the explorer; not treating this as a hard error.
    console.warn("[devnet-faucet] receipt wait timed out", err);
  }

  return NextResponse.json({ txHash });
}
