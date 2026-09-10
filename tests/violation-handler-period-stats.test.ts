/**
 * Регрессионные тесты для санитизации параметра days в getPeriodStats.
 *
 * Баг: `days || 7` заменял явный 0 на 7 до Clamp(1..365), поэтому 0
 * молчаливо расширял окно до 7 дней вместо клампинга к 1.
 * Фикс: явный 0 клампится к 1 до legacy-fallback, поэтому null/undefined/NaN
 * по-прежнему дефолтят к 7. См. братский метод
 * ViolationRepository.getTopUsersBySentenceStats (`|| 1` -> 0 клампится к 1)
 * и комментарий "Санitизируется к 1 дню" в edge-cases.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViolationHandler } from '../src/features/stats/violation-handler';
import { MessageFormatter } from '../src/core/message-formatter';
import { StatisticsService } from '../src/core/services/statistics-service';
import { ViolationRepository } from '../src/core/repositories/violation-repository';
import type { PeriodStats } from '../src/core/models/statistics';
import type { Env } from '../src/core/env';

const mockEnv: Env = {
  DB: {
    prepare: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn()
  } as any,
  HISTORY: {} as any,
  COUNTERS: {} as any,
  COUNTERS_DO: {} as any,
  MESSAGE_FETCHER_DO: {} as any,
  MESSAGE_AGGREGATOR_DO: {} as any,
  DAY_BLOCK_MANAGER_DO: {} as any,
  CRIMINAL_CODE_ANALYZER_DO: {} as any,
  AI: {},
  TOKEN: 'test-token',
  SECRET: 'test-secret',
  SUMMARY_MODEL: 'test-model',
  SUMMARY_PROMPT: 'test-prompt'
};

const MS_PER_DAY = 86400000;

const emptyPeriodStats: PeriodStats = {
  chatId: '-100123456789',
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-01'),
  totalViolations: 0,
  violationsByArticle: [],
  averageSeverity: 0,
  uniqueUsers: 0
};

describe('ViolationHandler.getPeriodStats — санитизация days', () => {
  let violationHandler: ViolationHandler;
  let statisticsService: StatisticsService;
  let violationRepository: ViolationRepository;

  beforeEach(() => {
    violationRepository = new ViolationRepository(mockEnv);
    statisticsService = new StatisticsService(violationRepository);
    violationHandler = new ViolationHandler(
      mockEnv,
      new MessageFormatter(),
      statisticsService,
      violationRepository
    );
  });

  it('days = 0 форвардит 1 (clamped), а не 7 — happy path', async () => {
    const spy = vi.spyOn(statisticsService, 'getPeriodStats').mockResolvedValue(emptyPeriodStats);
    const origError = console.error;
    console.error = vi.fn();
    try {
      await violationHandler.getPeriodStats('-100123456789', 0);
    } finally {
      console.error = origError;
    }
    expect(spy.mock.calls[0][1]).toBe(1);
  });

  it('days = 0 санитизируется к 1 в catch-fallback (окно = 1 день, не 7)', async () => {
    vi.spyOn(statisticsService, 'getPeriodStats').mockRejectedValue(new Error('boom'));
    const formatSpy = vi.spyOn(MessageFormatter.prototype, 'formatPeriodStats');
    const origError = console.error;
    console.error = vi.fn();
    try {
      await violationHandler.getPeriodStats('-100123456789', 0);
    } finally {
      console.error = origError;
    }
    const statsArg = formatSpy.mock.calls[0][0] as PeriodStats;
    const dayDiff = Math.round((statsArg.endDate.getTime() - statsArg.startDate.getTime()) / MS_PER_DAY);
    expect(dayDiff).toBe(1);
  });

  it('null, undefined и NaN сохраняют legacy-дефолт 7', async () => {
    const spy = vi.spyOn(statisticsService, 'getPeriodStats').mockResolvedValue(emptyPeriodStats);
    const origError = console.error;
    console.error = vi.fn();
    try {
      await violationHandler.getPeriodStats('-100123456789', undefined as any);
      await violationHandler.getPeriodStats('-100123456789', null as any);
      await violationHandler.getPeriodStats('-100123456789', Number.NaN);
    } finally {
      console.error = origError;
    }
    expect(spy.mock.calls[0][1]).toBe(7);
    expect(spy.mock.calls[1][1]).toBe(7);
    expect(spy.mock.calls[2][1]).toBe(7);
  });
});
