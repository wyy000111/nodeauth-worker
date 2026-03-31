import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestingPinia } from '@pinia/testing'
import devicesSettings from '@/features/settings/views/devicesSettings.vue'
import { sessionService } from '@/features/auth/service/sessionService'
import { ElMessageBox } from 'element-plus'

/**
 * Device Management (设备会话管理) 专项测试套件
 * 
 * 核心目标：
 * 验证多设备登录状态下的会话管理功能，确保用户能够查看并主动踢出其他设备。
 * 
 * 关键点：
 * 1. 列表渲染：解析 User-Agent 与 IP 信息的展示。
 * 2. 权限封锁：当前登录设备禁止自我踢出（防止由于自误操作导致的无法登陆）。
 * 3. 批量操作：一键登出所有其他设备。
 * 4. 安全回退：401 未授权自动重定向。
 */

vi.mock('@/features/auth/service/sessionService', () => ({
    sessionService: {
        getSessions: vi.fn(),
        deleteSession: vi.fn(),
        deleteAllOtherSessions: vi.fn()
    }
}));

// Mock Element-Plus 反馈组件
vi.mock('element-plus', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
        ElMessageBox: { confirm: vi.fn() }
    }
});

const mockRouter = { push: vi.fn() };
vi.mock('vue-router', () => ({ useRouter: () => mockRouter }));
vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (msg) => msg }),
    createI18n: () => ({ install: () => { } })
}));

describe('Device Management (Red/Green TDD)', () => {
    let wrapper;

    const mockSessions = [
        {
            id: 'session-1',
            deviceType: 'Chrome on Windows 10',
            friendlyName: 'Current Browser',
            ipAddress: '192.168.1.1',
            lastActiveAt: Date.now(),
            createdAt: Date.now() - 86400000,
            isCurrent: true
        },
        {
            id: 'session-2',
            deviceType: 'Firefox on macOS',
            friendlyName: 'Remote Laptop',
            ipAddress: '192.168.1.2',
            lastActiveAt: Date.now() - 3600000,
            createdAt: Date.now() - 186400000,
            isCurrent: false
        }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mountComponent = () => {
        return mount(devicesSettings, {
            global: {
                plugins: [createTestingPinia({ createSpy: vi.fn })],
                mocks: { $t: (msg) => msg },
                stubs: {
                    'el-icon': true, 'el-button': true, 'el-table': true,
                    'el-tag': true, 'el-empty': true, 'el-card': true,
                    'el-tooltip': { template: '<div><slot /></div>' }
                }
            }
        });
    };

    describe('1. 正常路径 (Happy Path)', () => {
        /**
         * Case 01: 会话列表渲染
         * 目标：正确识别并展示多条设备线索。
         */
        it('[正确渲染列表] should fetch and render the list of sessions correctly', async () => {
            sessionService.getSessions.mockResolvedValue({ success: true, sessions: mockSessions });
            wrapper = mountComponent();

            await wrapper.vm.$nextTick();
            await new Promise(r => setTimeout(r, 10));

            expect(sessionService.getSessions).toHaveBeenCalled();
            const items = wrapper.findAll('.session-item');
            expect(items.length).toBe(2);
            expect(wrapper.text()).toContain('Current Browser');
        });

        /**
         * Case 02: 当前设备防护
         * 目标：禁止用户在设备管理中“踢掉自己”。
         * 解决问题：防止用户点错导致当前会话丢失。
         */
        it('[高亮显示当前设备] should highlight current device and hide its kick button', async () => {
            sessionService.getSessions.mockResolvedValue({ success: true, sessions: mockSessions });
            wrapper = mountComponent();
            await wrapper.vm.$nextTick();
            await new Promise(r => setTimeout(r, 10));

            const currentItem = wrapper.find('.session-item.is-current');
            expect(currentItem.exists()).toBe(true);
            // 关键断言：当前设备列表项不应出现“移除”按钮
            expect(currentItem.find('.remove-btn').exists()).toBe(false);

            const otherItem = wrapper.findAll('.session-item').find(i => !i.classes().includes('is-current'));
            expect(otherItem.find('.remove-btn').exists()).toBe(true);
        });

        /**
         * Case 03: 踢出其他设备
         * 目标：执行单点登出。
         * 解决问题：确保调用 API 并提供确认弹窗，增强安全性。
         */
        it('[普通单设备踢出] should call deleteSession API after confirming removal', async () => {
            sessionService.getSessions.mockResolvedValue({ success: true, sessions: mockSessions });
            sessionService.deleteSession.mockResolvedValue({ success: true });
            ElMessageBox.confirm.mockResolvedValue(); // 模拟用户点确定

            wrapper = mountComponent();
            await wrapper.vm.$nextTick();
            await new Promise(r => setTimeout(r, 10));

            const removeBtn = wrapper.find('.remove-btn');
            await removeBtn.trigger('click');

            expect(ElMessageBox.confirm).toHaveBeenCalled();
            expect(sessionService.deleteSession).toHaveBeenCalledWith('session-2');
        });

        /**
         * Case 04: 一键全局清理
         * 解决问题：当主用户更改密码后，一键强制所有其他地方登录的设备失效。
         */
        it('[一键所有设备登出] should sign out all other devices after confirmation', async () => {
            sessionService.getSessions.mockResolvedValue({ success: true, sessions: mockSessions });
            sessionService.deleteAllOtherSessions.mockResolvedValue({ success: true });
            ElMessageBox.confirm.mockResolvedValue();

            wrapper = mountComponent();
            await wrapper.vm.$nextTick();
            await new Promise(r => setTimeout(r, 10));

            const signoutAllBtn = wrapper.find('.sign-out-all-btn');
            await signoutAllBtn.trigger('click');

            expect(sessionService.deleteAllOtherSessions).toHaveBeenCalled();
            await wrapper.vm.$nextTick();
            expect(wrapper.findAll('.session-item').length).toBe(1); // 仅剩自己
        });
    });

    describe('2. 异常与安全拦截', () => {
        /**
         * Case 05: 会话失效自动重定向
         * 解决问题：当用户的当前会话已在另一端被踢出时，所有设备管理操作应探测到 401 并自动跳转回登录页。
         */
        it('[幽灵刷新拦截 (401 触发踢出)] should redirect to login on 401 response', async () => {
            sessionService.getSessions.mockRejectedValue({ status: 401, message: 'Unauthorized' });
            wrapper = mountComponent();
            await wrapper.vm.$nextTick();
            await new Promise(r => setTimeout(r, 10));

            expect(mockRouter.push).toHaveBeenCalledWith('/login');
        });
    });
});
