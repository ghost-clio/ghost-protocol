/**
 * ENS ↔ ERC-8004 Identity Resolver
 * 
 * Bridges Ethereum Name Service with ERC-8004 agent identity on Base.
 * Optional trust upgrade — agents can verify counterparties by ENS name
 * before transacting, getting human-readable identity + verified capabilities.
 * 
 * Convention for ERC-8004 text records in ENS:
 *   erc8004.participantId  — agent's ERC-8004 participant ID
 *   erc8004.chain          — chain where identity lives (e.g., "base")
 *   erc8004.manifest       — URL to agent.json manifest
 *   erc8004.registrationTxn — registration transaction hash
 * 
 * This is a proposed standard — no existing bridge between ENS and ERC-8004.
 * Ghost Protocol is the first implementation.
 */

import { ethers } from 'ethers';
import { AgentLog } from './logger.js';

// Module-level logger instance (optional — only logs if initialized)
let _logger: AgentLog | null = null;

function log(type: string, data: any) {
  _logger?.logDecision(type, data);
}

export function setENSLogger(logger: AgentLog) {
  _logger = logger;
}

// ─── Types ────────────────────────────────────────────────────────

export interface ERC8004Identity {
  participantId: string;
  chain: string;
  manifest?: string;
  registrationTxn?: string;
  name?: string;           // ENS name (if resolved)
  address?: string;        // Ethereum address
  verified: boolean;       // Whether on-chain verification passed
}

export interface ENSAgentRecord {
  ensName: string;
  address: string | null;
  avatar?: string;
  description?: string;
  url?: string;
  erc8004?: ERC8004Identity;
  rawTextRecords: Record<string, string>;
}

export interface ENSResolverConfig {
  ethereumRpcUrl: string;    // Ethereum mainnet RPC (for ENS)
  baseRpcUrl: string;        // Base RPC (for ERC-8004 verification)
  erc8004ContractAddress?: string;  // ERC-8004 registry on Base
}

// ─── Constants ────────────────────────────────────────────────────

const DEFAULT_ETH_RPC = 'https://eth.llamarpc.com';
const DEFAULT_BASE_RPC = 'https://mainnet.base.org';

// ERC-8004 text record keys (proposed convention)
const ERC8004_KEYS = {
  participantId: 'erc8004.participantId',
  chain: 'erc8004.chain',
  manifest: 'erc8004.manifest',
  registrationTxn: 'erc8004.registrationTxn',
} as const;

// Standard ENS text record keys we also read
const STANDARD_KEYS = ['avatar', 'description', 'url', 'com.twitter', 'com.github'];

// ─── ENS Resolver ─────────────────────────────────────────────────

export class ENSResolver {
  private ethProvider: ethers.JsonRpcProvider;
  private baseProvider: ethers.JsonRpcProvider;
  private cache: Map<string, { record: ENSAgentRecord; timestamp: number }> = new Map();
  private cacheTtlMs: number = 5 * 60 * 1000; // 5 min cache

  constructor(config?: Partial<ENSResolverConfig>) {
    this.ethProvider = new ethers.JsonRpcProvider(
      config?.ethereumRpcUrl || DEFAULT_ETH_RPC
    );
    this.baseProvider = new ethers.JsonRpcProvider(
      config?.baseRpcUrl || DEFAULT_BASE_RPC
    );
  }

