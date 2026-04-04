/**
 * TOTP 核心解析 (TOTP Protocol & Compatibility) 单元测试
 * 
 * 核心目标：
 * 验证对 RFC 6238 协议中 otpauth URI 的解析能力，以及对 Base32 密钥的清洗鲁棒性。
 * 重点：解决各家 2FA 导出器（如 Google, Microsoft, Steam）在字段格式上的非标差异。
 */
import { describe, it, expect } from 'vitest'
import { parseOtpUri, buildOtpUri, base32ToBytes, bytesToBase32 } from '@/shared/utils/totp'

describe('TOTP URI Compatibility - The "No-Broken-Account" Challenge', () => {

    /**
     * Case 01: 标准 Google 风格 URI 解析
     */
    it('should parse a standard URI from Google Authenticator', () => {
        const uri = 'otpauth://totp/mike@gmail.com?secret=JBSWY3DPEB3W64TM&issuer=Google'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('Google')
        expect(result.account).toBe('mike@gmail.com')
        expect(result.secret).toBe('JBSWY3DPEB3W64TM')
    })

    /**
     * Case 02: 官方 Steam 厂商协议适配
     */
    it('should identify Steam from issuer and apply algorithm STEAM', () => {
        const uri = 'otpauth://totp/Steam:yourusername?secret=JBSWY3DPEB3W64TM&issuer=Steam'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('Steam')
        expect(result.algorithm).toBe('STEAM')
        expect(result.digits).toBe(5)
    })

    /**
     * Case 03: Steam Legacy 协议支持 (steam://)
     */
    it('should handle legacy steam:// uris', () => {
        const uri = 'steam://JBSWY3DPEB3W64TM'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('Steam')
        expect(result.algorithm).toBe('STEAM')
        expect(result.secret).toBe('JBSWY3DPEB3W64TM')
    })

    /**
     * Case 04: 复合名称解析优化 (Multi-Colons)
     */
    it('should correctly separate service from account with multiple colons', () => {
        const uri = 'otpauth://totp/AcmeCloud:Production:Admin:Alice?secret=JBSWY3DPEB3W64TM'
        const result = parseOtpUri(uri)
        expect(result.service).toBe('AcmeCloud')
        expect(result.account).toBe('Production:Admin:Alice')
    })

    /**
     * Case 05: Base32 宽松清洗逻辑
     */
    it('should handle messy secrets with spaces, lowercase and equal signs', () => {
        const messyUri = 'otpauth://totp/App:User?secret=j b s w y 3 d p e b 3 w 6 4 t m ==&issuer=App'
        const result = parseOtpUri(messyUri)
        expect(result.secret).toBe('JBSWY3DPEB3W64TM')
    })

    it('should safely return null for invalid URIs', () => {
        expect(parseOtpUri('not-an-url')).toBeNull()
        expect(parseOtpUri('otpauth://totp/Missing-Secret')).toBeNull()
    })
})

describe('OTP URI Builder Integration', () => {
    /**
     * Case 06: 反向构建 URI 用于分享/导出
     */
    it('should build a standard URI correctly', () => {
        const data = {
            service: 'Google',
            account: 'bob@gmail.com',
            secret: 'JBSWY3DPEB3W64TM',
            algorithm: 'SHA-256',
            digits: 8,
            period: 60
        }
        const uri = buildOtpUri(data)
        expect(uri).toContain('otpauth://totp/')
        expect(uri).toContain('secret=JBSWY3DPEB3W64TM')
        expect(uri).toContain('algorithm=SHA256')
    })
})
