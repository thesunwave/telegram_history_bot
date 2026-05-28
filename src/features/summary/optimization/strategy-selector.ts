/**
 * Strategy selection logic for optimized summarization
 */

import {
  ProcessingStrategySelector,
  ProcessingStrategy,
  SummaryOptimizationConfig,
} from "./types";
import { Logger } from "../../../core/logger";
import { Env } from "../../../core/env";
import { TelegramMessage } from '../../../core/providers/ai-provider';
import { ContextOptimizer } from "./context-optimizer";

export class OptimizedStrategySelector implements ProcessingStrategySelector {
  private contextOptimizer: ContextOptimizer;

  constructor(
    private config: SummaryOptimizationConfig,
    private env: Env,
  ) {
    this.contextOptimizer = new ContextOptimizer(config);
  }

  /**
   * Determines if parallel processing should be used based on message count
   */
  shouldUseParallelProcessing(estimatedMessageCount: number): boolean {
    if (!this.config.parallelProcessing.enabled) {
      return false;
    }

    const shouldUse =
      estimatedMessageCount >=
      this.config.parallelProcessing.minMessagesThreshold;

    Logger.debug(this.env, "Strategy selector: parallel processing decision", {
      estimatedMessageCount,
      threshold: this.config.parallelProcessing.minMessagesThreshold,
      shouldUse,
      enabled: this.config.parallelProcessing.enabled,
    });

    return shouldUse;
  }

  /**
   * Determines if hierarchical processing should be used based on token count
   */
  shouldUseHierarchicalProcessing(tokenCount: number): boolean {
    if (!this.config.hierarchicalProcessing.enabled) {
      return false;
    }

    const shouldUse =
      tokenCount > this.config.hierarchicalProcessing.chunkSizeThreshold;

    Logger.debug(
      this.env,
      "Strategy selector: hierarchical processing decision",
      {
        tokenCount,
        threshold: this.config.hierarchicalProcessing.chunkSizeThreshold,
        shouldUse,
        enabled: this.config.hierarchicalProcessing.enabled,
      },
    );

    return shouldUse;
  }

  /**
   * Estimates token count for messages using the context optimizer
   */
  estimateTokens(messages: TelegramMessage[]): number {
    return this.contextOptimizer.estimateTokens(messages);
  }

  /**
   * Calculates optimal number of workers based on message count
   */
  getOptimalWorkerCount(messageCount: number): number {
    const maxWorkers = this.config.parallelProcessing.maxWorkers;
    const batchSize = this.config.parallelProcessing.workerBatchSize;

    // Calculate ideal worker count based on message distribution
    const idealWorkers = Math.ceil(messageCount / batchSize);

    // Cap at maximum configured workers
    const optimalWorkers = Math.min(idealWorkers, maxWorkers);

    // Ensure at least 1 worker
    const finalWorkerCount = Math.max(1, optimalWorkers);

    Logger.debug(
      this.env,
      "Strategy selector: optimal worker count calculation",
      {
        messageCount,
        batchSize,
        maxWorkers,
        idealWorkers,
        finalWorkerCount,
      },
    );

    return finalWorkerCount;
  }

  /**
   * Selects the appropriate processing strategy based on message count and estimated tokens
   */
  selectStrategy(
    messageCount: number,
    estimatedTokens: number,
  ): ProcessingStrategy {
    Logger.debug(this.env, "Strategy selector: selecting processing strategy", {
      messageCount,
      estimatedTokens,
      config: {
        parallelEnabled: this.config.parallelProcessing.enabled,
        hierarchicalEnabled: this.config.hierarchicalProcessing.enabled,
        parallelThreshold: this.config.parallelProcessing.minMessagesThreshold,
        hierarchicalThreshold:
          this.config.hierarchicalProcessing.chunkSizeThreshold,
      },
    });

    // Decision tree for strategy selection
    const useParallel = this.shouldUseParallelProcessing(messageCount);
    const useHierarchical =
      this.shouldUseHierarchicalProcessing(estimatedTokens);

    let strategy: ProcessingStrategy;

    if (useHierarchical) {
      // Large context requires hierarchical processing
      strategy = "hierarchical";
    } else if (useParallel) {
      // Medium volume benefits from parallel processing
      strategy = "parallel";
    } else {
      // Small volume can use direct processing
      strategy = "direct";
    }

    Logger.debug(this.env, "Strategy selector: strategy selected", {
      strategy,
      reasons: {
        useParallel,
        useHierarchical,
        messageCount,
        estimatedTokens,
      },
    });

    return strategy;
  }

  /**
   * Provides detailed reasoning for strategy selection (useful for debugging)
   */
  explainStrategySelection(
    messageCount: number,
    estimatedTokens: number,
  ): {
    strategy: ProcessingStrategy;
    reasoning: string[];
    metrics: {
      messageCount: number;
      estimatedTokens: number;
      optimalWorkers: number;
      parallelThreshold: number;
      hierarchicalThreshold: number;
    };
  } {
    const strategy = this.selectStrategy(messageCount, estimatedTokens);
    const reasoning: string[] = [];

    // Build reasoning
    if (!this.config.parallelProcessing.enabled) {
      reasoning.push("Parallel processing is disabled in configuration");
    }

    if (!this.config.hierarchicalProcessing.enabled) {
      reasoning.push("Hierarchical processing is disabled in configuration");
    }

    if (
      estimatedTokens > this.config.hierarchicalProcessing.chunkSizeThreshold
    ) {
      reasoning.push(
        `Token count (${estimatedTokens}) exceeds hierarchical threshold (${this.config.hierarchicalProcessing.chunkSizeThreshold})`,
      );
    }

    if (messageCount >= this.config.parallelProcessing.minMessagesThreshold) {
      reasoning.push(
        `Message count (${messageCount}) meets parallel processing threshold (${this.config.parallelProcessing.minMessagesThreshold})`,
      );
    } else {
      reasoning.push(
        `Message count (${messageCount}) below parallel processing threshold (${this.config.parallelProcessing.minMessagesThreshold})`,
      );
    }

    reasoning.push(`Selected strategy: ${strategy}`);

    return {
      strategy,
      reasoning,
      metrics: {
        messageCount,
        estimatedTokens,
        optimalWorkers: this.getOptimalWorkerCount(messageCount),
        parallelThreshold: this.config.parallelProcessing.minMessagesThreshold,
        hierarchicalThreshold:
          this.config.hierarchicalProcessing.chunkSizeThreshold,
      },
    };
  }
}
