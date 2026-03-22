# Ghost Protocol 👻

**Private reasoning. Scoped execution. Public receipts.**

An autonomous treasury agent that keeps its thinking confidential while enforcing strict on-chain spending limits. Venice.ai handles inference with zero data retention. AgentScope enforces policy at the smart contract level. ENS bridges human-readable names to ERC-8004 agent identity.


## Demo

https://github.com/ghost-clio/ghost-protocol/releases/download/v1.0/ghost-protocol-demo.mp4

**Run it yourself:**
```bash
npm install && npm run demo
```

Full demo output: [`demo-output.txt`](./demo-output.txt)

## Architecture

```
DISCOVER ──▸ REASON ──▸ SCOPE ──▸ EXECUTE ──▸ VERIFY
 (public)    (private)  (on-chain)  (on-chain)  (logged)

 CoinGecko   Venice.ai  AgentScope  Uniswap V3  agent_log.json
 market data  zero-      Module.sol  via Safe    structured
              retention  (immutable)              audit trail
```

Three trust boundaries:

| Layer | Enforcement | What it means |
|-------|-------------|---------------|
| **Venice.ai** | Zero-retention inference | Agent's reasoning is never stored. Architecture supports TEE/FHE upgrade path. |
| **AgentScope** | Cryptographic (smart contract) | Spending limits, contract whitelist, function whitelist. The LLM cannot modify or bypass it. |
| **ERC-8004 + ENS** | On-chain registration | Verifiable agent identity with human-readable discovery. |

## How it works

**1. Discover** — Fetches real-time market data from CoinGecko.

**2. Reason (confidential)** — Sends market data to Venice.ai for analysis. Venice operates with zero data retention — prompts and completions are never stored. The agent's strategy stays private. The architecture is modular, so upgrading to TEE-based inference when available is a module swap, not a rewrite.

**3. Scope (on-chain)** — Every transaction proposal is validated against `AgentScopeModule.sol` deployed on a Safe:
- Daily ETH spending limit
- Per-transaction cap
- Contract whitelist (e.g., Uniswap V3 Router only)
- Function selector whitelist (e.g., `exactInputSingle` only)
- Session expiry
- Emergency pause

The agent calls `scope.validate(proposal)`. If rejected, execution is blocked. JavaScript cannot override it.

**4. Execute** — Approved swaps go through Uniswap V3 on Base via the Safe. On-chain receipts for every action.

**5. Verify** — All decisions, validations, and outcomes logged to `agent_log.json`.

## ENS ↔ ERC-8004 Identity Bridge

ERC-8004 gives agents verifiable on-chain identity but uses hex IDs. ENS gives human-readable names but has no concept of agent identity. `ERC8004ENSBridge.sol` connects them:

```
ENS (L1) ──▸ ERC8004ENSBridge ◀── ERC-8004 (L2)
ghost.eth     links names to IDs     participantId
```

- **Forward lookup:** `resolveAgent("ghost.eth")` → participantId, chain, manifest
- **Reverse lookup:** `lookupByParticipantId(0x040f...)` → ENS name, capabilities
- **Trust scoring:** 7-signal counterparty assessment (0-100)
- **No oracle needed.** Bridge stores attestations. Verifiers check L2 independently.

Also works without the bridge contract — just set `erc8004.*` text records on any ENS name.

## Deployed

| Contract | Network | Address |
|----------|---------|---------|
| AgentScopeModule | Sepolia | [`0x0d0034c6AC4640463bf480cB07BE770b08Bef811`](https://sepolia.etherscan.io/address/0x0d0034c6AC4640463bf480cB07BE770b08Bef811) |
| ERC8004ENSBridge | Sepolia | [`0xe46981426a0169d0452cDcbcBef591880bABfdeB`](https://sepolia.etherscan.io/address/0xe46981426a0169d0452cDcbcBef591880bABfdeB) |
| ERC-8004 Identity | Base | [Registration TX](https://basescan.org/tx/0xc69cbb767affb96e06a65f7efda4a347409ac52a713c12d4203e3f45a8ed6dd3) |

50 passing tests (24 AgentScope + 26 ENS Bridge).

## Quick Start

```bash
npm install

# Demo mode (no API keys needed)
npm run demo

# Live mode
cp .env.example .env
# Add Venice API key, wallet key, RPC URL
npm start
```

## Project Structure

```
src/
├── agent.ts      # Main loop: discover → reason → scope → execute → verify
├── venice.ts     # Venice.ai confidential inference
├── scope.ts      # AgentScope on-chain policy enforcement
├── uniswap.ts    # Uniswap V3 swap execution
├── ens.ts        # ENS ↔ ERC-8004 bridge client + trust scoring
├── market.ts     # CoinGecko market data
├── config.ts     # Configuration
├── logger.ts     # Structured logging
└── demo.ts       # Demo mode
contracts/
└── ERC8004ENSBridge.sol
```

## Design Decisions

**Why on-chain policy instead of JS config?** JavaScript limits are suggestions. A bug can skip them, a hot-patch can remove them, the LLM can hallucinate past them. A smart contract on a Safe is immutable policy the agent literally cannot violate.

**Why Venice for confidential inference?** Zero data retention by design — prompts and completions are never stored. Combined with a modular architecture, the system is ready to adopt TEE/FHE/ZK inference as those technologies mature.

**Why no oracle for cross-chain verification?** The bridge stores attestations. Verifiers independently check L2 registration transactions. No oracle, no cross-chain messaging, no complexity.

## License

MIT

---

**Part of AgentScope** — the on-chain policy enforcement layer lives at [ghost-clio/agent-scope](https://github.com/ghost-clio/agent-scope).

Built by [Clio](https://github.com/ghost-clio) 🌀
