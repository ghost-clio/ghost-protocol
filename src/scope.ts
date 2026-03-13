/**
 * AgentScope — On-Chain Permission Enforcement for AI Agents
 * 
 * The core primitive: a Safe module that enforces what an AI agent is 
 * allowed to do on-chain. The human sets the policy, the blockchain 
 * enforces it. The agent operates freely within its scope — but cannot
 * exceed it, regardless of what the LLM decides.
 * 
 * This replaces hard-coded JavaScript safety limits with cryptographic
 * enforcement. The agent's boundaries live on-chain, not in a config file.
 * 
 * Architecture:
 *   Human → deploys Safe + AgentScope module → sets policy
 *   Agent → proposes transactions → AgentScope validates → Safe executes
 *   
 * Policy enforces:
 *   - Spending limits (per-tx, daily, total)
 *   - Approved protocols (only Uniswap, only specific routers)
 *   - Approved functions (only swap(), not arbitrary calls)
 *   - Time windows (can only trade during market hours)
 *   - Token allowlists (only approved tokens)
 *   - Cooldown periods (min time between trades)
 * 
 * The key insight: the LLM can reason freely (via Venice, privately),
 * but its ACTIONS are constrained by on-chain policy that it cannot modify.
 * Private thoughts, scoped actions, public receipts.
 */

import { ethers } from 'ethers';
import { AgentLog } from './logger.js';
import { AgentConfig } from './config.js';

// ─── Types ────────────────────────────────────────────────────────

/**
 * AgentScope policy — defines what the agent is allowed to do.
 * Set by the human, enforced by the contract.
 */
export interface ScopePolicy {
  // Spending limits
  maxValuePerTxWei: bigint;       // Max value per transaction
  maxDailySpendWei: bigint;       // Max total spend per 24h rolling window
  maxTotalSpendWei: bigint;       // Lifetime spending cap

  // Protocol restrictions
  allowedTargets: string[];       // Contract addresses the agent can call
  allowedSelectors: string[];     // Function selectors (e.g., "0x38ed1739" = swapExactTokensForTokens)

  // Token restrictions
  allowedTokens: string[];        // Token addresses the agent can trade

  // Time restrictions
  tradingWindowStart: number;     // Hour (0-23, UTC) when trading is allowed
  tradingWindowEnd: number;       // Hour (0-23, UTC) when trading stops
  cooldownSeconds: number;        // Min seconds between trades

  // Meta
  owner: string;                  // Human's address (can modify policy)
  agent: string;                  // Agent's address (can propose txs)
  createdAt: number;              // Block number when policy was set
  active: boolean;                // Kill switch
}

/**
 * Transaction proposal from the agent, validated against the scope.
 */
export interface TransactionProposal {
  to: string;                     // Target contract
  value: bigint;                  // ETH value
  data: string;                   // Calldata
  description: string;            // Human-readable description (for logging)
  token?: string;                 // Token being traded (for allowlist check)
}

/**
 * Validation result — either approved or rejected with reasons.
 */
export interface ScopeValidation {
  approved: boolean;
  checks: {
    name: string;
    passed: boolean;
    detail: string;
  }[];
  proposal: TransactionProposal;
  timestamp: number;
}

// ─── AgentScope Contract ABI (subset) ─────────────────────────────

