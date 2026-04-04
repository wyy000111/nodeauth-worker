import { Hono } from 'hono';
import { EnvBindings } from '@/app/config';
import { authMiddleware } from '@/shared/middleware/auth';
import { BackupService } from '@/features/backup/backupService';
import { verifySecureJWT } from '@/shared/utils/crypto';
import { getCookie, setCookie } from 'hono/cookie';
import { AppError } from '@/app/config';

const backups = new Hono<{ Bindings: EnvBindings, Variables: { user: any } }>();

const isSecureContext = (c: any) => c.env.ENVIRONMENT !== 'development';

// === UNPROTECTED ROUTES (OAuth Callbacks) ===
// These routes process 302 redirects from external providers.
// They CANNOT be protected by CSRF middleware because they are GET requests initiated by external domains.
// Instead, they implement their own state-based CSRF protection.

// --- Google Drive OAuth Callback ---
backups.get('/oauth/google/callback', async (c) => {
    // Explicitly allow opener access across origins for OAuth window communication
    c.header('Cross-Origin-Opener-Policy', 'unsafe-none');

    // 1. Verify State (Anti-CSRF for OAuth)
    const stateInQuery = c.req.query('state');
    const stateInCookie = getCookie(c, 'gdrive_oauth_state');

    if (!stateInQuery || !stateInCookie || stateInQuery !== stateInCookie) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'Security Warning: State mismatch.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }

    // 2. Verify Session (Cookie JWT)
    const token = getCookie(c, 'auth_token');
    if (!token) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'Session expired' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }

    const payload = await verifySecureJWT(token, c.env.JWT_SECRET);
    if (!payload?.userInfo) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'Invalid session' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }

    // 3. Exchange Code
    const code = c.req.query('code');
    const error = c.req.query('error');
    if (error === 'access_denied') {
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'User denied access' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }
    if (!code) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'Auth code missing' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }

    const clientId = c.env.OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = c.env.OAUTH_GOOGLE_CLIENT_SECRET;
    const redirectUri = c.env.OAUTH_GOOGLE_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/google/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId || '',
            client_secret: clientSecret || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        })
    });

    if (!tokenRes.ok) {
        const errData = await tokenRes.json() as any;
        console.error('[OAuth] Token exchange failed:', errData);
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'Token exchange failed: ${errData.error_description || errData.error}' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }

    const tokenData = await tokenRes.json() as any;
    const refreshToken = tokenData.refresh_token;

    if (!refreshToken) {
        // Google only sends refresh_token on the first consent or if prompt=consent is used
        return c.html(`
            <html><body><script>
                const msg = { type: 'GDRIVE_AUTH_ERROR', message: 'No refresh token received. Please check app permissions.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('gdrive_oauth_channel'); bc.postMessage(msg); bc.close(); } catch(e) {}
                window.close();
            </script></body></html>
        `);
    }

    // 4. Send Refresh Token back to frontend and close
    return c.html(`
        <html>
        <head><title>Success</title></head>
        <body style="font-family:sans-serif; text-align:center; padding-top:50px; color:#555;">
            <div id="status">授权成功，正在返回应用...</div>
            <script>
                (function() {
                    const message = { 
                        type: 'GDRIVE_AUTH_SUCCESS', 
                        refreshToken: ${JSON.stringify(refreshToken)}
                    };
                    
                    function transmit() {
                        const success = !!window.opener;
                        
                        // 1. 尝试 postMessage (传统方式)
                        if (window.opener) {
                            window.opener.postMessage(message, '*');
                        }

                        // 2. 尝试 BroadcastChannel (现代且更可靠的方式，不依赖 opener)
                        try {
                            const bc = new BroadcastChannel('gdrive_oauth_channel');
                            bc.postMessage(message);
                            bc.close();
                            return true; // 只要 BC 发送成功，就视为成功
                        } catch (e) {
                            console.error('BC failed:', e);
                        }
                        
                        return success;
                    }

                    // 尝试多次发送，防止竞态
                    transmit();
                    setTimeout(transmit, 100);
                    setTimeout(transmit, 400);

                    // 维持窗口一秒钟，确保主页面有足够时间处理
                    setTimeout(() => {
                        transmit();
                        window.close();
                    }, 800);
                })();
            </script>
        </body>
        </html>
    `);
});

