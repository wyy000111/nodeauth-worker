import { createI18n } from 'vue-i18n'
import zhCN from '@/locales/zh-CN.json'
import enUS from '@/locales/en-US.json'

// 1. 获取浏览器默认语言
const getBrowserLanguage = () => {
    const navLang = navigator.language || navigator.userLanguage
    if (navLang.startsWith('zh')) return 'zh-CN'
    return 'en-US'
}

// 2. 从 localStorage 读取，优先缓存，否则取系统语言
const currentLocale = localStorage.getItem('app_locale') || getBrowserLanguage()

// 3. 配置 i18n
export const i18n = createI18n({
    legacy: false, // 使用 Vue 3 Composition API 模式
    locale: currentLocale,
    fallbackLocale: 'en-US',
    messages: {
        'zh-CN': zhCN,
        'en-US': enUS
    }
})

// 暴露一个切换语言的快捷函数
export const setLanguage = (lang) => {
    i18n.global.locale.value = lang
    localStorage.setItem('app_locale', lang)
    // 修改 HTML 语言属性
    document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en'
}
