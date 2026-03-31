import { describe, it, expect, vi } from 'vitest'

/**
 * Steam Token Import (Steam 专有格式导入) 专项测试
 * 
 * 核心目标：
 * 验证对 Steam 平台非标 2FA 协议的深度兼容性。
 * Steam 不使用 RFC 6238 的标准 6 位数字，而是使用 Base32 编码的 5 位字母，且有专有的 JSON 导出格式 (SDA)。
 * 
 * 重点验证：
 * 1. .maFile (Steam Desktop Authenticator) 的原理解析。
 * 2. steam:// 协议链接的手动导入。
 * 3. 从通用 2FAS/Google 导出的 Steam 项中自动识别并切换 5 位算法。
 */

// 模拟大型加密逻辑以加快测试速度
vi.mock('@/shared/utils/serializers/protonPassStrategy', () => ({
    protonPassStrategy: {}
}))

import { dataMigrationService } from '@/features/migration/service/dataMigrationService'

describe('Steam Token Import TDD Matrix', () => {

    describe('Happy Path: Steam Specific Formats', () => {

        /**
         * Case 01: 解析 SDA 的 .maFile 格式
         * 目标：验证 Steam 桌面验证器导出的 JSON。
         * 解决问题：Steam 的 .maFile 包含 shared_secret 和 SteamID，系统需将其提取并重新编码为 Base32 以便内部计算 TOTP。
         */
        it('[H01] should parse a valid SDA .maFile JSON', async () => {
            const maFileContent = JSON.stringify({
                "shared_secret": "dummY",
                "account_name": "test",
                "SteamID": 12345678901234567
            })

            // 1. 验证文件类型自动识别逻辑
            const type = dataMigrationService.detectFileType(maFileContent, '12345678901234567.maFile')
            expect(type).toBe('steam_mafile')

            // 2. 验证解析后的字段映射
            const vault = await dataMigrationService.parseImportData(maFileContent, type)
            expect(vault).toHaveLength(1)
            expect(vault[0].service).toBe('Steam')
            expect(vault[0].algorithm).toBe('STEAM') // 关键：必须自动设为 STEAM 算法
            expect(vault[0].digits).toBe(5)          // 关键：Steam 必须是 5 位
        })

        /**
         * Case 02: 解析 steam:// 协议文本
         * 目标：验证快捷导入链接。
         * 解决问题：支持用户直接粘贴形如 steam://SECRET 的链接快速添加 Steam 账号。
         */
        it('[H02] should parse a steam:// URI from text', async () => {
            const content = 'steam://dummy'
            const type = dataMigrationService.detectFileType(content, 'export.txt')

            const vault = await dataMigrationService.parseImportData(content, type)
            expect(vault[0].algorithm).toBe('STEAM')
            expect(vault[0].secret).toBe('dummy')
        })

        /**
         * Case 03: 自动升级 otpauth 到 STEAM 算法
         * 目标：验证基于 Issuer 的智能切换。
         * 解决问题：很多导出工具会将 Steam 账号存为普通的 otpauth://，导致导入后 6 位验证码失效。系统需根据 issuer=Steam 自动升级为 5 位算法。
         */
        it('[H03] should auto-detect Steam issuer in otpauth and switch algorithm', async () => {
            const content = 'otpauth://totp/Steam:test?secret=dummy&issuer=Steam'
            const vault = await dataMigrationService.parseImportData(content, 'generic_text')
            expect(vault[0].algorithm).toBe('STEAM')
            expect(vault[0].digits).toBe(5)
        })
    })

    describe('Edge Cases: 异常与稳健性', () => {
        /**
         * Case 04: 文件损坏/字段缺失拦截
         * 解决问题：如果 maFile 损坏或丢失了 shared_secret，应明确提示用户“找不到密钥”，而不是产生一个无效的空账号。
         */
        it('[E01] should report error for malformed maFile (missing shared_secret)', async () => {
            const badMaFile = JSON.stringify({ account_name: "oops" })
            const type = dataMigrationService.detectFileType(badMaFile, 'bad.maFile')

            await expect(dataMigrationService.parseImportData(badMaFile, type))
                .rejects.toThrow(/(missing shared_secret|找不到 shared_secret)/i)
        })
    })
})
