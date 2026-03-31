import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { AppError } from '@/app/config';
import { authMiddleware } from '@/shared/middleware/auth';
import authRoutes from '@/features/auth/authRoutes';
import { getCookie } from 'hono/cookie';
import { verifySecureJWT } from '@/shared/utils/crypto';

// Mock dependencies
vi.mock('hono/cookie', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        getCookie: vi.fn(),
        setCookie: vi.fn(),
        deleteCookie: vi.fn()
    }
});

vi.mock('@/shared/utils/crypto', () => ({
    verifySecureJWT: vi.fn(),
    generateSecureJWT: vi.fn()
}));

const mockSessionRepo = {
    getUserSessions: vi.fn(),
    deleteSession: vi.fn(),
    deleteAllOtherSessions: vi.fn(),
    validateSession: vi.fn(),
    heartbeat: vi.fn()
};

vi.mock('@/features/auth/sessionService', () => {
    return {
        SessionService: class {
            constructor() {
                return mockSessionRepo;
            }
        }
    };
});

describe('Integration: Session API Routes & Auth Middleware (TDD)', () => {
    let app: Hono;

    beforeEach(() => {
        vi.clearAllMocks();
        app = new Hono();

        // Setup mock execution context for waitUntil
        app.use('*', async (c, next) => {
            c.env = { JWT_SECRET: 'test-secret' };
            Object.defineProperty(c, 'executionCtx', { value: { waitUntil: vi.fn() } });
            await next();
        });

        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ error: err.message }, err.statusCode as any);
            }
            return c.json({ error: 'Internal Server Error' }, 500);
        });

        // Use the auth middleware and expose a dummy route to test middleware
        app.get('/test-middleware', authMiddleware, (c) => c.text('OK'));

        // Mount original authRoutes
        app.route('/api/oauth', authRoutes);
    });

    describe('1. 正常路径 (Happy Path)', () => {
        it('[合法请求通行] authMiddleware should allow request and attach sessionId if session is valid in DB', async () => {
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'valid-token';
                if (name === 'csrf_token') return 'valid-csrf';
                return undefined;
            });
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { id: 'user1' },
                sessionId: 'session-123'
            });
            mockSessionRepo.validateSession.mockResolvedValue(true);

            // Add mock CSRF header
            const req = new Request('http://localhost/test-middleware', {
                headers: { 'X-CSRF-Token': 'valid-csrf' }
            });

            const res = await app.request(req);
            expect(res.status).toBe(200);
            expect(await res.text()).toBe('OK');
        });

        it('[查询当前账号所有设备] GET /sessions should return list of active sessions with current marked', async () => {
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'valid-token';
                if (name === 'csrf_token') return 'csrf-123';
                return undefined;
            });
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { email: 'user@test.com' },
                sessionId: 'current-session-id'
            });
            mockSessionRepo.validateSession.mockResolvedValue(true);

            mockSessionRepo.getUserSessions.mockResolvedValue([
                { id: 'current-session-id' },
                { id: 'other-session-id' }
            ]);

            const req = new Request('http://localhost/api/oauth/sessions', {
                headers: { 'X-CSRF-Token': 'csrf-123', 'CF-Connecting-IP': '1.2.3.4' }
            });
            const res = await app.request(req);

            expect(res.status).toBe(200);
            expect(mockSessionRepo.getUserSessions).toHaveBeenCalledWith('user@test.com', 'current-session-id');
        });

        it('[成功踢下线] DELETE /sessions/:id should delete specific session and return 204', async () => {
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'valid-token';
                if (name === 'csrf_token') return 'csrf-123';
                return undefined;
            });
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { email: 'user@test.com' },
                sessionId: 'current-session-id'
            });
            mockSessionRepo.validateSession.mockResolvedValue(true);

            const req = new Request('http://localhost/api/oauth/sessions/delete-target', {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': 'csrf-123' }
            });
            const res = await app.request(req);

            expect(res.status).toBe(204);
            expect(mockSessionRepo.deleteSession).toHaveBeenCalledWith('user@test.com', 'delete-target', 'current-session-id');
        });

        it('[一键清除其它设备] DELETE /sessions should clear all EXCEPT current and return 204', async () => {
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'valid-token';
                if (name === 'csrf_token') return 'csrf-123';
                return undefined;
            });
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { email: 'user@test.com' },
                sessionId: 'current-session'
            });
            mockSessionRepo.validateSession.mockResolvedValue(true);

            const req = new Request('http://localhost/api/oauth/sessions', {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': 'csrf-123' }
            });
            const res = await app.request(req);

            expect(res.status).toBe(204);
            expect(mockSessionRepo.deleteAllOtherSessions).toHaveBeenCalledWith('user@test.com', 'current-session');
        });
    });

    describe('2. 异常/边界路径 (Edge Cases)', () => {
        it('[幽灵 JWT 无情拦截] authMiddleware should return 401 if sessionId in JWT is missing or invalid in DB', async () => {
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'valid-token';
                if (name === 'csrf_token') return 'csrf-123';
                return undefined;
            });

            // Valid token signature but validateSession will return false
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { email: 'user@test.com' },
                sessionId: 'kicked-out-session'
            });
            mockSessionRepo.validateSession.mockResolvedValue(false); // DB says session doesn't exist anymore

            const req = new Request('http://localhost/test-middleware', {
                headers: { 'X-CSRF-Token': 'csrf-123' }
            });
            const res = await app.request(req);
            expect(res.status).toBe(401); // Intercepted successfully
        });

        it('[兼容旧版免剔除 JWT] authMiddleware should reject old JWTs without sessionId if strict mode', async () => {
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'old-token';
                if (name === 'csrf_token') return 'csrf-123';
                return undefined;
            });

            // Missing sessionId
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { email: 'user@test.com' }
            });

            const req = new Request('http://localhost/test-middleware', {
                headers: { 'X-CSRF-Token': 'csrf-123' }
            });
            const res = await app.request(req);
            expect(res.status).toBe(401);
            const resData = await res.json() as any;
            expect(resData.error).toBe('session_invalid_schema');
        });

        it('[自踢防御阻断] DELETE /sessions/:id with current sessionId should throw 400', async () => {
            // Service level validation throws naturally, but testing the middleware propagation
            vi.mocked(getCookie).mockImplementation((c, name) => {
                if (name === 'auth_token') return 'valid-token';
                if (name === 'csrf_token') return 'csrf-123';
                return undefined;
            });
            vi.mocked(verifySecureJWT).mockResolvedValue({
                userInfo: { email: 'user@test.com' },
                sessionId: 'current-session-id'
            });
            mockSessionRepo.validateSession.mockResolvedValue(true);

            mockSessionRepo.deleteSession.mockRejectedValue(new AppError('Cannot kick current device', 400));

            const req = new Request('http://localhost/api/oauth/sessions/current-session-id', {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': 'csrf-123' }
            });

            const res = await app.request(req);
            expect(res.status).toBe(400); // BadRequest propagated
        });
    });
});
