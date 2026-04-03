import fs from 'fs';
import path from 'path';

export interface StaticServerOptions {
    frontendDistPath: string;
    logLevel?: string;
}

/**
 * 核心逻辑：静态资源分发与 SPA 回退。
 * 遵循“原子探测 (Atomic Detection)”原则，消除文件系统竞争风险。
 */
export const nodeAssetsFetch = async (request: Request, options: StaticServerOptions) => {
    const { frontendDistPath, logLevel = 'info' } = options;
    const url = new URL(request.url);

    // 0. API 直通车：如果是 API 请求且不是文件，直接放行给 Hono 处理
    if (url.pathname.startsWith('/api/')) {
        return new Response('Not Found', { status: 404 });
    }

    // 确保路径合法，防止目录遍历攻击 (Path Traversal)
    let filePath = path.resolve(frontendDistPath, url.pathname.slice(1));
    if (!filePath.startsWith(frontendDistPath)) {
        return new Response('Forbidden', { status: 403 });
    }

    const isAssetPath = url.pathname.startsWith('/assets/');
    const isStaticAsset = isAssetPath || /\.(js|css|png|jpg|jpeg|gif|svg|ico|webmanifest|wasm|json|mjs|woff2|woff|ttf|map)$/i.test(url.pathname);
    const prefersHtml = request.headers.get('Accept')?.includes('text/html');

    let isFallback = false;
    let isIndexHtml = false;

    // 1. 处理请求根路径或直接请求 index.html
    const isRoot = url.pathname === '/' || url.pathname === '/index.html';
    if (isRoot) {
        const indexFile = path.join(frontendDistPath, 'index.html');
        try {
            if (fs.statSync(indexFile).isFile()) {
                filePath = indexFile;
                isIndexHtml = true;
            }
        } catch (e) { }
    }

    // 2. SPA 路由回退逻辑 (仅对非 Index 且 非静态资源 或 导航请求)
    if (!isIndexHtml) {
        let initialStats: fs.Stats | null = null;
        try {
            initialStats = fs.statSync(filePath);
        } catch (e) { }

        // 如果路径不存在，或者它是一个目录（非直接文件访问）
        if (!initialStats || initialStats.isDirectory()) {
            // 资产文件（图片、JS等）不应有备选，没找到就是 404
            if (isAssetPath) {
                if (logLevel !== 'error' && logLevel !== 'warn') {
                    console.log(`[Static] Asset Missing (No Fallback): ${url.pathname}`);
                }
                return new Response('Asset Not Found', { status: 404 });
            }

            // 只有当请求明确不像是静态资源，或者客户端偏好 HTML（浏览器导航）时才回退
            if (!isStaticAsset || prefersHtml) {
                const fallbackPath = path.join(frontendDistPath, 'index.html');
                try {
                    if (fs.statSync(fallbackPath).isFile()) {
                        filePath = fallbackPath;
                        isFallback = true;
                    }
                } catch (e) { }
            }
        }
    }

    // 3. 最终原子化读取 (修复 TOC-TOU 竞态风险)
    let fd: number | null = null;
    try {
        // 原子化动作 A: 直接打开文件
        fd = fs.openSync(filePath, 'r');

        // 原子化动作 B: 基于已打开的 FD 获取元数据 (绝对安全，Inode 已锁定)
        const stats = fs.fstatSync(fd);

        if (stats.isDirectory()) {
            fs.closeSync(fd);
            return new Response('Not Found', { status: 404 });
        }

        const content = fs.readFileSync(fd);
        const ext = path.extname(filePath).toLowerCase();

        // 读取完内容后立即释放 FD
        fs.closeSync(fd);
        fd = null;

        const mimeTypes: { [key: string]: string } = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.json': 'application/json',
            '.wasm': 'application/wasm',
            '.webmanifest': 'application/manifest+json',
            '.woff2': 'font/woff2'
        };

        // --- 架构优化：精细化缓存策略 ---
        let cacheControl = 'public, max-age=3600';
        if (url.pathname.startsWith('/assets/')) {
            cacheControl = 'public, max-age=31536000, immutable';
        } else if (url.pathname === '/sw.js' || url.pathname.includes('manifest')) {
            cacheControl = 'no-store, no-cache, must-revalidate, proxy-revalidate';
        } else if (isIndexHtml || isFallback) {
            cacheControl = 'no-cache';
        }

        if (logLevel !== 'error' && logLevel !== 'warn') {
            const type = isFallback ? '[Fallback]' : (isIndexHtml ? '[Index]' : '[File]');
            console.log(`[Static] ${type} ${url.pathname} -> ${path.basename(filePath)} (${mimeTypes[ext] || 'bin'})`);
        }

        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                'Cache-Control': cacheControl,
                'X-NodeAuth-Source': isFallback ? 'SPA-Fallback' : 'Static-FS'
            }
        });
    } catch (e) {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (ce) { }
        }

        // 如果是因为文件不存在导致的失败，在此统一处理 404
        if (logLevel !== 'error' && logLevel !== 'warn') {
            console.log(`[Static] Access Failed: ${url.pathname}`);
        }
        return new Response('Not Found', { status: 404 });
    }
};