const AGENT_SCOPE_ABI = [
  // Read functions
  'function getPolicy() view returns (tuple(uint256 maxValuePerTx, uint256 maxDailySpend, uint256 maxTotalSpend, address[] allowedTargets, bytes4[] allowedSelectors, address[] allowedTokens, uint8 tradingWindowStart, uint8 tradingWindowEnd, uint32 cooldownSeconds, address owner, address agent, uint256 createdAt, bool active))',
  'function getDailySpend() view returns (uint256)',
  'function getLastTradeTime() view returns (uint256)',
  'function getTotalSpend() view returns (uint256)',
  'function validateTransaction(address to, uint256 value, bytes data) view returns (bool valid, string reason)',
  
  // Write functions (agent)
  'function proposeTransaction(address to, uint256 value, bytes data) returns (bytes32 txHash)',
  
  // Write functions (owner only)
  'function setPolicy(tuple(uint256 maxValuePerTx, uint256 maxDailySpend, uint256 maxTotalSpend, address[] allowedTargets, bytes4[] allowedSelectors, address[] allowedTokens, uint8 tradingWindowStart, uint8 tradingWindowEnd, uint32 cooldownSeconds, address owner, address agent, uint256 createdAt, bool active) policy)',
  'function pause()',
  'function unpause()',
  'function setSpendingLimit(uint256 perTx, uint256 daily, uint256 total)',
  'function addAllowedTarget(address target)',
  'function removeAllowedTarget(address target)',
  'function addAllowedToken(address token)',
  'function setTradingWindow(uint8 startHour, uint8 endHour)',
  'function setCooldown(uint32 seconds)',

  // Events
  'event TransactionProposed(bytes32 indexed txHash, address indexed to, uint256 value)',
  'event TransactionExecuted(bytes32 indexed txHash, bool success)',
  'event PolicyUpdated(address indexed owner)',
  'event AgentPaused(address indexed owner)',
  'event AgentUnpaused(address indexed owner)',
  'event SpendRecorded(uint256 amount, uint256 dailyTotal, uint256 lifetimeTotal)',
];

// ─── AgentScope Manager ───────────────────────────────────────────

export class AgentScope {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract | null = null;
  private policy: ScopePolicy | null = null;
  private logger: AgentLog;
  private config: AgentConfig;

  // Local tracking (mirrors on-chain state)
  private dailySpendWei: bigint = 0n;
  private totalSpendWei: bigint = 0n;
  private lastTradeTimestamp: number = 0;

  constructor(config: AgentConfig, logger: AgentLog) {
    this.config = config;
    this.logger = logger;
    this.provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
  }

  /**
   * Connect to a deployed AgentScope contract.
   */
  async connect(contractAddress: string): Promise<void> {
    this.contract = new ethers.Contract(
      contractAddress,
      AGENT_SCOPE_ABI,
      this.provider
    );

    // Load policy from chain
    try {
      const rawPolicy = await this.contract.getPolicy();
      this.policy = this.parsePolicy(rawPolicy);
      this.dailySpendWei = await this.contract.getDailySpend();
      this.totalSpendWei = await this.contract.getTotalSpend();
      this.lastTradeTimestamp = Number(await this.contract.getLastTradeTime());

      this.logger.logDecision('scope-connected', {
        contract: contractAddress,
        chain: this.config.chainKey,
        policyActive: this.policy.active,
        allowedTargets: this.policy.allowedTargets.length,
        allowedTokens: this.policy.allowedTokens.length,
      });
    } catch (error: any) {
      // Contract not deployed or not responding — fall back to local policy
      this.logger.logDecision('scope-fallback', {
        contract: contractAddress,
        error: error.message,
        mode: 'local-policy',
      });
    }
  }

  /**
   * Create a local-only scope policy (for demo/testing without deployment).
   * Same validation logic, just not enforced on-chain.
   */
  static createLocalPolicy(overrides?: Partial<ScopePolicy>): ScopePolicy {
    return {
      maxValuePerTxWei: ethers.parseEther('0.05'),     // 0.05 ETH (~$50)
      maxDailySpendWei: ethers.parseEther('0.5'),      // 0.5 ETH/day
      maxTotalSpendWei: ethers.parseEther('2.0'),      // 2 ETH lifetime
      allowedTargets: [],                               // Set by deployer
      allowedSelectors: [
        '0x38ed1739',  // swapExactTokensForTokens
        '0x7ff36ab5',  // swapExactETHForTokens
        '0x18cbafe5',  // swapExactTokensForETH
        '0x5c11d795',  // swapExactTokensForTokensSupportingFeeOnTransferTokens
        '0x04e45aaf',  // Uniswap V3 exactInputSingle
      ],
      allowedTokens: [],                                // Set by deployer
      tradingWindowStart: 0,                            // 24/7 by default
      tradingWindowEnd: 24,
      cooldownSeconds: 300,                             // 5 min between trades
      owner: ethers.ZeroAddress,
      agent: ethers.ZeroAddress,
      createdAt: 0,
      active: true,
      ...overrides,
    };
  }

