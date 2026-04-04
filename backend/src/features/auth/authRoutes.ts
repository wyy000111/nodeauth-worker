import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { EnvBindings, AppError } from '@/app/config';
import { authMiddleware } from '@/shared/middleware/auth';
import { rateLimit, resetRateLimit } from '@/shared/middleware/rateLimitMiddleware';
import { SECURITY_CONFIG } from '@/app/config';
import { getAvailableProviders } from '@/features/auth/providers/index';
import { AuthService } from '@/features/auth/authService';
import { WebAuthnService } from '@/features/auth/webAuthnService';
import { Web3WalletAuthService } from '@/features/auth/web3WalletAuthService';
import { EmergencyRepository } from '@/shared/db/repositories/emergencyRepository';
import { SessionService } from '@/features/auth/sessionService';

const auth = new Hono<{ Bindings: EnvBindings, Variables: { user: any, sessionId: string } }>();

const isSecureContext = (c: any) => c.env.ENVIRONMENT !== 'development';

const getService = (c: any) => new AuthService(c.env);
const getWebAuthnService = (c: any) => new WebAuthnService(c.env, c.req.url, c.req.header());
const getWeb3WalletAuthService = (c: any) => new Web3WalletAuthService(c.env);
const getSessionService = (c: any) => new SessionService(c.env);

// 获取可用登录方式列表
auth.get('/providers', (c) => {
    const providers = getAvailableProviders(c.env);
    if (providers.length === 0) {
        console.warn('[OAuth] No providers configured. Please check environment variables.');
    }
    const enhancedProviders = providers.map(p => {
        if (p.id === 'telegram') {
            const rawName = c.env.OAUTH_TELEGRAM_BOT_NAME || '';
            return { ...p, botName: rawName.replace(/^@/, '') };
        }
        return p;
    });
    return c.json({
        success: true,
        providers: enhancedProviders
    });
});

// 获取授权地址
auth.get('/authorize/:provider', async (c) => {
    const providerName = c.req.param('provider');
    const service = getService(c);

    // 生成包含唯一 state 防御 CSRF 的跳转地址
    const authData = await service.generateAuthorizeUrl(providerName);

    // 将 state 存入服务端的 HttpOnly Cookie，有效期 10 分钟
    const stateCookieName = `oauth_state_${providerName}`;
    setCookie(c, stateCookieName, authData.state, {
        httpOnly: true,
        secure: isSecureContext(c),
        sameSite: 'Lax', // 允许从第三方回调跳回时携带
        maxAge: 10 * 60, // 10分钟有效期
        path: '/',
    });

    return c.json({
        success: true,
        authUrl: authData.url,
        state: authData.state,
        codeVerifier: authData.codeVerifier
    });
});

// 核心逻辑：用 Code 换取系统的 JWT 令牌
auth.post('/callback/:provider', rateLimit({
    windowMs: SECURITY_CONFIG.LOCKOUT_TIME,
    max: SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS,
}), async (c) => {
    const providerName = c.req.param('provider');
    const body = await c.req.json();

    // --- State 闭环校验开始 ---
    const stateCookieName = `oauth_state_${providerName}`;
    const serverState = getCookie(c, stateCookieName);
    const clientState = body.state; // 前端传回的回调 state 参数

    if (!serverState || !clientState || serverState !== clientState) {
        throw new AppError('oauth_state_invalid', 403);
    }

    // 校验通过，清理一次性 State Cookie
    deleteCookie(c, stateCookieName, { path: '/', secure: isSecureContext(c), sameSite: 'Lax' });
    // --- State 闭环校验结束 ---

    const service = getService(c);

    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'Unknown Device';

    // 调用 Service 层处理登录
    const { token, userInfo, deviceKey, needsEmergency, encryptionKey } = await service.handleOAuthCallback(providerName!, body, clientIp, userAgent, body.deviceId);

    // 1. 设置 httpOnly 的鉴权 Cookie
    setCookie(c, 'auth_token', token, {
        httpOnly: true,
        secure: isSecureContext(c),
        sameSite: 'Lax',
        maxAge: 7 * 24 * 60 * 60, // 7天
        path: '/',
    });

    // 2. 设置 CSRF Token Cookie
    const csrfToken = crypto.randomUUID();
    setCookie(c, 'csrf_token', csrfToken, {
        httpOnly: false,
        secure: isSecureContext(c),
        sameSite: 'Lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
    });

    // 3. 登录成功，重置限流计数器
    await resetRateLimit(c, `rl:${clientIp}:/api/auth/callback/${providerName}`);

    return c.json({
        success: true,
        userInfo,
        deviceKey,
        needsEmergency,
        encryptionKey
    });
});

