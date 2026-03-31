import {
    startRegistration,
    startAuthentication,
    browserSupportsWebAuthn
} from '@simplewebauthn/browser';
import { request } from '@/shared/utils/request';

export const webAuthnService = {
    /**
     * 判断当前浏览器是否支持 WebAuthn
     */
    isSupported() {
        return browserSupportsWebAuthn();
    },

    /**
     * 注册新的 Passkey
     */
    async register(name) {
        // 1. 获取注册选项
        const options = await request('/api/oauth/webauthn/register/options');

        // 2. 调用浏览器 API 进行挑战响应
        const attestation = await startRegistration(options);

        // 3. 发回后端验证并存储
        const result = await request('/api/oauth/webauthn/register/verify', {
            method: 'POST',
            body: JSON.stringify({
                name,
                response: attestation
            })
        });

        return result;
    },

    /**
     * 使用 Passkey 登录
     */
    async login() {
        // 1. 获取登录选项
        const options = await request('/api/oauth/webauthn/login/options');

        // 2. 调用浏览器 API 进行签名
        const assertion = await startAuthentication(options);

        // 3. 发回后端验证并签发 JWT
        const { getDeviceId } = await import('@/shared/utils/device');
        const finalPayload = { ...assertion, deviceId: getDeviceId() };

        return await request('/api/oauth/webauthn/login/verify', {
            method: 'POST',
            body: JSON.stringify(finalPayload)
        });
    },

    /**
     * 获取凭证列表
     */
    async listCredentials() {
        return await request('/api/oauth/webauthn/credentials');
    },

    /**
     * 删除凭证
     */
    async deleteCredential(id) {
        return await request(`/api/oauth/webauthn/credentials/${id}`, { method: 'DELETE' });
    },

    /**
     * 修改凭证名称
     */
    async updateCredentialName(id, name) {
        return await request(`/api/oauth/webauthn/credentials/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name })
        });
    }
};
