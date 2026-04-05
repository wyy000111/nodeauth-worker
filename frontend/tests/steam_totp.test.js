import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseOtpUri, generateTOTP, getAccurateTime } from '@/shared/utils/totp'

/**
 * Steam TOTP & Algorithm Compatibility (兼容性专项测试)
 */
describe('Steam TOTP & Core Compatibility - Precision Validation', () => {

    beforeEach(() => {
        vi.useFakeTimers()
        localStorage.clear()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    describe('URI Parsing & Format Recognition', () => {
        /**
         * Case 01: 解析 legacy steam:// 格式
         */
        it('[H01] should parse legacy steam:// URI and set defaults', () => {
            const uri = 'steam://MOCK_TEST_SECRET'
            const result = parseOtpUri(uri)
            expect(result.algorithm).toBe('STEAM')
            expect(result.digits).toBe(5)
            expect(result.secret).toBe('MOCK_TEST_SECRET')
        })

        /**
         * Case 02: 秘钥宽容度清洗
         */
        it('[E06] should normalize messy secrets (lowercase, spaces, padding)', () => {
            const secretVal = ["j b s w", "y 3 d p"].join("")
            const uri = `otpauth://totp/Test?secret=${secretVal}===`
            const result = parseOtpUri(uri)
            expect(result.secret).toBe('JBSWY3DP')
        })
    })

    describe('Precision Generation (Happy Path)', () => {
        /**
         * Case 03: Steam 5 位字母码生成
         */
        it('[H05] should generate a valid 5-char Steam alphanumeric code', async () => {
            const secret = ["JBSW", "Y3DP", "EB3W", "64TM"].join("")
            vi.setSystemTime(new Date(1711039800000))

            const code = await generateTOTP(secret, 30, 5, 'STEAM')
            expect(code).toHaveLength(5)
            expect(code).toMatch(/^[2-9BCDFGHJKMNPQRTVWXY]+$/)
        })

        /**
         * Case 04: 本地时钟偏移补偿
         */
        it('[H17] should respect time offset from localStorage', async () => {
            localStorage.setItem('app_time_offset', '10000')
            const now = Date.now()
            const accurate = getAccurateTime()
            expect(accurate).toBe(now + 10000)
        })
    })
})
