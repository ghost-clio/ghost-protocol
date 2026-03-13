/**
 * Uniswap Swap Executor
 * 
 * Executes real token swaps on Base via the Uniswap Developer Platform API.
 * Every swap produces a real TxID verifiable on BaseScan.
 */

import { ethers } from 'ethers';
import { AgentLog } from './logger.js';

interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  route: string[];
  gasEstimate: string;
}

interface SwapResult {
  success: boolean;
  txHash?: string;
  amountIn?: string;
  amountOut?: string;
  gasUsed?: string;
  error?: string;
}

// Base chain token addresses
const BASE_TOKENS: Record<string, string> = {
  ETH: '0x0000000000000000000000000000000000000000',
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
};

// Uniswap Universal Router on Base
const UNIVERSAL_ROUTER = '0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC';

export class UniswapExecutor {
  private logger: AgentLog;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;
  private apiKey: string;
  private dailySwapCount: number = 0;
  private readonly MAX_SWAPS_PER_DAY = 10;
  private readonly MAX_SLIPPAGE_BPS = 100; // 1%

  constructor(logger: AgentLog) {
    this.logger = logger;
    this.apiKey = process.env.UNISWAP_API_KEY || '';
    
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    const privateKey = process.env.AGENT_WALLET_KEY;
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
  }

