/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppLockStore } from '../src/features/applock/store/appLockStore'
import * as idb from '../src/shared/utils/idb'

// Mock Security Service
vi.mock('../src/features/applock/service/appLockService', () => ({
    appLockService: {
        generateSalt: vi.fn(() => new Uint8Array(16)),
        deriveKeyFromPin: vi.fn(() => ({})),
        encryptDeviceSalt: vi.fn(async () => ({ encrypted: new Uint8Array(20), iv: new Uint8Array(12), salt: new Uint8Array(16) })),
        decryptDeviceSalt: vi.fn(async (enc, iv, key) => {
            if (enc?.length === 10 || enc === 'WRONG') return null
            return 'decrypted-salt'
        }),
        isBiometricSupported: vi.fn(() => true),
        isLegacyBiometricSupported: vi.fn(() => true),
        getBiometricKey: vi.fn(async () => new Uint8Array(32)),
        enrollBiometricCompatible: vi.fn(),
        verifyBiometricCompatible: vi.fn()
    }
}))

// Mock IDB
vi.mock('../src/shared/utils/idb', () => ({
    getIdbItem: vi.fn(),
    setIdbItem: vi.fn(),
    removeIdbItem: vi.fn()
}))

describe('App Security Lock (Hybrid Mode) - TDD Green Check', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
        localStorage.clear()

        globalThis.navigator.credentials = {
            get: vi.fn().mockResolvedValue({
                clientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(1) } } })
            }),
            create: vi.fn().mockResolvedValue({})
        }
    })

    describe('Happy Path', () => {
        it('should setup a 6-digit PIN correctly', async () => {
            const store = useAppLockStore()
            idb.getIdbItem.mockResolvedValue('raw-salt')
            await store.setupPin('123456')
            expect(store.lockMode).toBe('pin')
        })
    })

    describe('Scenario B: Fallback Flow', () => {
        it('should fallback to biometric_compat when PRF is unsupported', async () => {
            const store = useAppLockStore()
            const { appLockService } = await import('../src/features/applock/service/appLockService')

            appLockService.isBiometricSupported.mockReturnValue(false)
            appLockService.isLegacyBiometricSupported.mockReturnValue(true)
            appLockService.enrollBiometricCompatible.mockResolvedValue('cred-id')
            appLockService.encryptDeviceSalt.mockResolvedValue({ encrypted: 'ENC', iv: 'iv' })

            store.memorySalt = 'salt'
            await store.enableBiometric()

            expect(store.lockMode).toBe('biometric_compat')
        })

        it('should unlock successfully via compatible verification', async () => {
            const store = useAppLockStore()
            const { appLockService } = await import('../src/features/applock/service/appLockService')

            store.lockMode = 'biometric_compat'
            store.isLocked = true

            idb.getIdbItem.mockImplementation((key) => {
                if (key === 'sys:sec:bio_wrap_key') return new Uint8Array(32).fill(2)
                if (key === 'sys:sec:bio_enc_salt') return { encrypted: 'ENC', iv: 'iv' }
                if (key === 'sys:sec:bio_cred_id') return 'compat-cred-id'
                return null
            })


            appLockService.verifyBiometricCompatible.mockResolvedValue(true)
            appLockService.decryptDeviceSalt.mockResolvedValue('raw')

            await store.unlockWithBiometric()
            expect(store.isLocked).toBe(false)
        })
    })

    describe('Brute Force Protections', () => {
        it('should block unlock attempt if 3 fails occurred in 30s', async () => {
            const store = useAppLockStore()
            const { appLockService } = await import('../src/features/applock/service/appLockService')

            store.lockMode = 'pin'
            store.isLocked = true
            idb.getIdbItem.mockResolvedValue({ encrypted: 'WRONG' })

            // 模拟连续解密失败
            appLockService.decryptDeviceSalt.mockResolvedValue(null)

            // 1. 执行 3 次失败
            await store.unlockWithPin('000000')
            await store.unlockWithPin('000000')
            await store.unlockWithPin('000000')

            expect(store.failedAttempts).toBe(3)

            // 2. 第 4 次应立即抛出阻断异常
            await expect(store.unlockWithPin('123456')).rejects.toThrow('Too many attempts')
        })
    })
})
