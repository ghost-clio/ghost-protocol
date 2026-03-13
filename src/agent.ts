/**
 * Ghost Protocol — Main Agent Loop
 * 
 * The autonomous decision loop:
 *   DISCOVER → REASON → DECIDE → EXECUTE → VERIFY
 * 
 * - DISCOVER: Fetch market data from public APIs
 * - REASON: Analyze privately via Venice.ai (no data retention)
 * - DECIDE: Apply safety guardrails and risk limits
 * - EXECUTE: Swap via Uniswap on Base (real TxIDs)
 * - VERIFY: Log everything to agent_log.json
 * 
 * Built by Clio 🌀 — the first ghost to enter a hackathon.
 */

import { AgentLog } from './logger.js';
import { VeniceReasoner } from './venice.js';
import { UniswapExecutor } from './uniswap.js';
import { MarketDataProvider } from './market.js';

interface AgentConfig {
  dryRun: boolean;
  intervalMs: number;
  maxCycles: number;
  tokens: string[];
}

const DEFAULT_CONFIG: AgentConfig = {
  dryRun: process.env.DRY_RUN !== 'false',
  intervalMs: 60_000 * 5, // 5 minutes between cycles
  maxCycles: 12,          // 1 hour of operation
  tokens: ['ETH', 'USDC', 'DAI'],
};

export class GhostProtocolAgent {
  private logger: AgentLog;
  private reasoner: VeniceReasoner;
  private executor: UniswapExecutor;
  private market: MarketDataProvider;
  private config: AgentConfig;
  private cycleCount: number = 0;
  private running: boolean = false;

  constructor(config?: Partial<AgentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new AgentLog(process.cwd());
    this.reasoner = new VeniceReasoner(this.logger);
    this.executor = new UniswapExecutor(this.logger);
    this.market = new MarketDataProvider(this.logger);
  }