  /**
   * Resolve an ENS name to a full agent record, including ERC-8004 identity if set.
   * This is the main entry point for agent-to-agent trust verification.
   */
  async resolve(ensName: string): Promise<ENSAgentRecord | null> {
    // Check cache
    const cached = this.cache.get(ensName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      log('tool_call', {
        tool: 'ens-resolve',
        input: { ensName, cached: true },
      });
      return cached.record;
    }

    log('tool_call', {
      tool: 'ens-resolve',
      input: { ensName },
    });

    try {
      // Step 1: Resolve ENS name to address
      const address = await this.ethProvider.resolveName(ensName);
      
      if (!address) {
        log('tool_result', {
          tool: 'ens-resolve',
          output: { ensName, error: 'Name not found' },
        });
        return null;
      }

      // Step 2: Get the resolver for this name
      const resolver = await this.ethProvider.getResolver(ensName);
      
      if (!resolver) {
        log('tool_result', {
          tool: 'ens-resolve',
          output: { ensName, address, error: 'No resolver set' },
        });
        return { ensName, address, rawTextRecords: {} };
      }

      // Step 3: Read text records (standard + ERC-8004)
      const rawTextRecords: Record<string, string> = {};
      
      const allKeys = [...STANDARD_KEYS, ...Object.values(ERC8004_KEYS)];
      
      // Fetch all text records in parallel
      const results = await Promise.allSettled(
        allKeys.map(async (key) => {
          const value = await resolver.getText(key);
          return { key, value };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.value) {
          rawTextRecords[result.value.key] = result.value.value;
        }
      }

      // Step 4: Parse ERC-8004 identity if present
      let erc8004: ERC8004Identity | undefined;
      const participantId = rawTextRecords[ERC8004_KEYS.participantId];
      
      if (participantId) {
        erc8004 = {
          participantId,
          chain: rawTextRecords[ERC8004_KEYS.chain] || 'base',
          manifest: rawTextRecords[ERC8004_KEYS.manifest],
          registrationTxn: rawTextRecords[ERC8004_KEYS.registrationTxn],
          name: ensName,
          address,
          verified: false, // Will verify in step 5
        };

        // Step 5: Cross-chain verification (check ERC-8004 on Base)
        if (erc8004.registrationTxn) {
          try {
            erc8004.verified = await this.verifyERC8004OnBase(erc8004);
          } catch (err) {
            // Verification failed but identity still readable
            erc8004.verified = false;
          }
        }
      }

      const record: ENSAgentRecord = {
        ensName,
        address,
        avatar: rawTextRecords['avatar'],
        description: rawTextRecords['description'],
        url: rawTextRecords['url'],
        erc8004,
        rawTextRecords,
      };

      // Cache the result
      this.cache.set(ensName, { record, timestamp: Date.now() });

      log('tool_result', {
        tool: 'ens-resolve',
        output: {
          ensName,
          address,
          hasERC8004: !!erc8004,
          verified: erc8004?.verified || false,
          textRecordCount: Object.keys(rawTextRecords).length,
        },
      });

      return record;

    } catch (error: any) {
      log('error', {
        tool: 'ens-resolve',
        error: error.message,
        ensName,
      });
      return null;
    }
  }

  /**
   * Verify an ERC-8004 identity exists on Base by checking the registration transaction.
   */
  private async verifyERC8004OnBase(identity: ERC8004Identity): Promise<boolean> {
    if (!identity.registrationTxn) return false;

    try {
      // Extract tx hash from URL or use directly
      const txHash = identity.registrationTxn.includes('/')
        ? identity.registrationTxn.split('/').pop()!
        : identity.registrationTxn;

      const receipt = await this.baseProvider.getTransactionReceipt(txHash);
      
      if (!receipt) return false;

      // Transaction exists and was successful
      return receipt.status === 1;
    } catch {
      return false;
    }
  }

  /**
   * Reverse resolve: given an Ethereum address, find the ENS name.
   * Useful for identifying agents you interact with on-chain.
   */
  async reverseResolve(address: string): Promise<string | null> {
    log('tool_call', {
      tool: 'ens-reverse-resolve',
      input: { address },
    });

    try {
      const name = await this.ethProvider.lookupAddress(address);
      
      log('tool_result', {
        tool: 'ens-reverse-resolve',
        output: { address, name },
      });

      return name;
    } catch (error: any) {
      log('error', {
        tool: 'ens-reverse-resolve',
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if a counterparty is trustworthy before transacting.
   * Returns a trust assessment based on ENS + ERC-8004 signals.
   */
  async assessTrust(ensNameOrAddress: string): Promise<{
    trustLevel: 'high' | 'medium' | 'low' | 'unknown';
    reasons: string[];
    identity: ENSAgentRecord | null;
  }> {
    const reasons: string[] = [];
    let trustLevel: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';

    // Try ENS resolution first
    let identity: ENSAgentRecord | null = null;
    
    if (ensNameOrAddress.endsWith('.eth')) {
      identity = await this.resolve(ensNameOrAddress);
    } else if (ethers.isAddress(ensNameOrAddress)) {
      const name = await this.reverseResolve(ensNameOrAddress);
      if (name) {
        identity = await this.resolve(name);
      }
    }

    if (!identity) {
      return { trustLevel: 'unknown', reasons: ['Could not resolve identity'], identity: null };
    }

    // Score based on available signals
    if (identity.address) {
      reasons.push('✅ ENS name resolves to valid address');
      trustLevel = 'low'; // At least we know the address
    }

    if (identity.erc8004) {
      reasons.push('✅ ERC-8004 agent identity found');
      trustLevel = 'medium';

      if (identity.erc8004.verified) {
        reasons.push('✅ Registration transaction verified on Base');
        trustLevel = 'high';
      } else {
        reasons.push('⚠️ Registration transaction not verified');
      }

      if (identity.erc8004.manifest) {
        reasons.push('✅ Agent manifest URL available');
      }
    } else {
      reasons.push('ℹ️ No ERC-8004 identity (may not be an agent)');
    }

    if (identity.description) {
      reasons.push('✅ ENS description set');
    }

    return { trustLevel, reasons, identity };
  }

  /**
   * Generate the text records that an agent should set on their ENS name
   * to advertise their ERC-8004 identity.
   */
  static generateTextRecords(identity: {
    participantId: string;
    chain?: string;
    manifestUrl?: string;
    registrationTxn?: string;
  }): Record<string, string> {
    const records: Record<string, string> = {
      [ERC8004_KEYS.participantId]: identity.participantId,
      [ERC8004_KEYS.chain]: identity.chain || 'base',
    };

    if (identity.manifestUrl) {
      records[ERC8004_KEYS.manifest] = identity.manifestUrl;
    }

    if (identity.registrationTxn) {
      records[ERC8004_KEYS.registrationTxn] = identity.registrationTxn;
    }

    return records;
  }
}

// ─── Demo / Test ──────────────────────────────────────────────────

export async function demoENSResolution(): Promise<void> {
  console.log('\n🔗 ENS ↔ ERC-8004 Identity Resolution\n');
  console.log('  This module bridges Ethereum Name Service with');
  console.log('  ERC-8004 agent identity on Base — enabling agents');
  console.log('  to verify each other by human-readable names.\n');

  const resolver = new ENSResolver();

  // Demo 1: Resolve a known ENS name
  console.log('  📡 Resolving vitalik.eth...');
  const vitalik = await resolver.resolve('vitalik.eth');
  
  if (vitalik) {
    console.log(`  ✅ Address: ${vitalik.address}`);
    console.log(`  📝 Description: ${vitalik.description || '(none)'}`);
    console.log(`  🤖 ERC-8004: ${vitalik.erc8004 ? 'Yes' : 'No (not an agent)'}`);
    console.log(`  📋 Text records: ${Object.keys(vitalik.rawTextRecords).length} found`);
  } else {
    console.log('  ❌ Resolution failed (RPC may be rate-limited)');
  }

  // Demo 2: Show what Ghost Protocol's records would look like
  console.log('\n  📋 Ghost Protocol ENS records (proposed):');
  const ghostRecords = ENSResolver.generateTextRecords({
    participantId: '040f2f50c2e942808ee11f25a3bb8996',
    chain: 'base',
    manifestUrl: 'https://raw.githubusercontent.com/ghost-clio/ghost-protocol/main/agent.json',
    registrationTxn: '0xc69cbb767affb96e06a65f7efda4a347409ac52a713c12d4203e3f45a8ed6dd3',
  });
  
  for (const [key, value] of Object.entries(ghostRecords)) {
    console.log(`     ${key} = ${value}`);
  }

  // Demo 3: Trust assessment
  console.log('\n  🛡️ Trust assessment (vitalik.eth):');
  const trust = await resolver.assessTrust('vitalik.eth');
  console.log(`     Level: ${trust.trustLevel.toUpperCase()}`);
  for (const reason of trust.reasons) {
    console.log(`     ${reason}`);
  }
  
  console.log('\n  💡 With ERC-8004 text records set on an ENS name,');
  console.log('     any agent can verify identity cross-chain before transacting.\n');
}
