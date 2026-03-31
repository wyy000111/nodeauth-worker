/**
 * TOTP 核心解析 (TOTP Protocol & Compatibility) 单元测试
 * 
 * 核心目标：
 * 验证对 RFC 6238 协议中 otpauth URI 的解析能力，以及对 Base32 密钥的清洗鲁棒性。
 * 重点：解决各家 2FA 导出器（如 Google, Microsoft, Steam）在字段格式上的非标差异。
 * 
 * 核心挑战：
 * 1. Steam Guard 特有的 5 位数字与 Base32 填充差异。
 * 2. 各种奇怪的 Label 拼接方式（如多层冒号）。
 * 3. 输入时存在的空格、等号及大小写混乱。
 */
import { describe, it, expect } from 'vitest'
import { parseOtpUri, buildOtpUri, base32ToBytes, bytesToBase32 } from '@/shared/utils/totp'

describe('TOTP URI Compatibility - The "No-Broken-Account" Challenge', () => {

    /**
     * Case 01: 标准 Google 风格 URI 解析
     * 目标：验证通用 RFC 适配。
     * 解决问题：确保能够从标准二维码 URI 中提取 Service, Account 和 Secret，支撑基本的 2FA 功能。
     */
    it('should parse a standard URI from Google Authenticator', () => {
        const uri = 'otpauth://totp/Google:mike@gmail.com?secret=ABC&issuer=Google'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('Google')
        expect(result.account).toBe('mike@gmail.com')
        expect(result.secret).toBe('ABC')
    })

    /**
     * Case 02: 官方 Steam 厂商协议适配
     * 目标：验证 Steam Guard 专有逻辑。
     * 解决问题：Steam 不使用标准的 6 位数字，而是 5 位。通过识别 issuer=Steam 自动将算法切换为 STEAM，确保产生的 5 位字母验证码正确。
     */
    it('should identify Steam from issuer and apply algorithm STEAM', () => {
        const uri = 'otpauth://totp/Steam:yourusername?secret=ABC&issuer=Steam'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('Steam')
        expect(result.algorithm).toBe('STEAM')
        expect(result.digits).toBe(5)
    })

    /**
     * Case 03: Steam Legacy 协议支持 (steam://)
     * 目标：兼容旧版导出。
     * 解决问题：有些旧版导出工具直接导出 steam:// 链接，解析器应能识别并转换为内部的 Steam 配置。
     */
    it('should handle steam:// legacy protocol', () => {
        const uri = 'steam://ABC'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('Steam')
        expect(result.algorithm).toBe('STEAM')
        expect(result.secret).toBe('ABC')
    })

    /**
     * Case 04: 复合名称解析优化 (Multi-Colons)
     * 目标：解决多层品牌嵌套问题。
     * 解决问题：有些企业系统（如 Acme:Project:User）在 Label 中使用多冒号。解析器必须能智能切分，拿第一段做品牌名，剩余的做用户名。
     */
    it('should correctly separate service from account with multiple colons', () => {
        const uri = 'otpauth://totp/AcmeCloud:Production:Admin:Alice?secret=ABC'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('AcmeCloud')
        expect(result.account).toBe('Production:Admin:Alice')
    })

    /**
     * Case 05: Base32 宽松清洗逻辑
     * 目标：验证输入容错。
     * 解决问题：用户手动输入 Secret 时可能会带空格、小写字母或末尾缺失等号。解析器应在处理前自动进行标准化清洗，防止 Base32 解码失败。
     */
    it('should handle messy secrets with spaces, lowercase and equal signs', () => {
        const messyUri = 'otpauth://totp/App?secret=a b c ==&issuer=App'
        const result = parseOtpUri(messyUri)
        // 预期产出：全大写、无空格、原始 Secret
        expect(result.secret).toBe('ABC')
    })

    it('should safely return null for invalid URIs', () => {
        expect(parseOtpUri('not-an-url')).toBeNull()
        expect(parseOtpUri('otpauth://totp/Label-Missing-Secret')).toBeNull()
    })
})

describe('OTP URI Builder Integration', () => {
    /**
     * Case 06: 反向构建 URI 用于分享/导出
     * 目标：验证双向转换对称性。
     * 解决问题：确保导出的 URI 符合标准格式，以便其他 2FA 软件能顺利导入本软件生成的数据。
     */
    it('should build a standard URI correctly', () => {
        const data = {
            service: 'Google',
            account: 'bob@gmail.com',
            secret: 'ABC',
            algorithm: 'SHA-256',
            digits: 8,
            period: 60
        }
        const uri = buildOtpUri(data)
        expect(uri).toContain('otpauth://totp/Google%3Abob%40gmail.com')
        expect(uri).toContain('secret=ABC')
        expect(uri).toContain('algorithm=SHA256')
    })
})

describe('Base32 Hardening (底层健壮性)', () => {
    /**
     * Case 07: Base32 Padding 兼容性
     * 解决问题：某些库生成的 Base32 没有等号填充。本系统的解码逻辑应能自动补全或忽略多余等号，确保解密结果一致。
     */
    it('should handle padding gracefully', () => {
        const raw = 'abc'
        const bytes = new TextEncoder().encode(raw)
        const encoded = bytesToBase32(bytes)
        expect(Array.from(base32ToBytes(encoded + '===='))).toEqual(Array.from(bytes))
    })
})
