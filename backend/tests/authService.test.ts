import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '@/features/auth/authService';
import { getOAuthProvider } from '@/features/auth/providers/index';
import { SessionService } from '@/features/auth/sessionService';

/**
 * 💡 TDD 技巧：直接定义 Mock 实例
 */
const { mockedRepoInstance } = vi.hoisted(() => ({
    mockedRepoInstance: {
        isEmergencyConfirmed: vi.fn(),
        create: vi.fn().mockResolvedValue(undefined)
    }
}));

// 🔴 关键修复：使用 class 声明确保它是一个构造函数
vi.mock('@/shared/db/repositories/emergencyRepository', () => ({
    EmergencyRepository: class {
        constructor() {
            return mockedRepoInstance;
        }
    }
}));

// Mock SessionService to prevent real DB interaction
vi.mock('@/features/auth/sessionService');

vi.mock('@/features/auth/providers/index');
vi.mock('@/shared/utils/crypto', () => ({
    generateSecureJWT: vi.fn().mockResolvedValue('mock-token'),
    generateDeviceKey: vi.fn().mockResolvedValue('mock-device-key'),
}));

describe('AuthService Integration Tests - Fixed Mock', () => {
    let authService: AuthService;
    let mockEnv: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnv = {
            DB: {
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockReturnValue({
                        execute: vi.fn().mockResolvedValue({})
                    })
                })
            },
            JWT_SECRET: 'test-secret',
            OAUTH_ALLOWED_USERS: 'allowed@example.com',
            OAUTH_ALLOW_ALL: 'false',
            ENCRYPTION_KEY: 'master-key'
        };
        mockedRepoInstance.isEmergencyConfirmed.mockResolvedValue(false);

        // Ensure SessionService.createSession returns a mock ID
        vi.mocked(SessionService.prototype.createSession).mockResolvedValue('mock-session-id');

        authService = new AuthService(mockEnv);
    });

    describe('handleOAuthCallback Integration', () => {
        it('should handle login and return token', async () => {
            const mockProvider = {
                handleCallback: vi.fn().mockResolvedValue({
                    id: '123',
                    email: 'allowed@example.com',
                    provider: 'google'
                }),
                whitelistFields: ['email']
            };
            vi.mocked(getOAuthProvider).mockReturnValue(mockProvider as any);

            const result = await authService.handleOAuthCallback('google', { code: 'any' }, '127.0.0.1', 'UA');
            expect(result.token).toBe('mock-token');
            expect(result.needsEmergency).toBe(true);
        });

        it('should return correct emergency status', async () => {
            mockedRepoInstance.isEmergencyConfirmed.mockResolvedValue(true);
            const mockProvider = {
                handleCallback: vi.fn().mockResolvedValue({
                    id: '123', email: 'allowed@example.com', provider: 'google'
                }),
                whitelistFields: ['email']
            };
            vi.mocked(getOAuthProvider).mockReturnValue(mockProvider as any);

            const result = await authService.handleOAuthCallback('google', { code: 'any' }, '127.0.0.1', 'UA');
            expect(result.needsEmergency).toBe(false);
        });

        it('should allow users by domain (e.g., @google.com)', async () => {
            mockEnv.OAUTH_ALLOWED_USERS = '@google.com'; // 配置域名白名单
            const mockProvider = {
                handleCallback: vi.fn().mockResolvedValue({
                    id: '1',
                    email: 'alice@google.com',
                    provider: 'google'
                }),
                whitelistFields: ['email']
            };
            vi.mocked(getOAuthProvider).mockReturnValue(mockProvider as any);

            const result = await authService.handleOAuthCallback('google', { code: 'any' }, '127.0.0.1', 'UA');
            expect(result.token).toBe('mock-token');
        });

        it('should fail when user is not whitelisted', async () => {
            const mockProvider = {
                handleCallback: vi.fn().mockResolvedValue({
                    id: '1', email: 'intruder@example.com', provider: 'google'
                }),
                whitelistFields: ['email']
            };
            vi.mocked(getOAuthProvider).mockReturnValue(mockProvider as any);

            await expect(authService.handleOAuthCallback('google', { code: 'any' }, '1.1.1.1', 'UA'))
                .rejects
                .toThrow();
        });
    });
});
