import { Hono } from 'hono';
import { EnvBindings, AppError } from '@/app/config';

const wcProxy = new Hono<{ Bindings: EnvBindings }>();

/**
 * WalletConnect Transparent Proxy Router
 * 
 * Objectives:
 * 1. Bypass regional restrictions by proxying WalletConnect traffic.
 * 2. Maintain strict CSP by making WalletConnect domains 'self'.
 * 
 * Compatibility:
 * - Cloudflare Workers: Uses native protocol upgrade support in fetch().
 */

// Helper to handle transparent proxying
const proxyRequest = async (targetHost: string, targetPath: string, c: any) => {
    const url = new URL(c.req.url);
    url.hostname = targetHost;
    url.pathname = targetPath; // CRITICAL: Rewrite pathname to match target API
    url.port = '';
    url.protocol = 'https:';

    // Clone headers to forward
    const headers = new Headers(c.req.raw.headers);
    headers.set('Host', targetHost);

    // Safety: Remove some internal headers
    headers.delete('cf-connecting-ip');
    headers.delete('x-forwarded-for');

    try {
        const res = await fetch(url.toString(), {
            method: c.req.method,
            headers: headers,
            body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.arrayBuffer() : undefined,
            // @ts-ignore
            redirect: 'follow',
        });

        // 核心修复：针对 Cloudflare Workers 的 WebSocket 代理
        // 如果上游返回 101 (Switching Protocols)，必须保留底层的 webSocket 对象以便建立隧道
        if (res.status === 101) {
            return new Response(null, {
                status: 101,
                statusText: 'Switching Protocols',
                headers: res.headers,
                // @ts-ignore - Cloudflare Workers 特有属性
                webSocket: (res as any).webSocket,
            });
        }

        return new Response(res.body, res);
    } catch (err: any) {
        console.error(`[WC Proxy Error] ${targetHost}: ${err.message}`);
        throw new AppError('wc_proxy_connection_failed', 502);
    }
};

// 1. WebSocket Relay Proxy
// Target: relay.walletconnect.com (Root Path)
wcProxy.all('/relay', (c) => {
    if (c.env.OAUTH_WALLETCONNECT_SELF_PROXY !== 'true') throw new AppError('wc_proxy_disabled', 403);
    return proxyRequest('relay.walletconnect.com', '/', c);
});

// 2. RPC / Explorer API Proxy
// Target: rpc.walletconnect.com/v1/*
wcProxy.all('/rpc/*', (c) => {
    if (c.env.OAUTH_WALLETCONNECT_SELF_PROXY !== 'true') throw new AppError('wc_proxy_disabled', 403);
    const path = c.req.path.substring(c.req.path.indexOf('/rpc'));
    const targetPath = path.replace('/rpc', '/v1');
    return proxyRequest('rpc.walletconnect.com', targetPath, c);
});

// 3. Verify Proxy
// Target: verify.walletconnect.com/*
wcProxy.all('/verify/*', (c) => {
    const path = c.req.path.substring(c.req.path.indexOf('/verify'));
    return proxyRequest('verify.walletconnect.com', path.replace('/verify', ''), c);
});

// 4. Explorer API Proxy (For wallet logos and metadata)
// Target: explorer-api.walletconnect.com/*
wcProxy.all('/explorer/*', (c) => {
    const path = c.req.path.substring(c.req.path.indexOf('/explorer'));
    return proxyRequest('explorer-api.walletconnect.com', path.replace('/explorer', ''), c);
});

export default wcProxy;
