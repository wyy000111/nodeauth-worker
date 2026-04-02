import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import vaultRoutes from '@/features/vault/vaultRoutes';
import { VaultService } from '@/features/vault/vaultService';
import { SessionService } from '@/features/auth/sessionService';

vi.mock('@/features/vault/vaultService');
vi.mock('@/features/auth/sessionService');
vi.mock('@/shared/utils/crypto', () => ({
    verifySecureJWT: vi.fn(),
    generateSecureJWT: vi.fn(),
    generateDeviceKey: vi.fn()
}));

describe('Vault API Sync - Batch Processing [Red Phase]', () => {
    let app: Hono<any>;

    beforeEach(async () => {
        vi.clearAllMocks();
        const env = { DB: { batch: vi.fn(), insert: vi.fn() }, JWT_SECRET: 'test' };
        app = new Hono().route('/api/vault', vaultRoutes);

        const originalRequest = app.request.bind(app);
        app.request = (path: any, options?: any) => {
            return originalRequest(path, options, env as any);
        };

        const { verifySecureJWT } = await import('@/shared/utils/crypto');
        vi.mocked(verifySecureJWT).mockResolvedValue({
            userInfo: { username: 'test-user' },
            sessionId: 'mock-session-sync'
        });

        // Mock Session validation
        vi.mocked(SessionService.prototype.validateSession).mockResolvedValue(true);

        // 显式 Mock 业务层处理结果
        vi.mocked(VaultService.prototype.batchSync).mockResolvedValue([
            { success: true, type: 'create', id: 'tmp_1', serverId: '1' },
            { success: true, type: 'update', id: '123' },
            { success: true, type: 'delete', id: '456' }
        ]);
    });

    it('should process a batch of sync actions successfully (POST /api/vault/sync)', async () => {
        const syncActions = {
            actions: [
                { type: 'create', data: { service: 'New Site', account: 'user', secret: 'ABC' } },
                { type: 'update', id: '123', data: { service: 'Updated Site' } },
                { type: 'delete', id: '456' }
            ]
        };

        const headers = new Headers();
        headers.set('Cookie', 'auth_token=v; csrf_token=m');
        headers.set('X-CSRF-Token', 'm');
        headers.set('Content-Type', 'application/json');

        const res = await app.request('/api/vault/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify(syncActions)
        });

        const body = await res.json() as any;
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.results).toHaveLength(3);
    });
});