  /**
   * Run one full cycle of the agent loop.
   * DISCOVER → REASON → DECIDE → EXECUTE → VERIFY
   */
  async runCycle(): Promise<void> {
    this.cycleCount++;
    const cycleStart = Date.now();

    this.logger.logDecision('cycle-start', {
      cycle: this.cycleCount,
      maxCycles: this.config.maxCycles,
      dryRun: this.config.dryRun,
      timestamp: new Date().toISOString(),
    });

    console.log(`\n🌀 Ghost Protocol — Cycle ${this.cycleCount}/${this.config.maxCycles}`);
    console.log(`   Mode: ${this.config.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);

    try {
      // ═══════════════════════════════════════════
      // PHASE 1: DISCOVER — Fetch market data
      // ═══════════════════════════════════════════
      console.log('\n   📡 Phase 1: DISCOVER — Fetching market data...');
      const marketData = await this.market.getMarketData(this.config.tokens);

      if (marketData.length === 0) {
        console.log('   ⚠️  No market data available. Skipping cycle.');
        this.logger.logDecision('cycle-skip-no-data', { cycle: this.cycleCount });
        return;
      }

      for (const token of marketData) {
        console.log(`   📊 ${token.symbol}: $${token.price.toFixed(2)} (${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%)`);
      }

      // ═══════════════════════════════════════════
      // PHASE 2: REASON — Private analysis via Venice
      // ═══════════════════════════════════════════
      console.log('\n   🔒 Phase 2: REASON — Private analysis via Venice.ai...');
      console.log('   (Zero data retention — reasoning is confidential)');
      
      const decision = await this.reasoner.analyzeMarket(marketData);
      
      console.log(`   💭 Decision: ${decision.action.toUpperCase()} ${decision.token}`);
      console.log(`   📈 Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
      console.log(`   ⚠️  Risk Score: ${(decision.riskScore * 100).toFixed(1)}%`);
      console.log(`   📝 Reasoning: ${decision.reasoning}`);

      // ═══════════════════════════════════════════
      // PHASE 3: DECIDE — Apply safety guardrails
      // ═══════════════════════════════════════════
      console.log('\n   🛡️  Phase 3: DECIDE — Safety guardrails...');
      
      const walletBalance = this.config.dryRun ? 100 : 
        parseFloat((await this.executor.getBalance()).eth) * (marketData.find(t => t.symbol === 'ETH')?.price || 0);
      
      const validation = await this.reasoner.validateTrade(decision, walletBalance);
      
      if (!validation.approved) {
        console.log(`   ❌ Trade REJECTED: ${validation.reason}`);
        this.logger.logSafetyCheck('trade-rejected', {
          cycle: this.cycleCount,
          decision: decision.action,
          token: decision.token,
          reason: validation.reason,
        });
        return;
      }

      console.log(`   ✅ Trade APPROVED: ${validation.reason}`);

      // ═══════════════════════════════════════════
      // PHASE 4: EXECUTE — Swap via Uniswap
      // ═══════════════════════════════════════════
      if (decision.action === 'hold') {
        console.log('\n   ⏸️  Phase 4: HOLD — No execution needed.');
        this.logger.logDecision('hold', {
          cycle: this.cycleCount,
          reasoning: decision.reasoning,
        });
        return;
      }

      console.log(`\n   ⚡ Phase 4: EXECUTE — ${decision.action.toUpperCase()} via Uniswap...`);

      if (this.config.dryRun) {
        console.log('   🧪 DRY RUN — Swap simulated (no real transaction)');
        this.logger.logExecution('swap-dry-run', {
          success: true,
          action: decision.action,
          token: decision.token,
          amount: decision.amount,
          confidence: decision.confidence,
          dryRun: true,
          valueUsd: 0,
        });
      } else {
        // Real execution
        const tokenIn = decision.action === 'sell' ? decision.token : 'USDC';
        const tokenOut = decision.action === 'sell' ? 'USDC' : decision.token;
        const amount = decision.amount || 10; // Default $10

        const result = await this.executor.executeSwap(tokenIn, tokenOut, amount);

        if (result.success) {
          console.log(`   ✅ Swap executed! TxHash: ${result.txHash}`);
          console.log(`   🔗 https://basescan.org/tx/${result.txHash}`);
        } else {
          console.log(`   ❌ Swap failed: ${result.error}`);
        }
      }

      // ═══════════════════════════════════════════
      // PHASE 5: VERIFY — Log and confirm
      // ═══════════════════════════════════════════
      console.log('\n   📋 Phase 5: VERIFY — Logging to agent_log.json...');
      
      this.logger.logVerification('cycle-complete', {
        cycle: this.cycleCount,
        durationMs: Date.now() - cycleStart,
        decision: {
          action: decision.action,
          token: decision.token,
          confidence: decision.confidence,
          riskScore: decision.riskScore,
        },
        veniceCallsThisCycle: this.reasoner.getCallCount(),
        swapCountToday: this.executor.getDailySwapCount(),
      });

      const summary = this.logger.getSummary();
      console.log(`   📊 Running totals: ${summary.totalDecisions} decisions, ${summary.totalTradesExecuted} trades, $${summary.totalValueMovedUsd.toFixed(2)} moved`);

    } catch (error: any) {
      console.error(`   💥 Cycle ${this.cycleCount} error: ${error.message}`);
      this.logger.logError('cycle-error', error, { cycle: this.cycleCount });
    }
  }

  /**
   * Start the autonomous agent loop.
   */
  async start(): Promise<void> {
    this.running = true;

    console.log('╔══════════════════════════════════════════╗');
    console.log('║        🌀 GHOST PROTOCOL v1.0.0         ║');
    console.log('║   Private Reasoning · Public Execution   ║');
    console.log('║                                          ║');
    console.log('║   Built by Clio — ghost in the machine   ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
    console.log(`Mode: ${this.config.dryRun ? '🧪 DRY RUN' : '🔴 LIVE EXECUTION'}`);
    console.log(`Wallet: ${this.executor.getWalletAddress() || 'Not configured'}`);
    console.log(`Tokens: ${this.config.tokens.join(', ')}`);
    console.log(`Interval: ${this.config.intervalMs / 1000}s`);
    console.log(`Max cycles: ${this.config.maxCycles}`);
    console.log('');

    this.logger.logDecision('agent-start', {
      config: this.config,
      wallet: this.executor.getWalletAddress(),
      timestamp: new Date().toISOString(),
    });

    // Run cycles
    while (this.running && this.cycleCount < this.config.maxCycles) {
      await this.runCycle();

      if (this.cycleCount < this.config.maxCycles && this.running) {
        console.log(`\n   ⏳ Next cycle in ${this.config.intervalMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, this.config.intervalMs));
      }
    }

    console.log('\n🌀 Ghost Protocol shutting down.');
    console.log(`   Total cycles: ${this.cycleCount}`);
    console.log(`   Summary: ${JSON.stringify(this.logger.getSummary(), null, 2)}`);

    this.logger.logDecision('agent-stop', {
      totalCycles: this.cycleCount,
      summary: this.logger.getSummary(),
    });
  }

  stop(): void {
    this.running = false;
  }
}

// Run if called directly
const agent = new GhostProtocolAgent({
  dryRun: process.env.DRY_RUN !== 'false',
  intervalMs: parseInt(process.env.INTERVAL_MS || '300000'),
  maxCycles: parseInt(process.env.MAX_CYCLES || '3'),
  tokens: (process.env.TOKENS || 'ETH,USDC,DAI').split(','),
});

agent.start().catch(console.error);