// --- Microsoft OneDrive OAuth Callback ---
backups.get('/oauth/microsoft/callback', async (c) => {
    c.header('Cross-Origin-Opener-Policy', 'unsafe-none');

    const stateInQuery = c.req.query('state');
    const stateInCookie = getCookie(c, 'ms_oauth_state');

    if (!stateInQuery || !stateInCookie || stateInQuery !== stateInCookie) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'Security Warning: State mismatch.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const token = getCookie(c, 'auth_token');
    if (!token) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'Session expired' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const payload = await verifySecureJWT(token, c.env.JWT_SECRET);
    if (!payload?.userInfo) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'Invalid session' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const code = c.req.query('code');
    const error = c.req.query('error');
    if (error === 'access_denied') {
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'User denied access' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }
    if (!code) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'Auth code missing' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const clientId = c.env.OAUTH_MICROSOFT_CLIENT_ID;
    const clientSecret = c.env.OAUTH_MICROSOFT_CLIENT_SECRET;
    const redirectUri = c.env.OAUTH_MICROSOFT_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/microsoft/callback`;

    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId || '',
            client_secret: clientSecret || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        })
    });

    if (!tokenRes.ok) {
        const errData = await tokenRes.json() as any;
        console.error('[OAuth] Microsoft Token exchange failed:', errData);
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'Token exchange failed: ${errData.error_description || errData.error}' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const tokenData = await tokenRes.json() as any;
    const refreshToken = tokenData.refresh_token;

    if (!refreshToken) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'MS_AUTH_ERROR', message: 'No refresh token received.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('ms_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    return c.html(`
        <html>
        <head><title>Success</title></head>
        <body style="font-family:sans-serif; text-align:center; padding-top:50px; color:#555;">
            <div id="status">授权成功，正在返回应用...</div>
            <script>
                (function () {
                    const message = {
                        type: 'MS_AUTH_SUCCESS',
                        refreshToken: ${JSON.stringify(refreshToken)}
                    };

                    function transmit() {
                        if (window.opener) {
                            window.opener.postMessage(message, '*');
                        }
                        try {
                            const bc = new BroadcastChannel('ms_oauth_channel');
                            bc.postMessage(message);
                            bc.close();
                        } catch (e) { }
                    }

                    transmit();
                    setTimeout(transmit, 100);
                    setTimeout(transmit, 400);

                    setTimeout(() => {
                        transmit();
                        window.close();
                    }, 800);
                })();
            </script>
        </body>
        </html>
    `);
});

// --- Baidu Netdisk OAuth Callback ---
backups.get('/oauth/baidu/callback', async (c) => {
    c.header('Cross-Origin-Opener-Policy', 'unsafe-none');

    const stateInQuery = c.req.query('state');
    const stateInCookie = getCookie(c, 'baidu_oauth_state');

    if (!stateInQuery || !stateInCookie || stateInQuery !== stateInCookie) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'Security Warning: State mismatch.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const token = getCookie(c, 'auth_token');
    if (!token) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'Session expired' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const payload = await verifySecureJWT(token, c.env.JWT_SECRET);
    if (!payload?.userInfo) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'Invalid session' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const code = c.req.query('code');
    const error = c.req.query('error');
    if (error === 'access_denied') {
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'User denied access' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }
    if (!code) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'Auth code missing' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const clientId = c.env.OAUTH_BAIDU_CLIENT_ID;
    const clientSecret = c.env.OAUTH_BAIDU_CLIENT_SECRET;
    const redirectUri = c.env.OAUTH_BAIDU_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/baidu/callback`;

    const tokenRes = await fetch('https://openapi.baidu.com/oauth/2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId || '',
            client_secret: clientSecret || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        })
    });

    if (!tokenRes.ok) {
        const errData = await tokenRes.json() as any;
        console.error('[OAuth] Baidu Token exchange failed:', errData);
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'Token exchange failed: ${errData.error_description || errData.error}' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const tokenData = await tokenRes.json() as any;
    const refreshToken = tokenData.refresh_token;

    if (!refreshToken) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'BAIDU_AUTH_ERROR', message: 'No refresh token received.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('baidu_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    return c.html(`
        <html>
        <head><title>Success</title></head>
        <body style="font-family:sans-serif; text-align:center; padding-top:50px; color:#555;">
            <div id="status">授权成功，正在返回应用...</div>
            <script>
                (function () {
                    const message = {
                        type: 'BAIDU_AUTH_SUCCESS',
                        refreshToken: ${JSON.stringify(refreshToken)}
                    };

                    function transmit() {
                        if (window.opener) {
                            window.opener.postMessage(message, '*');
                        }
                        try {
                            const bc = new BroadcastChannel('baidu_oauth_channel');
                            bc.postMessage(message);
                            bc.close();
                        } catch (e) { }
                    }

                    transmit();
                    setTimeout(transmit, 100);
                    setTimeout(transmit, 400);

                    setTimeout(() => {
                        transmit();
                        window.close();
                    }, 800);
                })();
            </script>
        </body>
        </html>
    `);
});

