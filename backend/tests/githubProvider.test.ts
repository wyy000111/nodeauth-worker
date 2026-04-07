import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GithubProvider } from '@/features/backup/providers/githubProvider';

describe('GithubProvider - Red/Green TDD Cases', () => {
    let provider: GithubProvider;
    const mockConfig = {
        token: 'ghp_test_token_123',
        owner: 'test_owner',
        repo: 'test_repo',
        branch: 'main',
        saveDir: '/nodeauth-backup'
    };

    beforeEach(() => {
        provider = new GithubProvider(mockConfig);
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ---------------- Happy Path ---------------- 

    it('[HP2] should test connection successfully (Green: 200 OK)', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ id: 12345, name: 'test_repo' })
        } as Response);

        const result = await provider.testConnection();
        expect(result).toBe(true);
        expect(fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/test_owner/test_repo',
            expect.any(Object)
        );
    });

    it('[HP3] should upload encrypted backup data properly with base64 encoding', async () => {
        // Mock 1: pre-flight check for sha (returns 404 to simulate new file)
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Not Found' })
        } as Response);

        // Mock 2: the actual PUT request
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({ content: { name: 'test-backup.json' } })
        } as Response);

        const rawData = '{"encrypted":true,"data":"abc"}';
        await provider.uploadBackup('test-backup.json', rawData);

        expect(fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/test_owner/test_repo/contents/nodeauth-backup/test-backup.json',
            expect.objectContaining({
                method: 'PUT',
                body: expect.stringContaining(Buffer.from(rawData).toString('base64'))
            })
        );
    });

    it('[HP4] should fetch and parse remote backup list correctly', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ([{
                name: 'backup1.json',
                size: 1024,
                type: 'file',
                path: 'nodeauth-backup/backup1.json',
                sha: 'sha1'
            }])
        } as Response);

        // Mocking the commit history fetch for accurate dates (optional, but good for listing)
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ([{ commit: { author: { date: '2026-04-06T12:00:00Z' } } }])
        } as Response);

        const list = await provider.listBackups();
        expect(list.length).toBe(1);
        expect(list[0].filename).toBe('backup1.json');
        expect(list[0].size).toBe(1024);
        expect(list[0].lastModified).toBeDefined();
    });

    it('[HP5] should download and decrypt data seamlessly', async () => {
        const rawContent = 'my-secret-content';
        const base64Content = Buffer.from(rawContent).toString('base64');

        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ content: base64Content, encoding: 'base64' })
        } as Response);

        const data = await provider.downloadBackup('backup1.json');
        expect(data).toBe(rawContent);
    });

    // ---------------- Edge Cases ---------------- 

    it('[EC1] should intercept PAT revoked or expired errors (401)', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({ message: 'Bad credentials' })
        } as Response);

        await expect(provider.testConnection()).rejects.toThrowError('oauth_token_revoked');
    });

    it('[EC2] should handle missing repo or permissions gracefully (403/404)', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Not Found' })
        } as Response);

        await expect(provider.testConnection()).rejects.toThrowError('Not Found');
    });

    it('[EC3] should handle file overwrite correctly by bringing existing SHA during upload', async () => {
        // Step 1: Pre-flight check says file exists (Return 200 with sha)
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ sha: 'old_sha_123' })
        } as Response);

        // Step 2: Upload PUT API call uses the old SHA
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ content: {} })
        } as Response);

        await provider.uploadBackup('existing-file.json', 'data');

        expect(fetch).toHaveBeenNthCalledWith(2,
            expect.any(String),
            expect.objectContaining({
                method: 'PUT',
                body: expect.stringContaining('"sha":"old_sha_123"')
            })
        );
    });

    it('[EC4] should efficiently process very large payloads without V8 memory crash', async () => {
        // Generate a synthetic 10MB payload mimicking a huge vault string
        const largeString = 'A'.repeat(10 * 1024 * 1024);

        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({})
        } as Response);

        // Should not throw OOM or timeout (simulated via jest/vitest limits)
        await provider.uploadBackup('huge-backup.json', largeString);
        expect(fetch).toHaveBeenCalled();
    });
});
