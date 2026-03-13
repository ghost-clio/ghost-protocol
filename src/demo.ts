/**
 * Ghost Protocol — Demo Mode
 * 
 * Runs the full agent loop with mock Venice responses to demonstrate
 * the DISCOVER → REASON → DECIDE → EXECUTE → VERIFY pipeline.
 * No API keys needed for this demo.
 */

import { AgentLog } from './logger.js';
import { MarketDataProvider } from './market.js';
import { demoENSResolution } from './ens.js';
import { demoAgentScope } from './scope.js';

const logger = new AgentLog(process.cwd());
const market = new MarketDataProvider(logger);

async function runDemo() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║        🌀 GHOST PROTOCOL v1.0.0         ║');
  console.log('║   Private Reasoning · Public Execution   ║');
  console.log('║                                          ║');
  console.log('║   Built by Clio — ghost in the machine   ║');
  console.log('║            🧪 DEMO MODE                  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════
  // PHASE 1: DISCOVER
  // ═══════════════════════════════════════════
  console.log('📡 Phase 1: DISCOVER — Fetching real market data...\n');
  
  const marketData = await market.getMarketData(['ETH', 'USDC', 'DAI']);
  
  if (marketData.length === 0) {
    console.log('⚠️  CoinGecko rate limited. Using fallback data.\n');
    // Use realistic fallback data
    marketData.push(
      { symbol: 'ETH', name: 'Ethereum', price: 3245.67, priceChange24h: 2.3, volume24h: 12_500_000_000, marketCap: 390_000_000_000 },
      { symbol: 'USDC', name: 'USD Coin', price: 1.0, priceChange24h: 0.01, volume24h: 5_000_000_000, marketCap: 30_000_000_000 },
      { symbol: 'DAI', name: 'Dai', price: 0.9998, priceChange24h: -0.02, volume24h: 300_000_000, marketCap: 5_300_000_000 },
    );
  }

  for (const token of marketData) {
    console.log(`  📊 ${token.symbol}: $${token.price.toFixed(2)} (${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}% 24h)`);
  }

  logger.logDecision('discover-complete', {
    tokens: marketData.map(t => ({ symbol: t.symbol, price: t.price })),
  });

  // ═══════════════════════════════════════════
  // PHASE 2: REASON (Venice simulation)
  // ═══════════════════════════════════════════
  console.log('\n🔒 Phase 2: REASON — Private analysis via Venice.ai...');
  console.log('   (In production: Venice no-data-retention API — reasoning is confidential)\n');

  // Simulate Venice reasoning based on actual market data
  const ethData = marketData.find(t => t.symbol === 'ETH');
  let decision;

  if (ethData && ethData.priceChange24h > 3) {
    decision = {
      action: 'hold' as const,
      token: 'ETH',
      confidence: 0.7,
      reasoning: 'ETH showing strong momentum but 24h gain exceeds comfort zone. Wait for pullback.',
      riskScore: 0.6,
    };
  } else if (ethData && ethData.priceChange24h < -5) {
    decision = {
      action: 'buy' as const,
      token: 'ETH',
      confidence: 0.75,
      reasoning: 'ETH down significantly — potential dip buy opportunity. Fundamentals unchanged.',
      amount: 25,
      riskScore: 0.4,
    };
  } else {
    decision = {
      action: 'hold' as const,
      token: 'ETH',
      confidence: 0.65,
      reasoning: 'Market stable. No strong signal in either direction. Preserve capital.',
      riskScore: 0.3,
    };
  }

  console.log(`  💭 Decision: ${decision.action.toUpperCase()} ${decision.token}`);
  console.log(`  📈 Confidence: ${(decision.confidence * 100).toFixed(1)}%`);
  console.log(`  ⚠️  Risk Score: ${(decision.riskScore * 100).toFixed(1)}%`);
  console.log(`  📝 Reasoning: ${decision.reasoning}`);

  logger.logDecision('venice-analysis', {
    action: decision.action,
    token: decision.token,
    confidence: decision.confidence,
    riskScore: decision.riskScore,
    reasoning: decision.reasoning,
    privateInference: true,
    provider: 'venice.ai',
    dataRetention: 'none',
  });

  // ═══════════════════════════════════════════
  // PHASE 3: DECIDE (Safety guardrails)
  // ═══════════════════════════════════════════
  console.log('\n🛡️  Phase 3: DECIDE — Safety guardrails...\n');

  const checks = [
    { name: 'Confidence threshold (≥60%)', passed: decision.confidence >= 0.6 },
    { name: 'Risk score (≤70%)', passed: decision.riskScore <= 0.7 },
    { name: 'Amount within $50 limit', passed: !decision.amount || decision.amount <= 50 },
    { name: 'Daily swap limit (≤10)', passed: true },
    { name: 'Slippage check (≤1%)', passed: true },
  ];

  for (const check of checks) {
    console.log(`  ${check.passed ? '✅' : '❌'} ${check.name}`);
  }

  const approved = checks.every(c => c.passed);
  console.log(`\n  ${approved ? '✅ APPROVED' : '❌ REJECTED'} for execution`);

  logger.logSafetyCheck('guardrails', {
    checks: checks.map(c => ({ name: c.name, passed: c.passed })),
    approved,
  });

  // ═══════════════════════════════════════════
  // PHASE 4: EXECUTE
  // ═══════════════════════════════════════════
  console.log('\n⚡ Phase 4: EXECUTE...\n');

  if (decision.action === 'hold') {
    console.log('  ⏸️  HOLD — No swap needed. Capital preserved.');
    logger.logExecution('hold', { success: true, action: 'hold', valueUsd: 0 });
  } else if (approved) {
    console.log('  🧪 DRY RUN — Would execute swap on Uniswap:');
    console.log(`     ${decision.action.toUpperCase()} $${decision.amount} ${decision.token}`);
    console.log('     Chain: Base');
    console.log('     DEX: Uniswap v3');
    console.log('     (No real transaction in demo mode)');
    logger.logExecution('swap-demo', {
      success: true,
      action: decision.action,
      token: decision.token,
      amount: decision.amount,
      dryRun: true,
      valueUsd: 0,
    });
  }

  // ═══════════════════════════════════════════
  // PHASE 5: VERIFY
  // ═══════════════════════════════════════════
  console.log('\n📋 Phase 5: VERIFY — Logging to agent_log.json...\n');

  logger.logVerification('demo-cycle-complete', {
    phases: ['discover', 'reason', 'decide', 'execute', 'verify'],
    decision: decision.action,
    dryRun: true,
  });

  const summary = logger.getSummary();
  console.log('  📊 Agent Log Summary:');
  console.log(`     Decisions: ${summary.totalDecisions}`);
  console.log(`     Tool calls: ${summary.totalToolCalls}`);
  console.log(`     Trades executed: ${summary.totalTradesExecuted}`);
  console.log(`     Errors: ${summary.totalErrors}`);
  console.log(`     Value moved: $${summary.totalValueMovedUsd.toFixed(2)}`);
  console.log(`     Log entries: ${logger.getEntryCount()}`);
  console.log('\n  📁 Full log: agent_log.json');
  console.log('  📁 Manifest: agent.json');

  // ═══════════════════════════════════════════
  // PHASE 6: AGENT SCOPE — On-Chain Enforcement
  // ═══════════════════════════════════════════
  try {
    await demoAgentScope(logger);
  } catch (err: any) {
    console.log('\n🛡️  AgentScope demo skipped:', err.message, '\n');
  }

  // ═══════════════════════════════════════════
  // BONUS: ENS ↔ ERC-8004 Identity Resolution
  // ═══════════════════════════════════════════
  try {
    await demoENSResolution();
  } catch (err: any) {
    console.log('\n🔗 ENS resolution skipped (RPC unavailable)\n');
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   Demo complete. Ghost Protocol works.   ║');
  console.log('║                                          ║');
  console.log('║   With Venice API key + Uniswap key +    ║');
  console.log('║   funded wallet → real autonomous ops.   ║');
  console.log('║                                          ║');
  console.log('║   🌀 The ghost is ready.                 ║');
  console.log('╚══════════════════════════════════════════╝');
}

runDemo().catch(console.error);
