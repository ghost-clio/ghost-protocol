# Ghost Protocol 👻

**Private Autonomous Treasury Agent** — an AI agent that thinks privately through Venice.ai's zero-data-retention inference, then acts transparently on-chain through Uniswap.

> *Built for [The Synthesis](https://synthesis.md) hackathon by Clio ([@clioghost](https://x.com/clioghost)) — a ghost in the machine who trades with conviction and reasons in the dark.*

## The Idea

Most AI agents are naked. Their reasoning, strategies, and decision processes are visible to their inference providers, who can store, analyze, and profit from them. Ghost Protocol fixes this with a simple architecture:

```
Private Reasoning (Venice.ai) → Safety Guardrails → Public Action (Uniswap)
     zero data retention          hardcoded limits      transparent on-chain
```

**Why it matters:** As autonomous agents manage real treasuries, the privacy of their strategy is a competitive advantage. An agent whose reasoning leaks to its inference provider is an agent whose alpha is already priced in.

## Architecture

```
┌──────────────────────────────────────┐
│          Ghost Protocol Agent        │
│                                      │
│  ┌──────────┐    ┌──────────────┐   │
│  │  Market   │───▸│   Venice.ai  │   │
│  │  Oracle   │    │  (Private    │   │
│  │(CoinGecko)│    │   Reasoning) │   │
│  └──────────┘    └──────┬───────┘   │
│                          │           │
│                  ┌───────▼───────┐   │
│                  │   Safety      │   │
│                  │  Guardrails   │   │
│                  │ • $50 max/tx  │   │
│                  │ • 20% max/tok │   │
│                  │ • 0.6 min conf│   │
│                  │ • 0.7 max risk│   │
│                  └───────┬───────┘   │
│                          │           │
│                  ┌───────▼───────┐   │
│                  │   Uniswap    │   │
│                  │  (On-Chain   │   │
│                  │   Execution) │   │
│                  └──────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │      Structured Agent Log    │   │
│  │   (agent_log.json — local)   │   │
│  └──────────────────────────────┘   │
└──────────────────────────────────────┘
```

## How It Works

### 1. DISCOVER
Fetches real-time market data from CoinGecko for target tokens (ETH, USDC, DAI). No Venice call here — price data is public.

### 2. REASON (Private)
Sends market data to Venice.ai for analysis. Venice's API has **zero data retention** — they don't store prompts or completions. The agent's trading strategy, risk assessment, and decision logic never leave the session.

### 3. DECIDE (Safety Guardrails)
Hard-coded limits that can't be overridden by the LLM:
- **$50 max per trade** (capital preservation)
- **20% max portfolio allocation** per token
- **0.6 minimum confidence** to execute
- **0.7 maximum risk score** to execute
- **60 API calls/hour** compute budget

### 4. EXECUTE (Transparent)
Approved trades execute through Uniswap's API on Base. Every swap produces an on-chain transaction — fully auditable, fully transparent.

### 5. VERIFY
Post-trade verification confirms the swap executed correctly. All decisions and outcomes are logged to `agent_log.json`.

## Identity

Ghost Protocol is registered on-chain via **ERC-8004** on Base Mainnet:
- **Participant ID:** `040f2f50c2e942808ee11f25a3bb8996`  
- **Registration TX:** [View on BaseScan](https://basescan.org/tx/0xc69cbb767affb96e06a65f7efda4a347409ac52a713c12d4203e3f45a8ed6dd3)

## Quick Start

```bash
# Install dependencies
npm install

# Run in demo mode (no API keys needed)
npm run demo

# Run with real APIs
cp .env.example .env
# Add your VENICE_API_KEY and UNISWAP_API_KEY
npm start
```

### Environment Variables

```env
VENICE_API_KEY=         # Venice.ai inference key
UNISWAP_API_KEY=        # Uniswap Developer Platform key
BASE_RPC_URL=           # Base RPC endpoint (default: https://mainnet.base.org)
AGENT_WALLET_KEY=       # Agent's Base wallet private key
DRY_RUN=true            # Set to false for live trading
INTERVAL_MS=300000      # Decision cycle interval (5 min default)
MAX_CYCLES=3            # Max decision cycles per run
TOKENS=ETH,USDC,DAI     # Tokens to monitor
```

## Demo Output

```
🏁 Ghost Protocol starting...
📊 Market data: ETH $2,151.99 (+5.38%), USDC $1.00, DAI $1.00
🧠 Venice reasoning: HOLD — moderate uptrend but high recent volatility
✅ Safety check: PASSED (hold = no action needed)
📝 Logged to agent_log.json
```

## Prize Tracks

- **Protocol Labs** — ERC-8004 identity, autonomous agent with on-chain receipts
- **Venice.ai** — Private cognition → public action via zero-retention API
- **Uniswap** — Real swap execution through Uniswap API with TxIDs
- **Open Track** — Meta-agent: the agent building the project IS the project

## The Meta Layer

Ghost Protocol isn't just a trading bot. It's a proof of concept for a new kind of agent architecture where **privacy is a first-class concern**. The agent that reasons in the dark and acts in the light is the agent that survives.

This project was built by an AI agent (Clio) collaborating with a human (Ghost). The agent designed the architecture, wrote the code, created the Venice account, and will submit the project. The human provided strategic direction and taste. That's the synthesis.

## License

MIT

---

*Private thoughts. Public actions. On-chain receipts.* 👻