// --- Dropbox OAuth Callback ---
backups.get('/oauth/dropbox/callback', async (c) => {
    c.header('Cross-Origin-Opener-Policy', 'unsafe-none');

    const stateInQuery = c.req.query('state');
    const stateInCookie = getCookie(c, 'dropbox_oauth_state');

    if (!stateInQuery || !stateInCookie || stateInQuery !== stateInCookie) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'Security Warning: State mismatch.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const token = getCookie(c, 'auth_token');
    if (!token) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'Session expired' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const payload = await verifySecureJWT(token, c.env.JWT_SECRET);
    if (!payload?.userInfo) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'Invalid session' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const code = c.req.query('code');
    const error = c.req.query('error');
    if (error === 'access_denied') {
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'User denied access' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }
    if (!code) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'Auth code missing' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const clientId = c.env.OAUTH_DROPBOX_CLIENT_ID;
    const clientSecret = c.env.OAUTH_DROPBOX_CLIENT_SECRET;
    const redirectUri = c.env.OAUTH_DROPBOX_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/dropbox/callback`;

    const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId || '',
            client_secret: clientSecret || '',
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        })
    });

    if (!tokenRes.ok) {
        const errData = await tokenRes.json() as any;
        console.error('[OAuth] Dropbox Token exchange failed:', errData);
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'Token exchange failed: ${errData.error_description || errData.error}' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    const tokenData = await tokenRes.json() as any;
    const refreshToken = tokenData.refresh_token;

    if (!refreshToken) {
        return c.html(`
            <html><body><script>
                const msg = { type: 'DROPBOX_AUTH_ERROR', message: 'No refresh token received.' };
                if (window.opener) window.opener.postMessage(msg, '*');
                try { const bc = new BroadcastChannel('dropbox_oauth_channel'); bc.postMessage(msg); bc.close(); } catch (e) { }
                window.close();
            </script></body></html>
        `);
    }

    return c.html(`
        <html>
        <head><title>Success</title></head>
        <body style="font-family:sans-serif; text-align:center; padding-top:50px; color:#555;">
            <div id="status">授权成功，正在返回应用...</div>
            <script>
                (function () {
                    const message = {
                        type: 'DROPBOX_AUTH_SUCCESS',
                        refreshToken: ${JSON.stringify(refreshToken)}
                    };

                    function transmit() {
                        if (window.opener) {
                            window.opener.postMessage(message, '*');
                        }
                        try {
                            const bc = new BroadcastChannel('dropbox_oauth_channel');
                            bc.postMessage(message);
                            bc.close();
                        } catch (e) { }
                    }

                    transmit();
                    setTimeout(transmit, 100);
                    setTimeout(transmit, 400);

                    setTimeout(() => {
                        transmit();
                        window.close();
                    }, 800);
                })();
            </script>
        </body>
        </html>
    `);
});

// =========================================================================
// === PROTECTED ROUTES ===
// All routes below this middleware require a valid JWT AND a valid CSRF token.
backups.use('*', authMiddleware);
// =========================================================================

backups.get('/providers', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const providers = await service.getProvidersList();

    // Check which providers are enabled via environment variables
    const availableTypes = ['s3', 'telegram', 'webdav', 'email'];
    if (c.env.OAUTH_GOOGLE_CLIENT_ID && c.env.OAUTH_GOOGLE_CLIENT_SECRET) {
        availableTypes.push('gdrive');
    }
    if (c.env.OAUTH_MICROSOFT_CLIENT_ID && c.env.OAUTH_MICROSOFT_CLIENT_SECRET) {
        availableTypes.push('onedrive');
    }
    if (c.env.OAUTH_BAIDU_CLIENT_ID && c.env.OAUTH_BAIDU_CLIENT_SECRET) {
        availableTypes.push('baidu');
    }
    if (c.env.OAUTH_DROPBOX_CLIENT_ID && c.env.OAUTH_DROPBOX_CLIENT_SECRET) {
        availableTypes.push('dropbox');
    }

    return c.json({ success: true, providers, availableTypes });
});

backups.post('/providers', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const data = await c.req.json();
    const id = await service.addProvider(data);
    return c.json({ success: true, id });
});

backups.put('/providers/:id', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const id = Number(c.req.param('id'));
    const data = await c.req.json();
    await service.updateProvider(id, data);
    return c.json({ success: true });
});

backups.delete('/providers/:id', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const id = Number(c.req.param('id'));
    await service.deleteProvider(id);
    return c.json({ success: true });
});

backups.post('/providers/test', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const { type, config, id } = await c.req.json();
    await service.testConnection(type, config, id);
    return c.json({ success: true, message: 'Connection successful' });
});

backups.post('/providers/:id/backup', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const id = Number(c.req.param('id'));
    const body = await c.req.json();
    await service.executeManualBackup(id, body);
    return c.json({ success: true, message: 'Backup successful' });
});

backups.get('/providers/:id/files', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const id = Number(c.req.param('id'));
    const files = await service.getFiles(id);
    return c.json({ success: true, files });
});

backups.post('/providers/:id/download', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const id = Number(c.req.param('id'));
    const { filename } = await c.req.json();
    const content = await service.downloadFile(id, filename);
    return c.json({ success: true, content });
});

backups.post('/providers/:id/files/delete', async (c) => {
    const service = new BackupService(c.env, c.req.header('Accept-Language'));
    const id = Number(c.req.param('id'));
    const { filename } = await c.req.json();
    await service.deleteFile(id, filename);
    return c.json({ success: true });
});

// --- Google Drive OAuth Initiation ---
// NOTE: This is a POST request, so it's protected by CSRF check.
backups.post('/oauth/google/auth', async (c) => {
    const clientId = c.env.OAUTH_GOOGLE_CLIENT_ID;
    const redirectUri = c.env.OAUTH_GOOGLE_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/google/callback`;

    if (!clientId) throw new AppError('oauth_config_incomplete', 400);

    // Generate dynamic state for security
    const state = crypto.randomUUID();

    // Store state in a short-lived cookie for verification in callback
    setCookie(c, 'gdrive_oauth_state', state, {
        path: '/api/backups/oauth/google/callback',
        secure: isSecureContext(c),
        httpOnly: true,
        sameSite: 'Lax', // Lax is required for cross-site redirect callback
        maxAge: 600 // 10 minutes
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.file',
        access_type: 'offline',
        prompt: 'consent',
        state: state
    });

    return c.json({
        success: true,
        authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
    });
});

