import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * useTotpTimer Composable - 全局心跳时钟测试
 * 
 * 核心目标：
 * 验证 TOTP 倒计时器 (Progress Bar) 的同步精度与单例行为。
 * 这是 2FA 金库的“心跳”，必须确保整个应用共享同一个时钟。
 * 
 * 关键逻辑点：
 * 1. 单例模式 (Singleton)：多个订阅者必须复用同一个 setInterval 实例。
 * 2. 引用计数 (Ref Counting)：当最后一个订阅者销毁时，必须自动清理 Timer，防止内存泄漏。
 * 3. 精度同步：currentTime 应每秒 update 一次，并基于本地系统时钟进行对齐。
 */

// --- 模块模拟 ---
// 使用 Vitest 环境自带的 Vue，不再手动 mock 以保持 ref 的行为一致

vi.mock('@/shared/utils/totp', () => ({
    getAccurateTime: vi.fn(() => Date.now())
}))

describe('useTotpTimer Composable - Singleton Heartbeat Test', () => {
    let getAccurateTime;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();

        // 强制重新导入模块以测试单例初始化过程
        const totpModule = await import('@/shared/utils/totp');
        getAccurateTime = totpModule.getAccurateTime;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * Case 01: 准确的初始时间
     * 目标：验证冷启动。
     */
    it('should initialize currentTime with accurate system time', async () => {
        getAccurateTime.mockReturnValue(12345678);
        const module = await import('@/features/vault/composables/useTotpTimer');

        const { currentTime, startTimer } = module.useTotpTimer();
        startTimer(); // 必须调用以触发 initialized 逻辑

        expect(Math.floor(currentTime.value)).toBe(Math.floor(12345678 / 1000));
    });

    /**
     * Case 02: 定时触发更新
     * 解决问题：确保每隔 1000ms 都会触发一次 currentTime 的递增，驱动 UI 上的进度条和验证码刷新。
     */
    it('should start a global timer and update currentTime after interval', async () => {
        const module = await import('@/features/vault/composables/useTotpTimer');
        const { currentTime, startTimer } = module.useTotpTimer();

        getAccurateTime.mockReturnValue(10000000);
        startTimer();
        expect(currentTime.value).toBe(10000);

        // 模拟时间流逝 1 秒
        getAccurateTime.mockReturnValue(11000000);
        vi.advanceTimersByTime(1000);
        expect(currentTime.value).toBe(11000);
    });

    /**
     * Case 03: 全局单例行为
     * 解决问题：即使多个组件同时调用 startTimer()，系统也仅创建一个 setInterval 实例。
     */
    it('should handle multiple subscribers correctly', async () => {
        const spySet = vi.spyOn(global, 'setInterval');
        const module = await import('@/features/vault/composables/useTotpTimer');

        const { startTimer: start1 } = module.useTotpTimer();
        const { startTimer: start2 } = module.useTotpTimer();

        start1();
        start2();

        expect(spySet).toHaveBeenCalledTimes(1);
    });

    /**
     * Case 04: 资源自动清理
     * 解决问题：当最后一个订阅者走了，彻底关停定时器。
     */
    it('should stop the global timer when all subscribers are gone', async () => {
        const spyClear = vi.spyOn(global, 'clearInterval');
        const module = await import('@/features/vault/composables/useTotpTimer');

        const { startTimer: start1, stopTimer: stop1 } = module.useTotpTimer();
        const { startTimer: start2, stopTimer: stop2 } = module.useTotpTimer();

        start1();
        start2();

        stop1();
        expect(spyClear).not.toHaveBeenCalled();

        stop2();
        expect(spyClear).toHaveBeenCalled();
    });
});
