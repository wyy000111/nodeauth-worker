import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionService } from '@/features/auth/sessionService';

describe('TDD: Device Identity & Global Session Management (架构升级验证)', () => {
    let sessionService: SessionService;
    let mockRepo: any;
    let mockEnv: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnv = {
            DB: {},
            SESSION_TTL_DAYS: 30
        };

        mockRepo = {
            create: vi.fn(),
            findByUserId: vi.fn(),
            findAll: vi.fn(), // 👈 新增：全局查找所有会话
            findById: vi.fn(),
            deleteById: vi.fn(),
            deleteAllExcept: vi.fn(),
            updateLastActive: vi.fn(),
            cleanupExpired: vi.fn(),
            findByDeviceId: vi.fn(), // 👈 辅助：通过 DeviceID 查找
            findSessionByDevice: vi.fn(), // 👈 核心：精准匹配 (userId, deviceId)
            update: vi.fn() // 👈 新增：更新已有会话
        };

        sessionService = new SessionService(mockEnv, mockRepo);
    });

    describe('1. 正常路径 (Happy Path)', () => {
        it('HP-01: [设备指纹识别] should upsert session if same (userId, deviceId) exists', async () => {
            const userId = 'user@example.com';
            const deviceId = 'hardware-uuid-123';
            const existingSession = { id: 'old-sid', userId, deviceId, lastActiveAt: 100 };

            // 模拟数据库已存在该设备在该用户下的记录
            mockRepo.findSessionByDevice.mockResolvedValue(existingSession);
            mockRepo.updateLastActive.mockResolvedValue(true);

            const result = await (sessionService as any).createSession(userId, 'Chrome', '1.1.1.1', deviceId);

            // 验证点：返回旧的 ID 或更新后的 ID，且不调用 create，而是调用 update
            expect(result).toBe('old-sid');
            expect(mockRepo.create).not.toHaveBeenCalled();
            expect(mockRepo.updateLastActive).toHaveBeenCalled();
        });

        it('HP-02: [新设备注册] should create new session if deviceId is new', async () => {
            const userId = 'user@example.com';
            const deviceId = 'brand-new-device';

            mockRepo.findSessionByDevice.mockResolvedValue(null);
            mockRepo.create.mockResolvedValue();

            const result = await (sessionService as any).createSession(userId, 'Chrome', '1.1.1.1', deviceId);

            expect(result).toMatch(/^[0-9a-f-]{36}$/);
            expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
                deviceId: deviceId
            }));
        });

        it('HP-03: [全局视野] should return ALL sessions in the system (Private Mode)', async () => {
            // Simulate creating sessions with provider information
            // Note: The original test used mockRepo.findAll directly.
            // The new test uses service.createSession, which will call mockRepo.create.
            // We need to mock the behavior of mockRepo.findAll to return these created sessions.
            const session1 = { id: 'sid-1', userId: 'user1@test.com', deviceType: 'UA1', provider: 'github' };
            const session2 = { id: 'sid-2', userId: 'user2@test.com', deviceType: 'UA2', provider: 'passkey' };

            // Mock createSession to return a session object that can be "found" later
            mockRepo.findSessionByDevice.mockResolvedValue(null); // Ensure new sessions are created
            mockRepo.create
                .mockImplementationOnce(async (sessionData: any) => {
                    Object.assign(sessionData, { id: 'sid-1' }); // Assign an ID for the first session
                    return session1;
                })
                .mockImplementationOnce(async (sessionData: any) => {
                    Object.assign(sessionData, { id: 'sid-2' }); // Assign an ID for the second session
                    return session2;
                });

            await (sessionService as any).createSession('user1@test.com', 'UA1', '1.1.1.1', 'dev1', 'github');
            await (sessionService as any).createSession('user2@test.com', 'UA2', '2.2.2.2', 'dev2', 'passkey');

            // Now mock findAll to return the "created" sessions
            mockRepo.findAll.mockResolvedValue([session1, session2]);

            const sessions = await sessionService.getUserSessions('user1@test.com', 'some-id');
            expect(sessions).toHaveLength(2);
            expect(sessions.some(s => s.id === 'sid-2')).toBe(true);
            expect(sessions.find(s => s.id === 'sid-1')?.provider).toBe('github');
            expect(sessions.find(s => s.id === 'sid-2')?.provider).toBe('passkey');
        });

        it('HP-04: [跨账号识别] should link same device to different users if logged in separately', async () => {
            // 这属于极客边界：如果同一设备先登 A 再登 B，应保留两条记录但 deviceId 相同
            // (除非用户要求强行合并跨账号设备，但通常（userId, deviceId）是最小单元)
            mockRepo.findSessionByDevice.mockResolvedValue(null);
            await (sessionService as any).createSession('userA@test.com', 'Chrome', '1.1.1.1', 'hw-1');
            await (sessionService as any).createSession('userB@test.com', 'Chrome', '1.1.1.1', 'hw-1');

            expect(mockRepo.create).toHaveBeenCalledTimes(2);
        });
    });

    describe('2. 异常/边界路径 (Edge Cases)', () => {
        it('EC-01: [DeviceID 缺失兼容] should fallback to random UUID if deviceId is not provided', async () => {
            mockRepo.findSessionByDevice.mockResolvedValue(null);

            const result = await (sessionService as any).createSession('user@test.com', 'Old Client', '1.2.3.4');

            expect(result).toBeDefined();
            expect(mockRepo.create).toHaveBeenCalled();
        });

        it('EC-02: [全系统踢出] deleteAllOtherSessions should now affect all other users sessions', async () => {
            mockRepo.deleteAllExcept.mockResolvedValue(10); // 假设踢出了全系统 10 台设备

            const count = await sessionService.deleteAllOtherSessions('any-user', 'current-sid');

            expect(count).toBe(10);
            // 验证Repository调用不再传 userId 或传 null 表明全局
            expect(mockRepo.deleteAllExcept).toHaveBeenCalledWith(null, 'current-sid');
        });
    });
});
