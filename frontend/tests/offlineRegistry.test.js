import { describe, it, expect, vi } from 'vitest'
import { OFFLINE_RESOURCES, loadResource } from '@/shared/services/offlineRegistry'

describe('OfflineRegistry - 中心化资源注册表测试', () => {
    it('应该包含所有核心类别的配置', () => {
        expect(OFFLINE_RESOURCES).toHaveProperty('SECURITY')
        expect(OFFLINE_RESOURCES).toHaveProperty('UTILITIES')
        expect(OFFLINE_RESOURCES).toHaveProperty('ENGINES')
    })

    it('SECURITY 类别应包含关键加密库', () => {
        const securityNames = OFFLINE_RESOURCES.SECURITY.map(r => r.name)
        expect(securityNames).toContain('openpgp')
        expect(securityNames).toContain('libsodium')
        expect(securityNames).toContain('hash-wasm')
    })

    it('所有资源必须定义用于 Cache 探测的 probe 关键字', () => {
        const allResources = [
            ...OFFLINE_RESOURCES.SECURITY,
            ...OFFLINE_RESOURCES.UTILITIES,
            ...OFFLINE_RESOURCES.ENGINES
        ]
        allResources.forEach(res => {
            const probe = res.probe || res.probes;
            expect(probe).toBeDefined();

            if (Array.isArray(probe)) {
                expect(probe.length).toBeGreaterThan(0);
                expect(typeof probe[0]).toBe('string');
            } else {
                expect(typeof probe).toBe('string');
                expect(probe.length).toBeGreaterThan(0);
            }
        })
    })

    it('loadResource 应该能够正确调起库的 loader', async () => {
        // 模拟一个 loader
        const mockModule = { dummy: 'data' }
        const targetResource = OFFLINE_RESOURCES.SECURITY[0]
        const originalLoader = targetResource.loader
        targetResource.loader = vi.fn().mockResolvedValue(mockModule)

        const result = await loadResource(targetResource.name)
        expect(targetResource.loader).toHaveBeenCalled()
        expect(result).toEqual(mockModule)

        // 还原 loader
        targetResource.loader = originalLoader
    })

    it('加载不存在的资源应该抛出错误', async () => {
        await expect(loadResource('non-existent')).rejects.toThrow('not found in registry')
    })
})
