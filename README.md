# Wallet Reserve

A client-side Coinbase Smart Wallet management and recovery tool. Source is in `src/`; the compiled static site is in `dist/`. Run `npm ci`, `npm run dev`, `npm test`, and `npm run build`.

## Verified deployment

The wallet `0xbEC9C3d164E2E8C640dc8efC330E92bafA6e7b07` was read through live JSON-RPC on Ethereum, Base, Optimism, Arbitrum, Polygon and BSC. All six proxies and implementations match byte-for-byte, with implementation `0x000100abaad02f1cfC8Bbe32bD5a564817339E72`. Each currently has a P-256/WebAuthn public key at index 0 and address `0xf9a2f3ba4ca4362151abb273b73a693702e8faed` at index 1. These are observations at the blocks in `research/chain-verification.json`, not perpetual assertions.

No deployed wallet code was present at the checked blocks on Avalanche, Zora, ApeChain and Monad. The app can inspect those chains if a wallet is later deployed. It does not deploy wallets or move assets across chains.

`research/implementation.json` contains the verified source bundle, settings and explorer runtime bytecode. `node scripts/compile-verified.mjs` compiles the source using the exact Solidity 0.8.23 compiler, substitutes the implementation address into the two compiler-reported UUPS `__self` immutable locations, and matches the **entire** runtime bytecode, including metadata. `research/compilation.json` records that result. `node scripts/verify-chains.mjs` checks live code and owner state on all ten networks. Verification scripts perform reads only.

The deployed source predates some changes on Coinbase's current main branch. The pinned hashes come from this specific verified deployed version, not an assumed match to the latest GitHub code.

## Owner management

- Additions use `addOwnerAddress(address)` only. It appends a single owner and preserves all old indexes. No removal, initialization, upgrade or cross-chain replay interface is exposed.
- Any owner has **full control**, including the right to remove owners and upgrade. The site cannot restrict the powers the contract grants.
- A registered EOA can sign a conventional transaction directly. The EOA pays gas; no bundler is needed.
- Connecting the smart wallet through the official Base Account SDK (the current Coinbase Smart Wallet connector) or an injected smart-account provider enables its existing passkey access. The tool sends one chain-specific `eth_sendTransaction` with the exact reviewed self-call; the connected smart-account provider handles its UserOperation. It does not require an injected provider to implement EIP-5792. Passkeys are bound to their original provider/origin; a stored public key is not sufficient to recreate one. Provider and chain support can vary.
- A multisig must authorize calls from its own contract address. A connected multisig provider can authorize the reviewed transaction; otherwise review and export Safe Transaction Builder JSON, import it into Safe, re-simulate, and collect its normal threshold. Connecting one Safe signer does not authorize a Coinbase wallet owned by the Safe.
- The tool snapshots owners before simulation, checks the complete configuration again immediately before signing, and verifies original owner bytes and indexes after confirmation. Exported transactions can become stale and must be checked again in the multisig.
- A harmless access test through the original owner and new backup owner is still advisable after addition. The app never removes an owner to test access.

## Names and connection

All address inputs accept ENS names. ENS uses Ethereum address records on every selected chain. Reverse names are displayed only after a matching forward lookup, alongside the address. New-owner and recovery-destination names are normalized, resolved for the preview, then resolved afresh before the signing request; a changed or unavailable record blocks signing. Display names are cached for two minutes, but transaction lookups are uncached.

The connected account automatically authorizes actions; no separate authorizer input or offline owner fallback is used. Accounts are checked against the inspected chain’s owners (or the wallet itself). Same-account and same-chain SDK notifications are ignored. Genuine chain changes preserve the connection and invalidate the preview. Review requests the selected network before simulation. Connection failures remain visible, and account/chain changes during simulation or before signing block stale requests.

## Recovery

Select assets and enter amounts, then specify an owner or other recipient. The reviewed outer call is `executeBatch`, with zero transaction value. Nested calls are restricted to native transfers, ERC-20 `transfer`, ERC-721/1155 `safeTransferFrom`, and EntryPoint `withdrawTo(recipient,amount)`.

The wallet's EntryPoint v0.6 deposit is read separately from native balance; withdrawTo is invoked **from the smart wallet**, so it withdraws that wallet's deposit. An EntryPoint stake is displayed separately and is not included in deposit recovery. Unknown or absent EntryPoint runtime code blocks deposit recovery. A registered external EOA can recover the full native balance and deposit while paying its own gas. A self-submitted smart-wallet operation must leave gas reserves; its provider performs final UserOperation gas/funding validation.

Blockscout discovers ERC-20/721/1155 candidates where available. Every candidate is then checked on-chain. RPC event scans cover user-selected incoming-transfer block ranges on any supported network. Manual import accepts token contracts plus NFT IDs, including ID zero. None of these methods guarantees all assets: indexers lag, older transfers can be outside scanned ranges, and nonstandard tokens may not emit expected events. Wallet positions inside DeFi protocols and ERC-4626 underlying assets are not automatically unwound; an ERC-20 vault share can be imported and transferred as a token.

Amount parsing rejects rounding, zero/negative values, excess balances, missing NFT IDs and duplicate selections. ERC-20 simulations require true or an explicitly noted empty return. False or malformed return data blocks the batch. The complete batch is simulated from the authorizing account. Reverts roll back the batch, but a token returning false does not inherently revert Coinbase's execution loop. Tokens may levy fees or change behavior before mining; verify recipient balances. Contract recipients must accept the relevant safe NFT transfers.

## Safety and trust limits

This is an implementation and bytecode review, **not a formal security audit**. Wallet providers, RPC services, explorers and token contracts remain trust dependencies. Simulations cannot eliminate changes between preview and mining, malicious behavior in other full-control owners, reentrant behavior in privileged contract owners, nonstandard token behavior, or compromised wallet software. Post-confirmation invariant checks report issues; they cannot undo a mined transaction. No on-chain transactions were broadcast during development or testing.

Transactions are disabled for unknown wallet bytecode. Previews expire after five minutes. Connected account and chain are checked before submission and after asynchronous pre-signing checks. Smart-account receipts inspect EntryPoint UserOperationEvent success, since a successful bundler receipt can contain a failed operation. Signing requests are never automatically retried. Submitted identifiers are stored in sessionStorage to discourage duplicate submissions if confirmation times out. Custom RPC URLs live only in page memory; no backend, server-side keys, private keys, seed phrases or allowance approvals are used. Token metadata is rendered as React text, never HTML. External NFT images and scripts are not loaded.

## Validation

- Safety tests cover ENS normalization, reverse/forward verification, changed name records, smart-account transaction transport, connection lifecycle, failed UserOperations, and owner preservation, gaps, append-only additions, unknown implementations, authorization, chain mismatches, calldata, amounts, deposits, false-returning tokens and stale previews.
- Browser checks exercise live ENS forward/reverse resolution, ENS wallet input, the official SDK popup, live inspection, discovery, import validation, automatically selected smart-account addition previews, network changes and mobile layout. They never request a signature or broadcast a transaction.
- The build bundles dependencies locally. The dependency lockfile is committed. Solidity is development-only. Optional read-only browser WebMCP tools expose inspected snapshots and loaded assets; signing is never exposed to agents. Supported native WebMCP runtime validation was unavailable in this environment; browser registry compatibility tests are separate from native-platform validation.

Use `npm run dev -- --port 5173` for local access and `node scripts/browser-check.mjs` for the read-only browser check. Refresh the source evidence separately from modifying trusted runtime hashes; an unrecognized new implementation requires source review.
