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
 * 3. 精度同步：currentTime 应每秒更新一次，并基于本地系统时钟进行对齐。
 */

// --- 模块模拟 ---
vi.mock('vue', () => ({
    ref: (val) => ({ value: val })
}))

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
        getAccurateTime.mockReturnValue(12345000);
        const module = await import('@/features/vault/composables/useTotpTimer');

        const { currentTime } = module.useTotpTimer();
        expect(currentTime.value).toBe(12345); // 时间戳转秒
    });

    /**
     * Case 02: 定时触发更新
     * 目标：验证时钟步进。
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
     * 目标：防止重复创建定时器。
     * 解决问题：即使金库列表、搜索结果等多个组件同时调用 startTimer()，系统也仅创建一个 setInterval 实例，降低能耗。
     */
    it('should handle multiple subscribers correctly', async () => {
        const spySet = vi.spyOn(global, 'setInterval');
        const module = await import('@/features/vault/composables/useTotpTimer');

        const { startTimer: start1 } = module.useTotpTimer();
        const { startTimer: start2 } = module.useTotpTimer();

        start1();
        start2();

        expect(spySet).toHaveBeenCalledTimes(1); // 必须是 1 次
    });

    /**
     * Case 04: 资源自动清理
     * 目标：引用计数清理。
     * 解决问题：当用户登出或所有会用到倒计时的组件都卸载后，必须 clearInterval 停止心跳。
     */
    it('should stop the global timer when all subscribers are gone', async () => {
        const spyClear = vi.spyOn(global, 'clearInterval');
        const module = await import('@/features/vault/composables/useTotpTimer');

        const { startTimer: start1, stopTimer: stop1 } = module.useTotpTimer();
        const { startTimer: start2, stopTimer: stop2 } = module.useTotpTimer();

        start1();
        start2();

        stop1();
        expect(spyClear).not.toHaveBeenCalled(); // 只要有一个还在用，就不清

        stop2();
        expect(spyClear).toHaveBeenCalled(); // 最后一个走了，彻底关停
    });
});
