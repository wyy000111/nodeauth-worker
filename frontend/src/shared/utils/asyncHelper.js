import { defineAsyncComponent, h, onMounted, defineComponent } from 'vue'
import { ElEmpty, ElButton } from 'element-plus'
import { i18n } from '@/locales'
import { logger } from '@/shared/utils/logger'

/**
 * 核心加载组件 - 具名导出以供 API 加载状态复用
 */
export const AsyncLoading = defineComponent({
    name: 'AsyncLoading',
    setup() {
        const t = (key) => {
            try {
                return i18n.global.t(key)
            } catch (e) {
                return key
            }
        }

        // 使用 CSS 关键帧动画注入（最轻量、无副作用）
        const injectStyles = () => {
            if (document.getElementById('async-loading-styles')) return
            const style = document.createElement('style')
            style.id = 'async-loading-styles'
            style.textContent = `
                @keyframes async-progress-flow {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .async-progress-bar {
                    width: 200px;
                    height: 3px;
                    background: rgba(64, 158, 255, 0.1);
                    border-radius: 4px;
                    overflow: hidden;
                    position: relative;
                    margin-top: 16px;
                }
                .async-progress-inner {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 50%;
                    height: 100%;
                    background: var(--el-color-primary);
                    border-radius: 4px;
                    animation: async-progress-flow 1.5s infinite ease-in-out;
                    box-shadow: 0 0 8px var(--el-color-primary);
                }
            `
            document.head.appendChild(style)
        }

        onMounted(injectStyles)

        return () => h('div', {
            style: {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '400px',
                width: '100%',
                backgroundColor: 'transparent'
            }
        }, [
            // 文案优化 - 适配多语言
            h('div', {
                style: {
                    fontSize: '16px',
                    color: 'var(--el-text-color-regular)',
                    fontWeight: '500',
                    letterSpacing: '1px'
                }
            }, t('common.resource_loading')),
            // 线性进度条
            h('div', { class: 'async-progress-bar' }, [
                h('div', { class: 'async-progress-inner' })
            ])
        ])
    }
})

/**
 * 增强的异步组件工厂函数
 * 解决 PWA/Cloudflare 环境下分块加载失败导致的白屏问题
 */
export function createAsyncComponent(loader) {
    return defineAsyncComponent({
        loader: async () => {
            logger.info('[AsyncComponent] Starting to load component...')
            try {
                const comp = await loader()
                logger.info('[AsyncComponent] Component loaded successfully')
                return comp
            } catch (err) {
                logger.error('[AsyncComponent] Component load failed:', err)
                throw err
            }
        },

        // 加载中占位
        loadingComponent: AsyncLoading,

        // 失败占位
        errorComponent: defineComponent({
            name: 'AsyncError',
            props: ['error'],
            setup(props) {
                logger.error('[AsyncComponent] Rendering error component:', props.error)

                const t = (key) => {
                    try {
                        return i18n.global.t(key)
                    } catch (e) {
                        return key
                    }
                }

                return () => h('div', {
                    style: { padding: '40px', textAlign: 'center' }
                }, [
                    h(ElEmpty, { description: t('common.loading_failed') }, {
                        default: () => h(ElButton, {
                            type: 'primary',
                            onClick: () => window.location.reload()
                        }, t('common.refresh'))
                    })
                ])
            }
        }),

        // 延迟显示加载组件 (防止闪烁)
        delay: 200,
        // 超时设置 (15秒)
        timeout: 15000,
        // 错误重试逻辑
        onError(error, retry, fail, attempts) {
            if (attempts <= 2) {
                logger.warn(`[AsyncComponent] Loading failed, retrying (${attempts}/2)...`, error)
                setTimeout(() => retry(), 500)
            } else {
                fail()
            }
        }
    })
}
