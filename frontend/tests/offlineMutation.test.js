import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// 1. Mock 依赖
vi.mock('@/shared/utils/request', () => ({
    request: vi.fn()
}));

const mockSyncQueue = [];
vi.mock('@/features/vault/store/vaultSyncStore', () => ({
    useVaultSyncStore: () => ({
        enqueueAction: vi.fn().mockImplementation((type, id, data) => {
            mockSyncQueue.push({ type, id, data });
        })
    })
}));

// Mock vaultStore
vi.mock('@/features/vault/store/vaultStore', () => ({
    useVaultStore: () => ({
        getData: vi.fn(),
        saveData: vi.fn()
    })
}));

describe('Vault Offline Mutation Logic (金库离线写入逻辑验证)', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mockSyncQueue.length = 0;
        localStorage.clear();

        // 默认让网络在线
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: true
        });
    });

    it('Scenario 1: 物理在线 + 系统“离线模式”开启 -> 应当拦截请求并进入本地队列', async () => {
        const { vaultService } = await import('@/features/vault/service/vaultService');
        const { request } = await import('@/shared/utils/request');

        // 模拟开启离线模式
        localStorage.setItem('app_offline_mode', 'true');

        const testData = { service: 'Test', account: 'test@example.com', secret: 'ABC' };
        const result = await vaultService.createAccount(testData);

        // A. 验证请求未发出
        expect(request).not.toHaveBeenCalled();

        // B. 验证动作已入队
        expect(mockSyncQueue.length).toBe(1);
        expect(mockSyncQueue[0].type).toBe('create');
        expect(mockSyncQueue[0].data).toEqual(testData);

        // C. 验证返回状态为 pending
        expect(result.pending).toBe(true);
    });

    it('Scenario 2: 物理断网 (onLine=false) -> 应当直接进入本地队列', async () => {
        const { vaultService } = await import('@/features/vault/service/vaultService');
        const { request } = await import('@/shared/utils/request');

        // 模拟物理断网
        Object.defineProperty(navigator, 'onLine', { value: false });
        localStorage.setItem('app_offline_mode', 'false');

        const testData = { service: 'NetworkOff', account: 'offline@test.com' };
        await vaultService.createAccount(testData);

        expect(request).not.toHaveBeenCalled();
        expect(mockSyncQueue.length).toBe(1);
    });

    it('Scenario 3: 正常模式 -> 应当调用网络请求', async () => {
        const { vaultService } = await import('@/features/vault/service/vaultService');
        const { request } = await import('@/shared/utils/request');

        localStorage.setItem('app_offline_mode', 'false');
        vi.mocked(request).mockResolvedValue({ success: true, id: 'real-123' });

        const testData = { service: 'Online', account: 'online@test.com' };
        const result = await vaultService.createAccount(testData);

        expect(request).toHaveBeenCalledWith('/api/vault', expect.objectContaining({ method: 'POST' }));
        expect(mockSyncQueue.length).toBe(0);
        expect(result.id).toBe('real-123');
    });

    it('Scenario 4: 更新操作 (Update) 在离线模式下同样应入队', async () => {
        const { vaultService } = await import('@/features/vault/service/vaultService');
        localStorage.setItem('app_offline_mode', 'true');

        await vaultService.updateAccount('id-123', { service: 'Updated' });

        expect(mockSyncQueue.length).toBe(1);
        expect(mockSyncQueue[0].type).toBe('update');
        expect(mockSyncQueue[0].id).toBe('id-123');
    });

    it('Scenario 5: 删除操作 (Delete) 在离线模式下同样应入队', async () => {
        const { vaultService } = await import('@/features/vault/service/vaultService');
        localStorage.setItem('app_offline_mode', 'true');

        await vaultService.deleteAccount('id-delete');

        expect(mockSyncQueue.length).toBe(1);
        expect(mockSyncQueue[0].type).toBe('delete');
        expect(mockSyncQueue[0].id).toBe('id-delete');
    });
});