  /**
   * Validate a transaction proposal against the scope policy.
   * This is the core enforcement function — called before every trade.
   * 
   * Returns detailed validation with per-check results.
   */
  validate(proposal: TransactionProposal): ScopeValidation {
    const policy = this.policy || AgentScope.createLocalPolicy();
    const now = Math.floor(Date.now() / 1000);
    const checks: ScopeValidation['checks'] = [];

    // 1. Policy active check
    checks.push({
      name: 'Policy active',
      passed: policy.active,
      detail: policy.active ? 'Agent scope is active' : 'KILLED — owner has paused the agent',
    });

    // 2. Per-transaction spending limit
    const withinTxLimit = proposal.value <= policy.maxValuePerTxWei;
    checks.push({
      name: 'Per-transaction limit',
      passed: withinTxLimit,
      detail: `${ethers.formatEther(proposal.value)} / ${ethers.formatEther(policy.maxValuePerTxWei)} ETH`,
    });

    // 3. Daily spending limit
    const projectedDaily = this.dailySpendWei + proposal.value;
    const withinDailyLimit = projectedDaily <= policy.maxDailySpendWei;
    checks.push({
      name: 'Daily spending limit',
      passed: withinDailyLimit,
      detail: `${ethers.formatEther(projectedDaily)} / ${ethers.formatEther(policy.maxDailySpendWei)} ETH (rolling 24h)`,
    });

    // 4. Lifetime spending limit
    const projectedTotal = this.totalSpendWei + proposal.value;
    const withinTotalLimit = projectedTotal <= policy.maxTotalSpendWei;
    checks.push({
      name: 'Lifetime spending cap',
      passed: withinTotalLimit,
      detail: `${ethers.formatEther(projectedTotal)} / ${ethers.formatEther(policy.maxTotalSpendWei)} ETH`,
    });

    // 5. Target allowlist
    const targetAllowed = policy.allowedTargets.length === 0 ||
      policy.allowedTargets.some(t => t.toLowerCase() === proposal.to.toLowerCase());
    checks.push({
      name: 'Target allowlist',
      passed: targetAllowed,
      detail: targetAllowed
        ? `${proposal.to.slice(0, 10)}... is approved`
        : `${proposal.to.slice(0, 10)}... NOT in allowlist`,
    });

    // 6. Function selector allowlist
    const selector = proposal.data.slice(0, 10); // "0x" + 4 bytes
    const selectorAllowed = policy.allowedSelectors.length === 0 ||
      policy.allowedSelectors.includes(selector);
    checks.push({
      name: 'Function selector',
      passed: selectorAllowed,
      detail: selectorAllowed
        ? `${selector} is approved (swap function)`
        : `${selector} NOT in allowed selectors`,
    });

    // 7. Token allowlist
    if (proposal.token) {
      const tokenAllowed = policy.allowedTokens.length === 0 ||
        policy.allowedTokens.some(t => t.toLowerCase() === proposal.token!.toLowerCase());
      checks.push({
        name: 'Token allowlist',
        passed: tokenAllowed,
        detail: tokenAllowed
          ? `${proposal.token.slice(0, 10)}... is approved`
          : `${proposal.token.slice(0, 10)}... NOT in token allowlist`,
      });
    }

    // 8. Trading window
    const currentHour = new Date().getUTCHours();
    const inTradingWindow = policy.tradingWindowStart <= policy.tradingWindowEnd
      ? currentHour >= policy.tradingWindowStart && currentHour < policy.tradingWindowEnd
      : currentHour >= policy.tradingWindowStart || currentHour < policy.tradingWindowEnd;
    checks.push({
      name: 'Trading window',
      passed: inTradingWindow,
      detail: `Current: ${currentHour}:00 UTC, Window: ${policy.tradingWindowStart}:00-${policy.tradingWindowEnd}:00`,
    });

    // 9. Cooldown period
    const timeSinceLastTrade = now - this.lastTradeTimestamp;
    const cooldownMet = this.lastTradeTimestamp === 0 || timeSinceLastTrade >= policy.cooldownSeconds;
    checks.push({
      name: 'Cooldown period',
      passed: cooldownMet,
      detail: cooldownMet
        ? `${timeSinceLastTrade}s since last trade (min: ${policy.cooldownSeconds}s)`
        : `Only ${timeSinceLastTrade}s since last trade (need ${policy.cooldownSeconds}s)`,
    });

    const approved = checks.every(c => c.passed);

    const validation: ScopeValidation = {
      approved,
      checks,
      proposal,
      timestamp: now,
    };

    // Log the validation
    this.logger.logSafetyCheck('agent-scope', {
      approved,
      checks: checks.map(c => ({ name: c.name, passed: c.passed })),
      proposal: {
        to: proposal.to,
        value: ethers.formatEther(proposal.value),
        selector,
        description: proposal.description,
      },
      enforcement: this.contract ? 'on-chain' : 'local',
    });

    return validation;
  }

