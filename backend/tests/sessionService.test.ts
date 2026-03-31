import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from '@/features/auth/sessionService';
import { AppError } from '@/app/config';

describe('Feature: Login Device Management (剔除其他设备)', () => {
    let sessionService: SessionService;
    let mockRepo: any;
    let mockEnv: any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockEnv = {
            DB: {},
            SESSION_TTL_DAYS: 30
        };

        mockRepo = {
            create: vi.fn(),
            findByUserId: vi.fn(),
            findAll: vi.fn(),
            findById: vi.fn(),
            deleteById: vi.fn(),
            deleteAllExcept: vi.fn(),
            updateLastActive: vi.fn(),
            cleanupExpired: vi.fn()
        };

        // Initialize service with mocked repository
        sessionService = new SessionService(mockEnv, mockRepo);
    });

    describe('1. 正常路径 (Happy Path)', () => {
        it('[记录设备] should create a new session record returning sessionId', async () => {
            mockRepo.create.mockResolvedValue();

            const result = await sessionService.createSession('user@example.com', 'Chrome on Windows', '192.168.1.1');

            expect(result).toMatch(/^[0-9a-f-]{36}$/); // Expect UUID
            expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
                id: result,
                userId: 'user@example.com',
                deviceType: 'Chrome on Windows',
                ipAddress: '192.168.1.1',
                lastActiveAt: expect.any(Number),
                createdAt: expect.any(Number)
            }));
        });

        it('[获取设备列表] should return all active sessions for a user and mark current device', async () => {
            const mockSessions = [
                { id: 'sid-1', userId: 'user@example.com', deviceType: 'Macbook', ipAddress: '1.2.3.4', lastActiveAt: 1000 },
                { id: 'sid-2', userId: 'user@example.com', deviceType: 'iPhone', ipAddress: '5.6.7.8', lastActiveAt: 2000 }
            ];
            mockRepo.findAll.mockResolvedValue(mockSessions);

            const result = await sessionService.getUserSessions('user@example.com', 'sid-1');

            expect(result).toHaveLength(2);
            const currentSession = result.find(s => s.id === 'sid-1');
            expect(currentSession?.isCurrent).toBe(true);
            const otherSession = result.find(s => s.id === 'sid-2');
            expect(otherSession?.isCurrent).toBe(false);
        });

        it('[踢出单体目标设备] should delete specific session successfully', async () => {
            const currentSessionId = 'sid-current';
            const targetSessionId = 'sid-target';

            // Assume session belongs to user
            mockRepo.findById.mockResolvedValue({ id: targetSessionId, userId: 'user@example.com' });
            mockRepo.deleteById.mockResolvedValue(true);

            await sessionService.deleteSession('user@example.com', targetSessionId, currentSessionId);

            expect(mockRepo.deleteById).toHaveBeenCalledWith(targetSessionId);
        });

        it('[一键踢出其他所有设备] should delete all sessions except the current one', async () => {
            mockRepo.deleteAllExcept.mockResolvedValue(5); // 5 other devices kicked

            const count = await sessionService.deleteAllOtherSessions('user@example.com', 'sid-current');

            expect(count).toBe(5);
            expect(mockRepo.deleteAllExcept).toHaveBeenCalledWith(null, 'sid-current');
        });

        it('[活跃保活机制] should update lastActiveAt and IP on heartbeat', async () => {
            mockRepo.updateLastActive.mockResolvedValue(true);

            await sessionService.heartbeat('sid-1', '10.0.0.1');

            expect(mockRepo.updateLastActive).toHaveBeenCalledWith('sid-1', '10.0.0.1', expect.any(Number));
        });
    });

    describe('2. 异常/边界路径 (Edge Cases)', () => {
        it('[自杀防御保护] should reject deleting the current active session', async () => {
            const currentSessionId = 'sid-current';

            await expect(sessionService.deleteSession('user@example.com', currentSessionId, currentSessionId))
                .rejects
                .toThrowError(AppError);

            await expect(sessionService.deleteSession('user@example.com', currentSessionId, currentSessionId))
                .rejects
                .toMatchObject({ statusCode: 400 });
        });

        it('[全局管理模式] should effectively delete sessions belonging to any user globally', async () => {
            // Target session belongs to 'other@example.com'
            mockRepo.findById.mockResolvedValue({ id: 'sid-target', userId: 'other@example.com' });
            mockRepo.deleteById.mockResolvedValue(true);

            // This should not throw an error in the private personal tool architecture
            await sessionService.deleteSession('user@example.com', 'sid-target', 'sid-current');

            expect(mockRepo.deleteById).toHaveBeenCalledWith('sid-target');
        });

        it('[僵尸设备隐退/淘汰机制] should trigger cleanup of expired devices', async () => {
            mockRepo.cleanupExpired.mockResolvedValue(10);

            const cleanupCount = await sessionService.cleanupZombieSessions();

            expect(cleanupCount).toBe(10);
            expect(mockRepo.cleanupExpired).toHaveBeenCalled(); // Should use Env TTL
        });

        it('[幽灵 JWT 识别] valid session check should return false for deleted sessions', async () => {
            mockRepo.findById.mockResolvedValue(null); // Session not in DB

            const isValid = await sessionService.validateSession('sid-ghost');

            expect(isValid).toBe(false);
        });

        it('[隐私/降级客户端的 User-Agent 解析容错] should handle missing User-Agent fallback seamlessly', async () => {
            // Null or empty user-agent
            await sessionService.createSession('user@example.com', '', '192.168.1.1');

            expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
                deviceType: 'Unknown Device'
            }));
        });
    });
});
