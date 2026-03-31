/**
 * 环境冒烟测试 (Environment Smoke Test)
 * 
 * 核心目标：
 * 验证测试架构 (Vitest + JSDOM + Pinia) 基础环境的可用性。
 * 如果此测试失败，代表 Node 环境或配置文件存在严重缺陷，所有的业务测试均不可信。
 */
import { describe, it, expect } from 'vitest'

describe('Base Environment Health Test', () => {
    /**
     * 基础数学与断言库校验
     */
    it('shoud pass simple addition (Runtime Check)', () => {
        expect(1 + 1).toBe(2)
    })

    /**
     * DOM 环境可用性校验 (JSDOM Check)
     */
    it('should have access to global navigator in JSDOM', () => {
        expect(navigator).toBeDefined()
    })
})