// 退出登录
auth.post('/logout', (c) => {
    const cookieOpts = { path: '/', secure: isSecureContext(c), sameSite: 'Lax' as const };
    deleteCookie(c, 'auth_token', cookieOpts);
    deleteCookie(c, 'csrf_token', cookieOpts);

    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    return c.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// 获取当前用户信息
auth.get('/me', authMiddleware, async (c) => {
    const user = c.get('user');
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');

    // 检查是否需要系统初始化
    const repository = new EmergencyRepository(c.env.DB);
    const isEmergencyConfirmed = await repository.isEmergencyConfirmed();

    // 如果未激活，则持续返回加密密钥供备份页面使用
    const encryptionKey = !isEmergencyConfirmed ? c.env.ENCRYPTION_KEY : undefined;

    // 🛡️ 架构师修复 (Option A): /me 必须返回由 JWT_SECRET 派生的 deviceKey
    // 确保前端在 IndexedDB 被清理后能静默恢复本地加密环境
    const { generateDeviceKey } = await import('@/shared/utils/crypto');
    const deviceKey = await generateDeviceKey(user.email || user.id, c.env.JWT_SECRET || '');

    return c.json({
        success: true,
        userInfo: user,
        deviceKey,
        needsEmergency: !isEmergencyConfirmed,
        encryptionKey
    });
});

// --- WebAuthn (Passkey) 核心接口 ---

// 1. 获取注册选项 (需已登录)
auth.get('/webauthn/register/options', authMiddleware, async (c) => {
    const user = c.get('user');
    const service = getWebAuthnService(c);

    // 🛡️ 架构师修复: 使用 user.email || user.id 作为 identity，确保非邮箱登录 (如 Telegram) 也能注册。
    const identity = user.email || user.id;
    const displayName = user.username || identity;
    const options = await service.generateRegistrationOptions(user.id, identity, displayName);

    // 存储 challenge 到 Cookie
    setCookie(c, 'webauthn_registration_challenge', options.challenge, {
        httpOnly: true, secure: isSecureContext(c), sameSite: 'Lax', maxAge: 120, path: '/'
    });

    return c.json(options);
});

// 2. 验证注册响应 (需已登录)
auth.post('/webauthn/register/verify', authMiddleware, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const expectedChallenge = getCookie(c, 'webauthn_registration_challenge');

    if (!expectedChallenge) throw new AppError('webauthn_challenge_missing', 400);

    const service = getWebAuthnService(c);
    const { name } = body; // 前端传回的自定义别名

    // 🛡️ 架构师修复: 存储 identity (Email or ID) 以便后续精准识别
    const identity = user.email || user.id;
    const result = await service.verifyRegistrationResponse(identity, body.response, expectedChallenge, name);

    deleteCookie(c, 'webauthn_registration_challenge', { path: '/', secure: isSecureContext(c) });
    return c.json(result);
});

// 3. 获取登录选项 (公开)
auth.get('/webauthn/login/options', rateLimit({
    windowMs: 60 * 1000, // 1分钟内限制获取 options 的频率
    max: 10,
}), async (c) => {
    const service = getWebAuthnService(c);
    const options = await service.generateAuthenticationOptions();

    setCookie(c, 'webauthn_login_challenge', options.challenge, {
        httpOnly: true, secure: isSecureContext(c), sameSite: 'Lax', maxAge: 120, path: '/'
    });

    return c.json(options);
});

// 4. 验证登录响应 (公开)
auth.post('/webauthn/login/verify', rateLimit({
    windowMs: SECURITY_CONFIG.LOCKOUT_TIME,
    max: SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS,
}), async (c) => {
    const body = await c.req.json();
    const expectedChallenge = getCookie(c, 'webauthn_login_challenge');

    if (!expectedChallenge) throw new AppError('webauthn_challenge_missing', 400);

    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'Unknown Device';

    const service = getWebAuthnService(c);
    const result = await service.verifyAuthenticationResponse(body, expectedChallenge, clientIp, userAgent, body.deviceId);

    // 登录成功，设置会话 Cookie (逻辑同 OAuth callback)
    setCookie(c, 'auth_token', result.token, {
        httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60, path: '/',
    });

    const csrfToken = crypto.randomUUID();
    setCookie(c, 'csrf_token', csrfToken, {
        httpOnly: false, secure: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60, path: '/',
    });

    // 登录成功，重置限流计数器
    await resetRateLimit(c, `rl:${clientIp}:/api/auth/webauthn/login/verify`);

    deleteCookie(c, 'webauthn_login_challenge', { path: '/', secure: isSecureContext(c) });

    return c.json({
        success: true,
        deviceKey: result.deviceKey,
        userInfo: result.userInfo,
        needsEmergency: result.needsEmergency,
        encryptionKey: result.encryptionKey
    });
});

// 5. 获取凭证列表 (需已登录)
auth.get('/webauthn/credentials', authMiddleware, async (c) => {
    const service = getWebAuthnService(c);
    const credentials = await service.listCredentials();
    return c.json({ success: true, credentials });
});

// 6. 删除凭证 (需已登录)
auth.delete('/webauthn/credentials/:id', authMiddleware, async (c) => {
    const credentialId = c.req.param('id');
    const service = getWebAuthnService(c);
    const result = await service.deleteCredential(credentialId!);
    return c.json(result);
});

// 7. 更新凭证 (需已登录)
auth.put('/webauthn/credentials/:id', authMiddleware, async (c) => {
    const credentialId = c.req.param('id');
    const body = await c.req.json();
    const { name } = body;
    if (!name) {
        throw new AppError('credential_name_required', 400);
    }
    const service = getWebAuthnService(c);
    const result = await service.updateCredentialName(credentialId!, name);
    return c.json(result);
});

// --- Web3 登录核心接口 ---

// 1. 获取 Web3 登录选项 (包含 Nonce Challenge)
auth.get('/web3/login/options', rateLimit({
    windowMs: 60 * 1000,
    max: 10,
}), async (c) => {
    const service = getWeb3WalletAuthService(c);
    const options = await service.generateAuthenticationOptions();

    setCookie(c, 'web3_login_nonce', options.nonce, {
        httpOnly: true, secure: isSecureContext(c), sameSite: 'Lax', maxAge: 120, path: '/'
    });

    return c.json(options);
});

// 2. 验证 Web3 签名回调
auth.post('/web3/login/verify', rateLimit({
    windowMs: SECURITY_CONFIG.LOCKOUT_TIME,
    max: SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS,
}), async (c) => {
    const body = await c.req.json();
    const expectedNonce = getCookie(c, 'web3_login_nonce');

    if (!expectedNonce) throw new AppError('web3_nonce_missing', 400);

    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'Unknown Device';

    const service = getWeb3WalletAuthService(c);
    const result = await service.verifyAuthenticationResponse(
        body.address,
        body.message,
        body.signature,
        expectedNonce!,
        clientIp,
        userAgent,
        body.deviceId
    );

    // 设置安全 HttpOnly Auth Cookie
    setCookie(c, 'auth_token', result.token, {
        httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60, path: '/',
    });
    // 防御 CSRF
    const csrfToken = crypto.randomUUID();
    setCookie(c, 'csrf_token', csrfToken, {
        httpOnly: false, secure: isSecureContext(c), sameSite: 'Lax', maxAge: 7 * 24 * 60 * 60, path: '/',
    });

    await resetRateLimit(c, `rl:${clientIp}:/api/auth/web3/login/verify`);
    deleteCookie(c, 'web3_login_nonce', { path: '/', secure: isSecureContext(c) });

    return c.json({
        success: true,
        deviceKey: result.deviceKey,
        userInfo: result.userInfo,
        needsEmergency: result.needsEmergency,
        encryptionKey: result.encryptionKey
    });
});


// --- 设备会话管理 API (Session Management) ---

// 获取所有登录设备 (需已登录)
auth.get('/sessions', authMiddleware, async (c) => {
    const user = c.get('user');
    const currentSessionId = c.get('sessionId');
    const service = getSessionService(c);

    // Heartbeat for current session automatically
    const clientIp = c.req.header('CF-Connecting-IP') || 'unknown';
    if (currentSessionId) {
        // Run heartbeat asynchronously
        c.executionCtx.waitUntil(service.heartbeat(currentSessionId, clientIp));
    }

    const sessions = await service.getUserSessions(user.email || user.id, currentSessionId);
    return c.json({ success: true, sessions });
});

// 删除除本设备外的所有其他设备 (需已登录)
auth.delete('/sessions', authMiddleware, async (c) => {
    const user = c.get('user');
    const currentSessionId = c.get('sessionId');
    const service = getSessionService(c);

    if (!currentSessionId) {
        throw new AppError('Current session invalid', 400);
    }

    await service.deleteAllOtherSessions(user.email || user.id, currentSessionId);
    return new Response(null, { status: 204 });
});

// 删除指定设备 (需已登录)
auth.delete('/sessions/:id', authMiddleware, async (c) => {
    const user = c.get('user');
    const targetSessionId = c.req.param('id');
    const currentSessionId = c.get('sessionId');
    const service = getSessionService(c);

    if (!currentSessionId) {
        throw new AppError('Current session invalid', 400);
    }

    // 自踢防御交由 Service 层拦截，也可以在这里提前拦
    await service.deleteSession(user.email || user.id, targetSessionId || '', currentSessionId);
    return new Response(null, { status: 204 });
});

export default auth;