import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  const themeMode = ref(localStorage.getItem('app_theme_mode') || 'auto')
  const isDark = ref(false)

  const initTheme = () => {
    applyTheme()

    // 监听系统变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (themeMode.value === 'auto') {
        applyTheme()
      }
    })
  }

  const setThemeMode = (mode) => {
    themeMode.value = mode
    localStorage.setItem('app_theme_mode', mode)
    applyTheme()
  }

  const toggleTheme = () => {
    // 桌面端顶栏切换，手动在 light 和 dark 之间轮转
    const nextMode = isDark.value ? 'light' : 'dark'
    setThemeMode(nextMode)
  }

  const applyTheme = () => {
    let dark = false
    if (themeMode.value === 'auto') {
      dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    } else {
      dark = themeMode.value === 'dark'
    }

    isDark.value = dark
    if (dark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  return { themeMode, isDark, initTheme, setThemeMode, toggleTheme }
})