  /**
   * Get a swap quote from Uniswap API
   */
  async getQuote(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountInUsd: number
  ): Promise<SwapQuote | null> {
    const tokenIn = BASE_TOKENS[tokenInSymbol];
    const tokenOut = BASE_TOKENS[tokenOutSymbol];

    if (!tokenIn || !tokenOut) {
      this.logger.logError('uniswap-quote', `Unknown token: ${tokenInSymbol} or ${tokenOutSymbol}`);
      return null;
    }

    const startTime = Date.now();

    try {
      // Use Uniswap's API for quoting
      const response = await fetch('https://api.uniswap.org/v2/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          tokenInChainId: 8453, // Base
          tokenOutChainId: 8453,
          tokenIn,
          tokenOut,
          amount: ethers.parseUnits(amountInUsd.toString(), tokenInSymbol === 'USDC' ? 6 : 18).toString(),
          type: 'EXACT_INPUT',
          configs: [{
            routingType: 'CLASSIC',
            protocols: ['V3', 'V2'],
          }],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Uniswap API error ${response.status}: ${errText}`);
      }

      const data = await response.json() as any;
      const quote = data.quote;

      const result: SwapQuote = {
        tokenIn: tokenInSymbol,
        tokenOut: tokenOutSymbol,
        amountIn: quote?.amountIn || '0',
        amountOut: quote?.amountOut || '0',
        priceImpact: parseFloat(quote?.priceImpact || '0'),
        route: quote?.route?.map((r: any) => r.address) || [],
        gasEstimate: quote?.gasEstimate || '0',
      };

      this.logger.logToolCall('uniswap-quote', {
        tokenIn: tokenInSymbol,
        tokenOut: tokenOutSymbol,
        amountInUsd,
        quote: {
          amountOut: result.amountOut,
          priceImpact: result.priceImpact,
          gasEstimate: result.gasEstimate,
        },
      }, Date.now() - startTime);

      return result;
    } catch (error: any) {
      this.logger.logToolCall('uniswap-quote', {
        error: error.message,
        tokenIn: tokenInSymbol,
        tokenOut: tokenOutSymbol,
      }, Date.now() - startTime);
      return null;
    }
  }

  /**
   * Execute a swap on-chain via Uniswap.
   * Includes all safety checks before execution.
   */
  async executeSwap(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountInUsd: number
  ): Promise<SwapResult> {
    // Safety check: daily limit
    if (this.dailySwapCount >= this.MAX_SWAPS_PER_DAY) {
      const msg = `Daily swap limit reached: ${this.dailySwapCount}/${this.MAX_SWAPS_PER_DAY}`;
      this.logger.logSafetyCheck('swap-daily-limit', { 
        count: this.dailySwapCount, 
        limit: this.MAX_SWAPS_PER_DAY,
        blocked: true,
      });
      return { success: false, error: msg };
    }

    // Safety check: amount limit
    if (amountInUsd > 50) {
      const msg = `Amount $${amountInUsd} exceeds $50 per-trade limit`;
      this.logger.logSafetyCheck('swap-amount-limit', {
        amount: amountInUsd,
        limit: 50,
        blocked: true,
      });
      return { success: false, error: msg };
    }

    // Safety check: wallet available
    if (!this.wallet) {
      this.logger.logSafetyCheck('swap-no-wallet', { blocked: true });
      return { success: false, error: 'No wallet configured (AGENT_WALLET_KEY not set)' };
    }

    // Get quote first
    const quote = await this.getQuote(tokenInSymbol, tokenOutSymbol, amountInUsd);
    if (!quote) {
      return { success: false, error: 'Failed to get quote' };
    }

    // Safety check: slippage / price impact
    if (Math.abs(quote.priceImpact) > this.MAX_SLIPPAGE_BPS / 100) {
      const msg = `Price impact ${quote.priceImpact}% exceeds ${this.MAX_SLIPPAGE_BPS / 100}% limit`;
      this.logger.logSafetyCheck('swap-slippage', {
        priceImpact: quote.priceImpact,
        limit: this.MAX_SLIPPAGE_BPS / 100,
        blocked: true,
      });
      return { success: false, error: msg };
    }

    // Execute the swap
    const startTime = Date.now();
    try {
      // For the hackathon demo, we use Uniswap's swap API
      // which returns calldata we can submit directly
      const swapResponse = await fetch('https://api.uniswap.org/v2/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          quote: quote,
          tokenInChainId: 8453,
          tokenOutChainId: 8453,
          slippageTolerance: this.MAX_SLIPPAGE_BPS / 10000,
          deadline: Math.floor(Date.now() / 1000) + 300, // 5 min
        }),
      });

      if (!swapResponse.ok) {
        throw new Error(`Swap API error: ${await swapResponse.text()}`);
      }

      const swapData = await swapResponse.json() as any;
      
      // Submit the transaction
      const tx = await this.wallet.sendTransaction({
        to: swapData.to || UNIVERSAL_ROUTER,
        data: swapData.calldata,
        value: swapData.value || '0',
        gasLimit: swapData.gasEstimate ? BigInt(swapData.gasEstimate) * 120n / 100n : undefined,
      });

      const receipt = await tx.wait();
      const elapsed = Date.now() - startTime;

      this.dailySwapCount++;

      const result: SwapResult = {
        success: true,
        txHash: receipt?.hash,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        gasUsed: receipt?.gasUsed?.toString(),
      };

      this.logger.logExecution('swap-executed', {
        success: true,
        txHash: result.txHash,
        tokenIn: tokenInSymbol,
        tokenOut: tokenOutSymbol,
        amountInUsd,
        amountOut: result.amountOut,
        gasUsed: result.gasUsed,
        latencyMs: elapsed,
        explorerUrl: `https://basescan.org/tx/${result.txHash}`,
        valueUsd: amountInUsd,
      });

      return result;
    } catch (error: any) {
      this.logger.logExecution('swap-failed', {
        success: false,
        error: error.message,
        tokenIn: tokenInSymbol,
        tokenOut: tokenOutSymbol,
        amountInUsd,
        latencyMs: Date.now() - startTime,
        valueUsd: 0,
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get wallet balance on Base
   */
  async getBalance(): Promise<{ eth: string; usdcBalance?: string }> {
    if (!this.wallet) {
      return { eth: '0' };
    }

    try {
      const ethBalance = await this.provider.getBalance(this.wallet.address);
      
      // Check USDC balance
      const usdcContract = new ethers.Contract(
        BASE_TOKENS.USDC,
        ['function balanceOf(address) view returns (uint256)'],
        this.provider
      );
      const usdcBalance = await usdcContract.balanceOf(this.wallet.address);

      return {
        eth: ethers.formatEther(ethBalance),
        usdcBalance: ethers.formatUnits(usdcBalance, 6),
      };
    } catch (error: any) {
      this.logger.logError('balance-check', error);
      return { eth: '0' };
    }
  }

  getWalletAddress(): string | null {
    return this.wallet?.address || null;
  }

  getDailySwapCount(): number {
    return this.dailySwapCount;
  }
}
