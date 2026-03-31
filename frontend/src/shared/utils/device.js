/**
 * 🆔 设备指纹管理工具
 */

export const getDeviceId = () => {
    let deviceId = localStorage.getItem('app_device_id')

    if (!deviceId) {
        // 生成永久唯一的物理设备指纹 (UUID v4 简化版)
        deviceId = crypto.randomUUID
            ? crypto.randomUUID()
            : 'dev-' + Math.random().toString(36).substring(2, 15)

        localStorage.setItem('app_device_id', deviceId)
    }

    return deviceId
}