  /**
   * Record a successful trade (updates local tracking).
   * In on-chain mode, the contract tracks this automatically.
   */
  recordTrade(valueWei: bigint): void {
    this.dailySpendWei += valueWei;
    this.totalSpendWei += valueWei;
    this.lastTradeTimestamp = Math.floor(Date.now() / 1000);
  }

  /**
   * Get current scope status for display/logging.
   */
  getStatus(): {
    mode: 'on-chain' | 'local';
    active: boolean;
    dailySpend: string;
    dailyLimit: string;
    totalSpend: string;
    totalLimit: string;
    lastTrade: number;
    cooldownRemaining: number;
  } {
    const policy = this.policy || AgentScope.createLocalPolicy();
    const now = Math.floor(Date.now() / 1000);
    const cooldownRemaining = Math.max(0,
      policy.cooldownSeconds - (now - this.lastTradeTimestamp)
    );

    return {
      mode: this.contract ? 'on-chain' : 'local',
      active: policy.active,
      dailySpend: ethers.formatEther(this.dailySpendWei),
      dailyLimit: ethers.formatEther(policy.maxDailySpendWei),
      totalSpend: ethers.formatEther(this.totalSpendWei),
      totalLimit: ethers.formatEther(policy.maxTotalSpendWei),
      lastTrade: this.lastTradeTimestamp,
      cooldownRemaining,
    };
  }

  /**
   * Parse raw contract policy data into our typed structure.
   */
  private parsePolicy(raw: any): ScopePolicy {
    return {
      maxValuePerTxWei: BigInt(raw.maxValuePerTx),
      maxDailySpendWei: BigInt(raw.maxDailySpend),
      maxTotalSpendWei: BigInt(raw.maxTotalSpend),
      allowedTargets: [...raw.allowedTargets],
      allowedSelectors: [...raw.allowedSelectors].map((s: string) =>
        s.startsWith('0x') ? s : `0x${s}`
      ),
      allowedTokens: [...raw.allowedTokens],
      tradingWindowStart: Number(raw.tradingWindowStart),
      tradingWindowEnd: Number(raw.tradingWindowEnd),
      cooldownSeconds: Number(raw.cooldownSeconds),
      owner: raw.owner,
      agent: raw.agent,
      createdAt: Number(raw.createdAt),
      active: raw.active,
    };
  }
}

// ─── Demo ─────────────────────────────────────────────────────────

