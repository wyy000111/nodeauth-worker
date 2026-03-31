import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseOtpUri, generateTOTP, getAccurateTime } from '@/shared/utils/totp'

/**
 * Steam TOTP & Algorithm Compatibility (兼容性专项测试)
 * 
 * 核心目标：
 * 验证对 Steam Guard 特种 5 位字母算法的精度和各类 URI 格式的鲁棒性解析。
 * 
 * 验证重点：
 * 1. steam:// 链接深度解析：自动设置 Issuer 为 Steam，算法为 STEAM。
 * 2. 5 位字母码生成 (Alphabetical Code)：验证代码是否符合 Steam 的 26 个候选字符规范。
 * 3. 时钟偏置修正 (Time Drift)：验证在离线态下，即便服务器时钟与本地不符，通过 app_time_offset 修正后的验证码依然有效。
 * 4. 脏数据清洗：验证秘钥中的空格、小写字母、等号（Padding）能否被自动清洗为 RFC 3548 标准格式。
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
         * Case 01: 解析 steam:// 协议
         * 解决问题：支持这种 Steam 特有的短链接，直接设为 5 位算法。
         */
        it('[H01] should parse steam:// URI and set defaults', () => {
            const uri = 'steam://ABC'
            const result = parseOtpUri(uri)
            expect(result.algorithm).toBe('STEAM')
            expect(result.digits).toBe(5)
        })

        /**
         * Case 02: 秘钥宽容度清洗
         * 解决问题：用户手动输入或粘贴的密钥经常带空格或小写，系统必须能自我修复，否则生成的是错误 Code。
         */
        it('[E06] should normalize messy secrets (lowercase, spaces, padding)', () => {
            const uri = 'otpauth://totp/Test?secret=a b c ==='
            const result = parseOtpUri(uri)
            expect(result.secret).toBe('ABC')
        })
    })

    describe('Precision Generation (Happy Path)', () => {
        /**
         * Case 03: Steam 5 位字母码生成
         * 目标：验证非数字生成。
         * 解决问题：Steam 的 2FA 码不是数字。此项必须确保在特定时间戳下生成的字符完全符合 Steam 协议。
         */
        it('[H05] should generate a valid 5-char Steam alphanumeric code', async () => {
            const secret = 'ABC'
            // 固定时间戳：1711039800 (Epoch)
            vi.setSystemTime(new Date(1711039800000))

            const code = await generateTOTP(secret, 30, 5, 'STEAM')
            expect(code).toHaveLength(5)
            // 验证是否仅由 Steam 指定的字母/数字组成
            expect(code).toMatch(/^[2-9BCDFGHJKMNPQRTVWXY]+$/)
        })

        /**
         * Case 04: 本地时钟偏移补偿
         * 目标：提高登录成功率。
         * 解决问题：PWA 在离线或弱网下，可能通过 HTTP Header 探测到 10s 的时差，并存入 LocalStorage。Code 生成器必须应用此偏移，防止验证码失效。
         */
        it('[H17] should respect time offset from localStorage', async () => {
            localStorage.setItem('app_time_offset', '10000') // 手动偏置 10s
            const now = Date.now()
            const accurate = getAccurateTime()
            expect(accurate).toBe(now + 10000)
        })
    })
})