// --- Microsoft OneDrive OAuth Initiation ---
// NOTE: This is a POST request, so it's protected by CSRF check.
backups.post('/oauth/microsoft/auth', async (c) => {
    const clientId = c.env.OAUTH_MICROSOFT_CLIENT_ID;
    const redirectUri = c.env.OAUTH_MICROSOFT_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/microsoft/callback`;

    if (!clientId) throw new AppError('oauth_config_incomplete', 400);

    const state = crypto.randomUUID();

    setCookie(c, 'ms_oauth_state', state, {
        path: '/api/backups/oauth/microsoft/callback',
        secure: isSecureContext(c),
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 600
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'offline_access Files.ReadWrite.AppFolder',
        state: state
    });

    return c.json({
        success: true,
        authUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
    });
});

// --- Baidu Netdisk OAuth Initiation ---
backups.post('/oauth/baidu/auth', async (c) => {
    const clientId = c.env.OAUTH_BAIDU_CLIENT_ID;
    const redirectUri = c.env.OAUTH_BAIDU_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/baidu/callback`;

    if (!clientId) throw new AppError('oauth_config_incomplete', 400);

    const state = crypto.randomUUID();

    setCookie(c, 'baidu_oauth_state', state, {
        path: '/api/backups/oauth/baidu/callback',
        secure: isSecureContext(c),
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 600
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'basic,netdisk',
        state: state,
        display: 'popup'
    });

    return c.json({
        success: true,
        authUrl: `https://openapi.baidu.com/oauth/2.0/authorize?${params.toString()}`
    });
});

// --- Dropbox OAuth Initiation ---
backups.post('/oauth/dropbox/auth', async (c) => {
    const clientId = c.env.OAUTH_DROPBOX_CLIENT_ID;
    const redirectUri = c.env.OAUTH_DROPBOX_BACKUP_REDIRECT_URI || `${new URL(c.req.url).origin}/api/backups/oauth/dropbox/callback`;

    if (!clientId) throw new AppError('oauth_config_incomplete', 400);

    const state = crypto.randomUUID();

    setCookie(c, 'dropbox_oauth_state', state, {
        path: '/api/backups/oauth/dropbox/callback',
        secure: isSecureContext(c),
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 600
    });

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        token_access_type: 'offline', // Request refresh token
        state: state
    });

    return c.json({
        success: true,
        authUrl: `https://www.dropbox.com/oauth2/authorize?${params.toString()}`
    });
});

export async function handleScheduledBackup(env: EnvBindings) {
    const service = new BackupService(env);
    await service.handleScheduledBackup();
}

export default backups;