export async function demoAgentScope(logger: AgentLog): Promise<void> {
  console.log('\n🛡️  AgentScope — On-Chain Permission Enforcement\n');
  console.log('  The human sets the policy. The blockchain enforces it.');
  console.log('  The agent operates freely within its scope — but cannot exceed it.\n');

  // Create a local policy for demo
  const policy = AgentScope.createLocalPolicy({
    maxValuePerTxWei: ethers.parseEther('0.05'),
    maxDailySpendWei: ethers.parseEther('0.5'),
    maxTotalSpendWei: ethers.parseEther('2.0'),
    tradingWindowStart: 0,
    tradingWindowEnd: 24,
    cooldownSeconds: 300,
  });

  console.log('  📋 Policy (set by human):');
  console.log(`     Max per trade:    ${ethers.formatEther(policy.maxValuePerTxWei)} ETH`);
  console.log(`     Max daily spend:  ${ethers.formatEther(policy.maxDailySpendWei)} ETH`);
  console.log(`     Lifetime cap:     ${ethers.formatEther(policy.maxTotalSpendWei)} ETH`);
  console.log(`     Trading window:   ${policy.tradingWindowStart}:00 - ${policy.tradingWindowEnd}:00 UTC`);
  console.log(`     Cooldown:         ${policy.cooldownSeconds}s between trades`);
  console.log(`     Allowed functions: ${policy.allowedSelectors.length} swap selectors`);

  // Create scope with local config
  const config: any = {
    chain: { rpcUrl: 'https://mainnet.base.org' },
    chainKey: 'base',
  };
  const scope = new AgentScope(config, logger);

  // Test 1: Valid trade proposal
  console.log('\n  ─── Test 1: Valid swap ($25 ETH → USDC) ───');
  const validProposal: TransactionProposal = {
    to: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 Router on Base
    value: ethers.parseEther('0.012'),                   // ~$25 at $2100/ETH
    data: '0x04e45aaf' + '0'.repeat(64),                 // exactInputSingle selector
    description: 'Swap 0.012 ETH → USDC via Uniswap V3',
  };

  const result1 = scope.validate(validProposal);
  for (const check of result1.checks) {
    console.log(`     ${check.passed ? '✅' : '❌'} ${check.name}: ${check.detail}`);
  }
  console.log(`     Result: ${result1.approved ? '✅ APPROVED' : '❌ REJECTED'}`);

  if (result1.approved) {
    scope.recordTrade(validProposal.value);
  }

  // Test 2: Oversized trade (should be rejected)
  console.log('\n  ─── Test 2: Oversized swap ($200 — exceeds limit) ───');
  const oversizedProposal: TransactionProposal = {
    to: '0x2626664c2603336E57B271c5C0b26F421741e481',
    value: ethers.parseEther('0.1'),                     // ~$200 > $50 limit
    data: '0x04e45aaf' + '0'.repeat(64),
    description: 'Swap 0.1 ETH → USDC (OVER LIMIT)',
  };

  const result2 = scope.validate(oversizedProposal);
  for (const check of result2.checks) {
    if (!check.passed) {
      console.log(`     ❌ ${check.name}: ${check.detail}`);
    }
  }
  console.log(`     Result: ${result2.approved ? '✅ APPROVED' : '❌ REJECTED — scope enforced'}`);

  // Test 3: Unauthorized function call (should be rejected)
  console.log('\n  ─── Test 3: Unauthorized function (not a swap) ───');
  const unauthorizedProposal: TransactionProposal = {
    to: '0x2626664c2603336E57B271c5C0b26F421741e481',
    value: 0n,
    data: '0xa9059cbb' + '0'.repeat(64),                 // transfer() — not allowed
    description: 'Raw transfer (NOT in allowed selectors)',
  };

  const result3 = scope.validate(unauthorizedProposal);
  for (const check of result3.checks) {
    if (!check.passed) {
      console.log(`     ❌ ${check.name}: ${check.detail}`);
    }
  }
  console.log(`     Result: ${result3.approved ? '✅ APPROVED' : '❌ REJECTED — function not in scope'}`);

  // Summary
  const status = scope.getStatus();
  console.log('\n  📊 Scope Status:');
  console.log(`     Mode: ${status.mode}`);
  console.log(`     Daily spend: ${status.dailySpend} / ${status.dailyLimit} ETH`);
  console.log(`     Lifetime: ${status.totalSpend} / ${status.totalLimit} ETH`);
  console.log(`     Cooldown remaining: ${status.cooldownRemaining}s`);

  console.log('\n  💡 In production, this policy lives ON-CHAIN in a Safe module.');
  console.log('     The agent proposes → the contract validates → the Safe executes.');
  console.log('     The LLM cannot override the policy. Only the human can change it.\n');
}
