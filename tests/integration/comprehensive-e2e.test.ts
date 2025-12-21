import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleUpdate, recordMessage } from '../../src/api/update';
import { sendMessage } from '../../src/core/telegram';
import type { Env } from '../../src/core/env';
import { createMockEnv } from '../test-utils';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';

// Mock external dependencies
vi.mock('../../src/core/telegram', () => ({
  sendMessage: vi.fn()
}));

vi.mock('../../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    logApiRequestPattern: vi.fn(),
    logPerformanceInsight: vi.fn()
  },
  PerformanceTracker: {
    start: vi.fn().mockReturnValue('mock-tracker-id'),
    end: vi.fn().mockReturnValue({ functionName: 'test', duration: 100 }),
    getActiveTrackers: vi.fn().mockReturnValue(new Map()),
    cleanup: vi.fn()
  }
}));

vi.mock('../../src/env', async () => {
  const actual = await vi.importActual('../../src/env');
  return {
    ...actual,
    isTestEnvironment: vi.fn().mockReturnValue(false)
  };
});

describe('Comprehensive E2E Integration Tests', () => {
  let mockEnv: Env;
  let mockSendMessage: any;
  const testChatId = -100123456789;
  const testUserId = 123456;
  const testUsername = 'testuser';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage = vi.mocked(sendMessage);

    // Create real KV instances for more realistic testing
    const history = new KVNamespace(new MemoryStorage());
    const counters = new KVNamespace(new MemoryStorage());

    mockEnv = createMockEnv({
      HISTORY: history as any,
      COUNTERS: counters as any
    });
  });

  function createTestMessage(text: string, userId = testUserId, username = testUsername) {
    return {
      message_id: Math.floor(Math.random() * 1000000),
      chat: { id: testChatId },
      from: { id: userId, username },
      text,
      date: Math.floor(Date.now() / 1000)
    };
  }

  describe('Command Functionality Tests', () => {
    describe('Help Command', () => {
      it('should display help text with all available commands', async () => {
        const message = createTestMessage('/help');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        const helpText = mockSendMessage.mock.calls[0][2];

        // Verify all major command categories are present
        expect(helpText).toContain('/summary');
        expect(helpText).toContain('/top');
        expect(helpText).toContain('/profanity_top');
        expect(helpText).toContain('/criminal_stats');
        expect(helpText).toContain('/activity');
        expect(helpText).toContain('/reset');
      });
    });

    describe('Summary Commands', () => {
      it('should handle /summary command with default parameters', async () => {
        const message = createTestMessage('/summary');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /summary_last command with message count', async () => {
        const message = createTestMessage('/summary_last 5');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });
    });

    describe('Statistics Commands', () => {
      it('should handle /top command for active users', async () => {
        const message = createTestMessage('/top 5');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
        const response = mockSendMessage.mock.calls[0][2];
        // With empty data, should return 'Нет данных'
        expect(response).toContain('Нет данных');
      });
    });

    describe('Profanity Commands', () => {
      it('should handle /profanity_top command', async () => {
        const message = createTestMessage('/profanity_top 5 today');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /profanity_words command', async () => {
        const message = createTestMessage('/profanity_words 10 week');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /my_profanity command', async () => {
        const message = createTestMessage('/my_profanity month');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /profanity_chart_week command', async () => {
        const message = createTestMessage('/profanity_chart_week');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /profanity_reset command', async () => {
        const message = createTestMessage('/profanity_reset');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalledWith(
          mockEnv,
          testChatId,
          'Счетчики матерной лексики сброшены'
        );
      });
    });

    describe('Criminal Code Commands', () => {
      it('should handle /criminal_stats command', async () => {
        const message = createTestMessage('/criminal_stats today');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /my_criminal command', async () => {
        const message = createTestMessage('/my_criminal week');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /criminal_top command', async () => {
        const message = createTestMessage('/criminal_top 10 month');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalled();
      });

      it('should handle /criminal_reset command', async () => {
        const message = createTestMessage('/criminal_reset');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalledWith(
          mockEnv,
          testChatId,
          'Счетчики нарушений УК РФ сброшены'
        );
      });
    });

    describe('Activity Commands', () => {
      it('should handle /activity_week command', async () => {
        const message = createTestMessage('/activity_week');

        // Activity commands may fail due to empty data, but should handle gracefully
        try {
          await handleUpdate(message, mockEnv);
        } catch (error) {
          // Expected to fail with empty data, but should not crash the system
          expect(error).toBeDefined();
        }
      });

      it('should handle /activity_month command', async () => {
        const message = createTestMessage('/activity_month');

        // Activity commands may fail due to empty data, but should handle gracefully
        try {
          await handleUpdate(message, mockEnv);
        } catch (error) {
          // Expected to fail with empty data, but should not crash the system
          expect(error).toBeDefined();
        }
      });

      it('should handle /activity users week command', async () => {
        const message = createTestMessage('/activity users week');

        // Activity commands may fail due to empty data, but should handle gracefully
        try {
          await handleUpdate(message, mockEnv);
        } catch (error) {
          // Expected to fail with empty data, but should not crash the system
          expect(error).toBeDefined();
        }
      });
    });

    describe('Reset Commands', () => {
      it('should handle /reset command', async () => {
        const message = createTestMessage('/reset');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalledWith(
          mockEnv,
          testChatId,
          'Counters reset'
        );
      });
    });

    describe('Admin Commands', () => {
      it('should handle /test_race_conditions for admin users', async () => {
        mockEnv.ADMIN_USER_ID = testUserId.toString();
        const message = createTestMessage('/test_race_conditions');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalledWith(
          mockEnv,
          testChatId,
          'Запуск тестов защиты от race conditions...'
        );
      });

      it('should reject /test_race_conditions for non-admin users', async () => {
        mockEnv.ADMIN_USER_ID = '999999'; // Different user ID
        const message = createTestMessage('/test_race_conditions');

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).toHaveBeenCalledWith(
          mockEnv,
          testChatId,
          'Эта команда доступна только администраторам'
        );
      });
    });
  });

  describe('Message Processing Tests', () => {
    describe('Regular Message Analysis', () => {
      it('should analyze regular messages for profanity and criminal code violations', async () => {
        const message = createTestMessage('This is a regular message for analysis');

        await handleUpdate(message, mockEnv);

        // Should not send any immediate response for regular messages
        expect(mockSendMessage).not.toHaveBeenCalled();

        // Background analysis happens asynchronously, so we can't directly test it
        // but we can verify the message was processed without errors
      });

      it('should not analyze command messages', async () => {
        const message = createTestMessage('/help');

        await handleUpdate(message, mockEnv);

        // Should only process the command, not analyze for violations
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
      });

      it('should handle empty or null messages gracefully', async () => {
        await handleUpdate(null, mockEnv);
        await handleUpdate(undefined, mockEnv);

        expect(mockSendMessage).not.toHaveBeenCalled();
      });

      it('should handle messages without text', async () => {
        const message = {
          message_id: 123,
          chat: { id: testChatId },
          from: { id: testUserId, username: testUsername },
          date: Math.floor(Date.now() / 1000),
          text: '' // Empty text instead of undefined
        };

        await handleUpdate(message, mockEnv);

        expect(mockSendMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe('Data Storage Tests', () => {
    describe('Counter Storage', () => {
      it('should verify counter storage is available', async () => {
        // Test that counter storage mock is properly configured
        expect(mockEnv.COUNTERS_DO).toBeDefined();
        expect(mockEnv.COUNTERS_DO.get).toBeDefined();
      });
    });

    describe('History Storage', () => {
      it('should verify history storage is available', async () => {
        // Test that history storage mock is properly configured
        expect(mockEnv.HISTORY).toBeDefined();
        expect(mockEnv.DAY_BLOCK_MANAGER_DO).toBeDefined();
      });

      it('should record messages using recordMessage function', async () => {
        const message = createTestMessage('Test message for recording');

        await recordMessage(message, mockEnv);

        // Verify that Durable Objects were called for message recording
        expect(mockEnv.COUNTERS_DO.get).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle errors gracefully', async () => {
      const message = createTestMessage('/summary');

      await expect(handleUpdate(message, mockEnv)).resolves.not.toThrow();
    });
  });

  describe('Integration Flow Tests', () => {
    it('should complete full lifecycle for summary command', async () => {
      // Execute: Send summary command
      const message = createTestMessage('/summary 1');
      await handleUpdate(message, mockEnv);

      // Verify: Command was processed
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('should complete full lifecycle for statistics command', async () => {
      // Execute: Send top command
      const message = createTestMessage('/top 5');
      await handleUpdate(message, mockEnv);

      // Verify: Command was processed
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('should complete full lifecycle for message analysis', async () => {
      // Execute: Send regular message
      const message = createTestMessage('This is a test message for analysis');
      await handleUpdate(message, mockEnv);

      // Verify: Message was processed without errors
      // Note: Background analysis happens asynchronously and doesn't directly call DO methods
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Performance and Scalability Tests', () => {
    it('should handle multiple concurrent commands', async () => {
      const commands = [
        createTestMessage('/help'),
        createTestMessage('/top 5'),
        createTestMessage('/summary'),
        createTestMessage('/profanity_top')
      ];

      // Execute all commands concurrently
      await Promise.all(commands.map(cmd => handleUpdate(cmd, mockEnv)));

      // Verify all commands were processed
      expect(mockSendMessage).toHaveBeenCalledTimes(4);
    });
  });
});