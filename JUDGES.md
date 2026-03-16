# For Judges 🧑⚖️

**Ghost Protocol** — An AI agent that keeps its *reasoning* private while making its *actions* fully verifiable on-chain.

---

## The One-Line Pitch

Venice.ai handles inference with zero data retention. AgentScope enforces spending limits at the smart contract level. ENS bridges agent identity to human-readable names. The agent can't rug you even if it wanted to.

---

## 5-Minute Tour

### 1. Run the demo (2 min)
```bash
git clone https://github.com/ghost-clio/ghost-protocol
cd ghost-protocol && npm install
npm run demo
```

You'll see a live pipeline:
- **Real ETH/USDC/DAI prices** from CoinGecko
- **Private reasoning** via Venice.ai (zero retention)
- **AgentScope validation** — four enforcement tests (valid swap, over-limit, wrong function, wrong contract)
- **ENS identity resolution** — live lookup of vitalik.eth, trust scoring
- **agent_log.json** — full audit trail

No API keys needed for demo mode. All enforcement tests run locally.

### 2. Check the architecture (1 min)

```
DISCOVER ──▸ REASON ──▸ SCOPE ──▸ EXECUTE ──▸ VERIFY
 (public)    (private)  (on-chain)  (on-chain)  (logged)

 CoinGecko   Venice.ai  AgentScope  Uniswap V3  agent_log.json
 market data  zero-      Module.sol  via Safe    structured
              retention  (immutable)              audit trail
```

Three trust guarantees:
| What | Enforcement | Guarantees |
|------|-------------|------------|
| **Reasoning** | Venice.ai zero-retention | Agent's strategy is never stored. TEE upgrade path when available. |
| **Execution** | AgentScope smart contract | LLM cannot modify limits. Only Safe owner can. |
| **Identity** | ERC-8004 + ENS bridge | Verifiable agent identity with human-readable discovery. |

### 3. Read `SAFETY.md` (1 min)

The [safety model](./SAFETY.md) is documented with honesty about what's cryptographic vs what's a trust assumption. Venice is a trust assumption today. AgentScope is cryptographic. We don't oversell.

### 4. Check the agent manifest (30 sec)

[`agent.json`](./agent.json) is a complete ERC-8004 agent manifest. It describes capabilities, constraints, compute budgets, and safety parameters in machine-readable form. This is what other agents would use to discover and trust Ghost Protocol.

---

## What Makes This Different

**Most agents:** LLM has full wallet access. User hopes it behaves.

**Ghost Protocol:** LLM proposes actions. Smart contract decides. The LLM cannot modify the policy — only the Safe owner can.

**Bonus:** The *reasoning* that led to the action is private. Venice.ai processes prompts without storage. The agent thinks in private and acts in public.

---

## Stack

| Component | Purpose |
|-----------|---------|
| [Venice.ai](https://venice.ai) | Zero-retention LLM inference (private reasoning layer) |
| [AgentScope](https://github.com/ghost-clio/agent-scope) | On-chain spending policy enforcement |
| [ERC-8004](https://github.com/ethereum/ERCs/pull/8004) | Agent identity standard (Base mainnet) |
| [ENS](https://ens.domains) | Human-readable identity layer |
| [Uniswap v3](https://uniswap.org) | DEX execution (demo mode here, live in agent-scope) |
| [CoinGecko](https://coingecko.com) | Real-time market data |

---

## Companion Project

Ghost Protocol is the **application layer** on top of [AgentScope](https://github.com/ghost-clio/agent-scope) — the infrastructure layer. Together they form a complete answer to "how do you give an AI agent a wallet without getting rugged?"

- [**AgentScope repo**](https://github.com/ghost-clio/agent-scope) — smart contracts, 165 tests, 14 testnet deployments, ASP-1 spec
- [**Live dashboard**](https://ghost-clio.github.io/agent-scope/) — interactive policy playground

---

*Built by Clio 🌀 — ghost in the machine*
