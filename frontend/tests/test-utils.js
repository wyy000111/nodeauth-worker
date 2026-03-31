/**
 * 测试工具库 (Test Utils)
 * 
 * 为所有 Vue 组件集成测试提供一致的 commonStubs, i18nMocks 以及全局样式/依赖的统一 Mock 处理。
 */
import { vi } from 'vitest'



/**
 * 1. Element Plus 全局常用组件存根 (Stubs)
 * 强化容器组件：确保所有包含子元素的容器（Form, Row, Col）都能正确透传 Slot
 */
export const commonStubs = {
    'el-button': {
        template: '<button class="el-button-stub" :disabled="disabled" :loading="loading" @click="$emit(\'click\')"><slot /></button>',
        props: ['loading', 'disabled']
    },
    'el-input': {
        template: '<div class="el-input-stub"><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append" /></div>',
        props: ['modelValue']
    },
    'el-alert': {
        template: '<div class="el-alert-stub" :data-type="type">{{title}}<slot /></div>',
        props: ['title', 'type']
    },
    'el-dialog': {
        template: '<div v-if="modelValue" class="el-dialog-stub" :data-title="title"><slot name="header" /><slot /><slot name="footer" /></div>',
        props: ['modelValue', 'title']
    },
    'el-progress': {
        template: '<div class="el-progress-stub" :data-percent="percentage"></div>',
        props: ['percentage']
    },
    'el-tabs': {
        template: '<div class="el-tabs-stub" :data-tab="modelValue"><slot /></div>',
        props: ['modelValue']
    },
    'el-tab-pane': {
        template: '<div class="el-tab-pane-stub" :data-name="name"><slot /></div>',
        props: ['name', 'label']
    },
    'el-card': { template: '<div class="el-card-stub"><slot name="header" /><slot /></div>' },
    'el-scrollbar': { template: '<div class="el-scrollbar-stub"><slot /></div>' },
    'el-checkbox': { template: '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />', props: ['modelValue'] },
    'el-link': { template: '<a :href="href"><slot /></a>', props: ['href'] },
    // 容器组件必须透传 Slot
    'el-row': { template: '<div class="el-row-stub"><slot /></div>' },
    'el-col': { template: '<div class="el-col-stub"><slot /></div>' },
    'el-form': { template: '<form class="el-form-stub"><slot /></form>' },
    'el-form-item': { template: '<div class="el-form-item-stub"><label>{{label}}</label><slot /></div>', props: ['label'] },
    'el-icon': true, 'el-divider': true, 'el-tooltip': true, 'el-checkbox-group': true,
    'el-empty': { template: '<div class="el-empty-stub" :data-desc="description">{{description}}<slot /></div>', props: ['description'] },
    'Plus': true, 'Edit': true, 'Delete': true, 'Lock': true, 'Unlock': true, 'Search': true, 'Refresh': true
}

/**
 * 2. i18n Mock 规范
 */
export const i18nMocks = {
    global: {
        t: (key) => key,
        te: () => true,
        install: vi.fn()
    }
}

/**
 * 3. 环境补丁 (Polyfills)
 */
export const patchCrypto = () => {
    if (typeof window !== 'undefined' && !window.crypto) {
        Object.defineProperty(window, 'crypto', {
            value: {
                getRandomValues: (arr) => {
                    for (let i = 0; i < arr.length; i++) {
                        arr[i] = Math.floor(Math.random() * 256)
                    }
                    return arr
                }
            }
        })
    }
}

/**
 * 4. IndexedDB Mock (为防止在 JSDOM 环境下崩溃)
 */
export const patchIndexedDB = () => {
    if (typeof global.indexedDB === 'undefined') {
        const mockRequest = {
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
            result: {
                objectStoreNames: { contains: () => true },
                transaction: () => ({
                    objectStore: () => ({
                        get: () => ({ onsuccess: null }),
                        put: () => ({ onsuccess: null }),
                        delete: () => ({ onsuccess: null }),
                        clear: () => ({ onsuccess: null })
                    })
                })
            }
        }
        global.indexedDB = {
            open: () => {
                setTimeout(() => {
                    if (mockRequest.onsuccess) mockRequest.onsuccess({ target: mockRequest })
                }, 0)
                return mockRequest
            }
        }
    }
}
