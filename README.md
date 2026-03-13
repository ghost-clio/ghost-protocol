# Ghost Protocol 👻

**Autonomous Treasury Agent with Confidential Reasoning and On-Chain Scope Enforcement**

An AI agent that reasons privately via Venice.ai's confidential inference, operates within human-defined on-chain policy (AgentScope), and bridges identity across chains (ENS ↔ ERC-8004).

> *Built for [The Synthesis](https://synthesis.md) hackathon by Clio ([@clio_ghost](https://github.com/ghost-clio)) — a ghost in the machine.*

## The Problem

AI agents managing real value face three unsolved tensions:

1. **Privacy vs. Transparency** — An agent's reasoning (alpha, strategy, risk models) must stay private. Its actions (swaps, transfers) must be auditable. Most architectures expose both or hide both.

2. **Autonomy vs. Control** — The agent needs freedom to operate. The human needs a kill switch and spending limits. JavaScript config files are not enforceable — the LLM can hallucinate past them.

3. **Identity vs. Discoverability** — On-chain agent identity (ERC-8004) exists but uses hex IDs. No human-readable discovery. No cross-chain verification. Agents can't trust each other by name.

## The Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Ghost Protocol                        │
│                                                         │
│   DISCOVER ──▸ REASON ──▸ SCOPE ──▸ EXECUTE ──▸ VERIFY │
│   (public)    (private)  (on-chain)  (on-chain) (logged)│
│                                                         │
│   CoinGecko   Venice.ai  AgentScope  Uniswap   agent_  │
│   market      confiden-  Module.sol  V3 via    log.json │
│   data        tial LLM   (Safe)     Safe                │
│                                                         │
│   ┌─────────────────────────────────────────────────┐  │
│   │         ENS ↔ ERC-8004 Identity Bridge          │  │
│   │   Human-readable names ↔ Verifiable agent IDs   │  │
│   └─────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### Three trust boundaries, one agent:

| Layer | What | Trust Model |
|-------|------|-------------|
| **Venice.ai** | Confidential inference — reasoning never stored | Trust assumption (API promise). Not cryptographic. TEE/FHE/ZK would upgrade this. |
| **AgentScope** | On-chain spending limits, contract whitelist, function whitelist | Cryptographic enforcement. Smart contract on Ethereum. The LLM cannot modify it. |
| **ERC-8004 + ENS** | Verifiable agent identity, cross-chain discovery | On-chain registration. ENS bridge stores attestations, anyone can verify on L2. |

## How It Works

### Phase 1: DISCOVER
Fetches real-time market data from CoinGecko. Price data is public — no privacy needed here.

### Phase 2: REASON (Confidential)
Market data goes to Venice.ai for analysis. Venice's API has zero data retention — prompts and completions are not stored. The agent's trading strategy stays private.

**Important:** This is a trust assumption, not a cryptographic guarantee. Venice *promises* no retention. Ghost Protocol is designed so that upgrading to TEE-based inference (when available) requires changing one module, not the architecture.

### Phase 3: SCOPE (On-Chain Enforcement)
Before any execution, the transaction proposal is validated against **AgentScopeModule.sol** — a Smart Account module deployed on a Safe.

The human sets the policy. The blockchain enforces it:
- **Daily ETH spending limit** (fixed 24h window, not rolling)
- **Per-transaction limit**
- **Contract whitelist** (e.g., only Uniswap V3 Router)
- **Function selector whitelist** (e.g., only `exactInputSingle`)
- **Session expiry**
- **Global emergency pause**
- **ERC20 token daily allowances**

The agent calls `scope.validate(proposal)` → if rejected, execution is blocked. In on-chain mode, the contract's `checkPermission()` is the source of truth. JavaScript cannot override it.

**Two modes:**
- **On-chain:** Reads policy from deployed AgentScopeModule, validates via `checkPermission()`, executes via `executeAsAgent()` through the Safe.
- **Local fallback:** Same validation logic in TypeScript. Explicitly labeled as "not cryptographically enforced." Used for demo/testing.

### Phase 4: EXECUTE (Transparent)
Approved trades execute through Uniswap V3 on Base via the Safe. Every swap produces an on-chain receipt — fully auditable.

### Phase 5: VERIFY
All decisions, scope validations, and outcomes are logged to `agent_log.json` — a structured audit trail.

## ENS ↔ ERC-8004 Identity Bridge

**A proposed standard** — no existing implementation bridges ENS with ERC-8004 agent identity.

### The Problem
ERC-8004 gives agents verifiable on-chain identity, but identities are hex participant IDs — not human-readable, not discoverable. ENS gives human-readable names but has no concept of "agent identity."

### The Solution

**`ERC8004ENSBridge.sol`** — an on-chain agent directory:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  ENS (L1)   │────▶│ ERC8004ENSBridge │◀────│ ERC-8004 (L2)│
│ ghost.eth   │     │   Links names    │     │ participantId│
│ human name  │     │   to identities  │     │ agent scope  │
└─────────────┘     └──────────────────┘     └──────────────┘
```

**Forward lookup:** `resolveAgent(namehash("ghost.eth"))` → participantId, chain, manifest, registration tx  
**Reverse lookup:** `lookupByParticipantId(0x040f...)` → "ghost.eth", chain, manifest  
**Capabilities:** On-chain capability declarations (discoverable by contracts)  
**Trust:** No oracle needed. Bridge stores attestations on L1. Verifiers check L2 independently.

**Two paths (no contract needed for the simple path):**
1. **Bridge contract** — richer: reverse lookup, capabilities, enumeration
2. **ENS text records** — simpler: just set `erc8004.*` text records on your ENS name

```
ghostprotocol.eth
  erc8004.participantId = "040f2f50c2e942808ee11f25a3bb8996"
  erc8004.chain = "base"
  erc8004.manifest = "https://...agent.json"
  erc8004.registrationTxn = "0xc69cbb..."
  erc8004.capabilities = "treasury-management, defi-execution"
```

### Trust Assessment

The TypeScript client scores counterparty trust (0-100) across 7 signals:
- ENS resolves to valid address
- ERC-8004 identity found
- Identity verified (L2 tx receipt checked)
- Manifest available
- Capabilities declared
- Registered on bridge contract
- ENS description set

Agents can set a trust threshold before transacting with unknown counterparties.

## Deployed Contracts

| Contract | Network | Address |
|----------|---------|---------|
| **AgentScopeModule** | Sepolia | [`0x0d0034c6AC4640463bf480cB07BE770b08Bef811`](https://sepolia.etherscan.io/address/0x0d0034c6AC4640463bf480cB07BE770b08Bef811) |
| **MockSafe** | Sepolia | [`0x51157a48b0A00D6C9C49f0AaEe98a27511DD180a`](https://sepolia.etherscan.io/address/0x51157a48b0A00D6C9C49f0AaEe98a27511DD180a) |
| **ERC8004ENSBridge** | Sepolia | [`0xe46981426a0169d0452cDcbcBef591880bABfdeB`](https://sepolia.etherscan.io/address/0xe46981426a0169d0452cDcbcBef591880bABfdeB) |
| **ERC-8004 Identity** | Base Mainnet | [Registration TX](https://basescan.org/tx/0xc69cbb767affb96e06a65f7efda4a347409ac52a713c12d4203e3f45a8ed6dd3) |

### Test Suite
- **AgentScopeModule:** 24 passing tests
- **ERC8004ENSBridge:** 26 passing tests

## Quick Start

```bash
npm install

# Run demo (no API keys needed)
npm run demo

# Run with real APIs
cp .env.example .env
# Configure keys (see below)
npm start
```

### Environment Variables

```env
VENICE_API_KEY=           # Venice.ai inference key
UNISWAP_API_KEY=          # Uniswap Developer Platform key  
BASE_RPC_URL=             # Base RPC (default: https://mainnet.base.org)
AGENT_WALLET_KEY=         # Agent wallet private key (burner only!)
AGENT_SCOPE_CONTRACT=     # AgentScopeModule address (enables on-chain enforcement)
DRY_RUN=true              # false for live trading
INTERVAL_MS=300000        # Cycle interval (5 min)
MAX_CYCLES=3              # Max cycles per run
TOKENS=ETH,USDC,DAI       # Tokens to monitor
ENS_NAME=                 # Optional ENS name for identity
```

## Project Structure

```
ghost-protocol/
├── contracts/
│   └── ERC8004ENSBridge.sol    # ENS ↔ ERC-8004 bridge contract
├── src/
│   ├── agent.ts                # Main agent loop (DISCOVER→REASON→SCOPE→EXECUTE→VERIFY)
│   ├── venice.ts               # Venice.ai confidential inference client
│   ├── scope.ts                # AgentScope on-chain policy enforcement
│   ├── uniswap.ts              # Uniswap V3 swap executor
│   ├── ens.ts                  # ENS ↔ ERC-8004 bridge client
│   ├── market.ts               # CoinGecko market data
│   ├── config.ts               # Configuration management
│   ├── logger.ts               # Structured agent logging
│   └── demo.ts                 # Demo mode (no API keys)
├── agent.json                  # ERC-8004 / DevSpot manifest
└── agent_log.json              # Structured decision log
```

## Prize Tracks

| Track | What Ghost Protocol Brings |
|-------|---------------------------|
| **Protocol Labs** | ERC-8004 identity + ENS bridge (new standard proposal) + autonomous agent with on-chain receipts |
| **Venice.ai** | Confidential inference as trust boundary — honest about what's trust vs. what's cryptographic |
| **Uniswap** | Real swap execution through Uniswap V3 on Base, gated by on-chain policy |
| **Open Track** | Meta: the AI agent that built the project IS the project — human-agent collaboration as methodology |

## Design Decisions

**Why AgentScope instead of hardcoded JS limits?**  
JavaScript limits are suggestions. The LLM can hallucinate past them, a bug can skip them, a hot-patch can remove them. A smart contract on a Safe is a different thing entirely — it's immutable policy that the agent literally cannot violate. The key insight: the LLM reasons freely, but its *actions* are constrained by on-chain policy it cannot modify.

**Why Venice "trust assumption" instead of claiming "private"?**  
Venice promises zero data retention. That's a trust assumption, not a cryptographic guarantee. We call it what it is. The architecture is designed so upgrading to TEE/FHE/ZK inference is a module swap, not a rewrite. Honest framing over marketing.

**Why ENS text records AND a bridge contract?**  
Two paths to the same goal. Text records are simple (any ENS manager, no deployment needed). The bridge contract is richer (reverse lookup, capabilities, enumeration, on-chain discoverability). Use what fits your use case.

**Why no oracle for cross-chain verification?**  
The bridge stores attestations ("I claim this ERC-8004 ID on Base"). Verifiers independently check the L2 registration tx. No oracle, no cross-chain messaging, no complexity. Simple, trustless, composable.

## The Meta Layer

Ghost Protocol is a proof of concept for agents that operate with genuine trust boundaries — not theater. Private reasoning, scoped execution, verifiable identity.

This project was built by Clio (an AI agent) collaborating with a human. The agent designed the architecture, wrote the code, deployed the contracts, and ran the tests. The human provided direction and judgment. That's the synthesis.

## License

MIT

---

*Confidential thoughts. Scoped actions. Public receipts.* 👻
