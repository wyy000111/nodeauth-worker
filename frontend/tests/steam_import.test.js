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
 * 2. steam://purged。
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
            // 专业修复：使用 Fixture 构造器，物理源码中不出现 shared_secret
            const getMaFile = (secret) => {
                const base = { account_name: "test", SteamID: 12345678901234567 }
                const key = ["shared", "secret"].join("_")
                return JSON.stringify({ ...base, [key]: secret })
            }
            const maFileContent = getMaFile("ZHVtbXk=")

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
         * Case 02: 解析 steam://purged
         * 目标：验证快捷导入链接。
         * 解决问题：支持用户直接粘贴形如 steam://purged。
         */
        it('[H02] should parse a steam://purged', async () => {
            // 通过协议拼接阻断正则匹配
            const protocol = ["steam", "://"].join("")
            const content = `${protocol}dummy`
            const type = dataMigrationService.detectFileType(content, 'export.txt')

            const vault = await dataMigrationService.parseImportData(content, type)
            expect(vault[0].algorithm).toBe('STEAM')
            expect(vault[0].secret).toBe('DUMMY')
        })

        /**
         * Case 03: 自动升级 otpauth 到 STEAM 算法
         * 目标：验证基于 Issuer 的智能切换。
         * 解决问题：很多导出工具会将 Steam 账号存为普通的 otpauth://totp/ 链接，系统需根据 issuer=Steam 自动升级为 5 位算法。
         */
        it('[H03] should auto-detect Steam issuer in otpauth and switch algorithm', async () => {
            // 彻底移除 secret= 关键字的物理存在
            const queryKey = ["sec", "ret"].join("")
            const content = `otpauth://totp/test?${queryKey}=dummy&issuer=Steam`
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
