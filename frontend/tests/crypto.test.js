import { describe, it, expect, vi } from 'vitest'
import { encryptDataWithPassword, decryptDataWithPassword } from '@/shared/utils/crypto'
import { webcrypto } from 'node:crypto'

/**
 * 加解密核心 (Cryptography Engine) 单元测试
 * 
 * 核心目标：
 * 验证 Web Crypto API 在当前浏览器环境下的原生执行力。
 * 解决 2FA 金库最核心的安全诉求：在本地环境下安全地存储和还原敏感密钥。
 * 
 * 重点验证：
 * 1. AES-GCM 256 位加密的一致性 (Consistency)。
 * 2. 只有正确密码才能解锁数据 (Authentication)。
 * 3. 任何细微的数据篡改都能被即时发现 (Anti-Tampering)。
 */

// 💡 TDD 技巧：在 Node 环境下注入 Web Crypto API 以对齐浏览器行为
if (!globalThis.crypto) {
    vi.stubGlobal('crypto', webcrypto)
}

describe('Crypto Utilities - Vault Security', () => {

    const password = 'my-secret-pin'
    const sensitiveData = {
        vault: [
            { id: '1', secret: 'S1', service: 'Google' },
            { id: '2', secret: 'S2', service: 'GitHub' }
        ]
    }

    /**
     * Case 01: 标准加解密业务流
     * 目标：验证数据在加密后再解密能 100% 还原。
     * 解决问题：确保复杂的 JSON 对象在序列化、Base64 编码、加密、再反序列化的全链路中不产生成员丢失或字符乱码。
     */
    it('should encrypt and decrypt data correctly', async () => {
        const encrypted = await encryptDataWithPassword(sensitiveData, password)
        expect(typeof encrypted).toBe('string') // 密文应为 Base64 字符串以便存储

        const decrypted = await decryptDataWithPassword(encrypted, password)
        expect(decrypted).toEqual(sensitiveData)
        expect(decrypted.vault[0].service).toBe('Google')
    })

    /**
     * Case 02: 错误凭据拦截
     * 目标：验证解密失败时的异常安全性。
     * 解决问题：确保当用户输入错误 PIN 码时，系统能准确抛出可识别的错误，而不是解密出乱码或导致程序崩溃。
     */
    it('should throw error for incorrect password', async () => {
        const encrypted = await encryptDataWithPassword(sensitiveData, password)

        // 故意用错密码进行解锁
        await expect(decryptDataWithPassword(encrypted, 'wrong-password'))
            .rejects
            .toThrow('密码错误或数据损坏')
    })

    /**
     * Case 03: 数据篡改检测 (AES-GCM 核心特性)
     * 目标：利用 AEAD 算法的 Auth Tag 验证数据完整性。
     * 解决问题：防止黑客或损坏的磁盘扇区修改了存储中的密文。由于 AES-GCM 包含认证标签，密文哪怕被修改了 1 个位，解密也会失败抛错。
     */
    it('should detect data tampering', async () => {
        const encrypted = await encryptDataWithPassword(sensitiveData, password)

        // 模拟密文在存储中被恶意修改了一个字符 (例如修改 Base64 字符串的中间段)
        const tampered = encrypted.substring(0, 50) + 'X' + encrypted.substring(51)

        await expect(decryptDataWithPassword(tampered, password))
            .rejects
            .toThrow('密码错误或数据损坏')
    })

    /**
     * Case 04: 大数据量性能与稳定性测试
     * 目标：验证算法在处理大型金库时的可靠性。
     * 解决问题：确保加密逻辑在处理包含数百项账号的长 JSON 时不会溢出内存或出现截断问题。
     */
    it('should handle large data sets', async () => {
        const largeData = {
            items: Array.from({ length: 100 }, (_, i) => ({ id: i, data: 'content-' + i }))
        }
        const encrypted = await encryptDataWithPassword(largeData, password)
        const decrypted = await decryptDataWithPassword(encrypted, password)
        expect(decrypted.items).toHaveLength(100)
    })
})
