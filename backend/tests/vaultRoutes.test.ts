import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import vaultRoutes from '@/features/vault/vaultRoutes';
import { VaultService } from '@/features/vault/vaultService';
import { SessionService } from '@/features/auth/sessionService';
import { AppError } from '@/app/config';

// 💡 TDD 技巧：Mock Service 和底层加密函数
vi.mock('@/features/vault/vaultService');
vi.mock('@/features/auth/sessionService');
vi.mock('@/shared/utils/crypto', () => ({
    verifySecureJWT: vi.fn(),
    generateSecureJWT: vi.fn(),
    generateDeviceKey: vi.fn()
}));

describe('Vault API Routes - Authentication & Responses [Green]', () => {
    let app: Hono<any>;

    beforeEach(() => {
        vi.clearAllMocks();

        const env = { DB: {}, JWT_SECRET: 'test' };
        app = new Hono().route('/api/vault', vaultRoutes);

        // 关键：注入生产环境相同的错误处理，确保 401 报错能被正确序列化
        app.onError((err, c) => {
            const statusCode = (err as any).statusCode || (err as any).status || 500;
            return c.json({ message: err.message }, statusCode as any);
        });

        // Mock Session Service Validation Globally for these tests
        vi.mocked(SessionService.prototype.validateSession).mockResolvedValue(true);

        const originalRequest = app.request.bind(app);
        app.request = (path: any, options?: any) => {
            return originalRequest(path, options, env as any);
        };
    });

    it('should return 401 when cookies are missing', async () => {
        const res = await app.request('/api/vault');
        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.message).toBe('no_session');
    });

    it('should pass authentication and return items on GET /api/vault', async () => {
        // 1. Mock 鉴权通过 (必须带 sessionId)
        const { verifySecureJWT } = await import('@/shared/utils/crypto');
        vi.mocked(verifySecureJWT).mockResolvedValue({
            userInfo: { username: 'test-user', email: 'test@example.com' },
            sessionId: 'mock-session-123'
        });

        // 2. Mock 业务层成功
        vi.mocked(VaultService.prototype.getAccountsPaginated).mockResolvedValue({
            items: [{ id: '1', service: 'Test', secret: 'SSS', account: 'A' } as any],
            totalCount: 1,
            totalPages: 1,
            categoryStats: []
        });

        // 3. 构造带有 CSRF 和 Auth Cookie 的请求
        const headers = new Headers();
        headers.set('Cookie', 'auth_token=valid; csrf_token=match');
        headers.set('X-CSRF-Token', 'match');

        const res = await app.request('/api/vault', {
            headers
        });

        const body = await res.json() as any;
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.vault).toHaveLength(1);
    });

    it('should handle business errors (e.g., 404) correctly', async () => {
        const { verifySecureJWT } = await import('@/shared/utils/crypto');
        vi.mocked(verifySecureJWT).mockResolvedValue({
            userInfo: { username: 'test-user' },
            sessionId: 'mock-session-123'
        });

        vi.mocked(VaultService.prototype.deleteAccount).mockRejectedValue(
            new AppError('account_not_found', 404)
        );

        const headers = new Headers();
        headers.set('Cookie', 'auth_token=v; csrf_token=m');
        headers.set('X-CSRF-Token', 'm');

        const res = await app.request('/api/vault/any-id', {
            method: 'DELETE',
            headers
        });

        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.message).toBe('account_not_found');
    });
});
