import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { nodeAssetsFetch } from '../src/shared/utils/staticServer';

// Mock fs module
vi.mock('fs');

describe('StaticServer Utility (Atomic FS Robustness)', () => {
    const mockDistPath = '/mock/frontend/dist';
    const mockOptions = { frontendDistPath: mockDistPath, logLevel: 'error' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 200 for valid index.html request', async () => {
        const req = new Request('http://localhost/index.html');
        const mockStats = { isFile: () => true, isDirectory: () => false } as fs.Stats;

        // Mocking root check and final check
        vi.mocked(fs.statSync).mockReturnValue(mockStats);
        vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('<html></html>'));

        const res = await nodeAssetsFetch(req, mockOptions);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/html');
    });

    it('should return 403 for path traversal attempt (escaping dist)', async () => {
        // 我们需要测试：当路径解析后确实不在 dist 目录下时（防御深度隔离失效）
        // 模拟一个极其隐蔽、能产生绝对路径逃逸的请求
        const req = new Request('http://localhost/assets');

        // 我们通过 mock 内部使用的 path.resolve 来模拟一次“不安全”的解析结果
        const pathSpy = vi.spyOn(path, 'resolve').mockReturnValueOnce('/mock/nodeauth/etc/passwd');

        const res = await nodeAssetsFetch(req, mockOptions);

        expect(res.status).toBe(403);
        pathSpy.mockRestore();
    });

    it('should return 404 WITHOUT fallback for missing assets', async () => {
        const req = new Request('http://localhost/assets/logo.png');

        // Simulate file not found in statSync
        vi.mocked(fs.statSync).mockImplementation(() => {
            throw new Error('ENOENT');
        });

        const res = await nodeAssetsFetch(req, mockOptions);

        expect(res.status).toBe(404);
        const text = await res.text();
        expect(text).toBe('Asset Not Found');
    });

    it('should fallback to index.html for SPA routes', async () => {
        const req = new Request('http://localhost/dashboard', {
            headers: { 'Accept': 'text/html' }
        });

        const indexStats = { isFile: () => true, isDirectory: () => false } as fs.Stats;

        vi.mocked(fs.statSync).mockImplementation((p: any) => {
            if (p.toString().endsWith('index.html')) return indexStats;
            throw new Error('ENOENT: /dashboard not found');
        });
        vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('<html>SPA</html>'));

        const res = await nodeAssetsFetch(req, mockOptions);

        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe('<html>SPA</html>');
    });

    it('should handle race condition (file deleted between stat and read)', async () => {
        const req = new Request('http://localhost/config.json');
        const mockStats = { isFile: () => true, isDirectory: () => false } as fs.Stats;

        vi.mocked(fs.statSync).mockReturnValue(mockStats);
        // Simulate file disappearance during read
        vi.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error('ENOENT: file gone');
        });

        const res = await nodeAssetsFetch(req, mockOptions);

        expect(res.status).toBe(500);
        const text = await res.text();
        expect(text).toBe('Access Failed');
    });

    it('should return 404 WITHOUT fallback for API paths', async () => {
        // API 请求必须直通后端，不允许被静态服务器拦截并回退 index.html
        const req = new Request('http://localhost/api/auth/providers');
        const res = await nodeAssetsFetch(req, mockOptions);

        expect(res.status).toBe(404);
    });
});
