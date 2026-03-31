import { request } from '@/shared/utils/request';

/**
 * Web3 Authentication Service
 * 
 * Architectural Blueprint:
 * 1. Single Source of Truth: Uses Promise memoization for the Provider.
 * 2. Monkey Patching Strategy: To bypass "Invalid Audience (3000)" errors, we cheat the SDK 
 *    by providing the official relay URL but intercepting the WebSocket connection 
 *    globally to redirect it to our self-hosted proxy.
 * 3. Dynamic Import: We use await import() for the SDK to ensure our WebSocket 
 *    interceptor is applied BEFORE the SDK captures the global constructor.
 */
class Web3AuthProvider {
    constructor() {
        this.provider = null;
        this.initPromise = null;
        this._initProjectId = null;
        this._initRelayUrl = null;
        this._initVerifyUrl = null;
        this._wsPatched = false;
    }

    /**
     * Intercepts global WebSocket constructor to redirect WalletConnect traffic.
     */
    _applyWebSocketProxyPatch(proxyRelayUrl) {
        if (typeof window === 'undefined' || this._wsPatched) return;

        const OriginalWS = window.WebSocket;
        if (!OriginalWS) return;

        // Resolve relative proxy path to absolute WSS/WS URL
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

        window.WebSocket = function (url, protocols) {
            const urlStr = String(url);
            let isOfficialRelay = false;

            try {
                const parsed = new URL(urlStr);
                const host = parsed.hostname;
                // 🛡️ Strict Hostname Validation: Prevents domain spooping
                isOfficialRelay = host === 'relay.walletconnect.com' ||
                    host === 'relay.walletconnect.org' ||
                    host.endsWith('.relay.walletconnect.com') ||
                    host.endsWith('.relay.walletconnect.org');
            } catch (e) {
                // If URL is invalid, it's definitely not a trusted relay
                isOfficialRelay = false;
            }


            // Logic: Catch ANY request to official relay domains
            if (isOfficialRelay) {
                console.log('[WC Proxy] Intercepting Relay Connection:', urlStr);


                // Construct the target URL (Proxy)
                const target = new URL(urlStr);

                // If it's the relay endpoint, we force the path to our proxy mount point
                // while preserving all query parameters (auth JWT, projectID, etc.)
                target.protocol = protocol;
                target.host = window.location.host;
                target.pathname = proxyRelayUrl;

                console.log('[WC Proxy] Redirected to:', target.toString());
                return new OriginalWS(target.toString(), protocols);
            }
            return new OriginalWS(url, protocols);
        };

        // Preserve prototype and static methods (like .CONNECTING, .OPEN)
        window.WebSocket.prototype = OriginalWS.prototype;
        Object.assign(window.WebSocket, OriginalWS);
        window.WebSocket.patched = true;

        this._wsPatched = true;
        console.warn('[WC Proxy] Network interceptor is now ACTIVE');
    }

    async getProvider(projectId, relayUrl, verifyUrl) {
        const shouldReinit = !this.initPromise ||
            this._initProjectId !== projectId ||
            this._initRelayUrl !== relayUrl ||
            this._initVerifyUrl !== verifyUrl;

        if (shouldReinit) {
            this._initProjectId = projectId;
            this._initRelayUrl = relayUrl;
            this._initVerifyUrl = verifyUrl;

            // Strategy: Transparent Proxying
            // IMPORTANT: We must patch BEFORE importing/initializing the SDK
            if (relayUrl && relayUrl.includes('/wc-proxy')) {
                this._applyWebSocketProxyPatch(relayUrl);
            }

            // Dynamic import ensures the SDK sees our patched WebSocket
            const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');

            const initOptions = {
                projectId,
                showQrModal: false,
                chains: [1],
                methods: ['personal_sign'],
                events: ['chainChanged', 'accountsChanged', 'disconnect'],
                metadata: {
                    name: "NodeAuth",
                    description: "A Secure 2FA Management Tool",
                    url: window.location.origin,
                    icons: ["https://avatars.githubusercontent.com/u/10435135"]
                }
            };

            if (relayUrl && relayUrl.includes('/wc-proxy')) {
                // Use official URL for internal JWT signing (Audience safety)
                initOptions.relayUrl = 'wss://relay.walletconnect.com';
            } else if (relayUrl) {
                initOptions.relayUrl = relayUrl;
            }

            if (verifyUrl) {
                initOptions.verifyUrl = verifyUrl.startsWith('/')
                    ? `${window.location.origin}${verifyUrl}`
                    : verifyUrl;
            }

            this.initPromise = EthereumProvider.init(initOptions).then(provider => {
                this.provider = provider;
                return provider;
            }).catch(err => {
                this._reset();
                throw err;
            });
        }
        return this.initPromise;
    }

    async login(projectId, { onUri, onStatus, relayUrl, verifyUrl }) {
        const provider = await this.getProvider(projectId, relayUrl, verifyUrl);
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const emitState = (state) => { if (typeof onStatus === 'function') onStatus(state); };

        return new Promise((resolve, reject) => {
            const handleUri = async (uri) => { if (typeof onUri === 'function') await onUri(uri, isMobile); };
            const handleDisconnect = () => reject(new Error('session_disconnected'));

            provider.on("display_uri", handleUri);
            provider.on("disconnect", handleDisconnect);

            const cleanup = () => {
                provider.removeListener?.("display_uri", handleUri);
                provider.removeListener?.("disconnect", handleDisconnect);
            };

            const abortFlow = (error) => {
                cleanup();
                if (this.provider) { this.provider.disconnect().catch(() => { }); }
                this._reset();
                reject(this._normalizeError(error));
            };

            (async () => {
                try {
                    emitState('reconnecting');
                    await provider.connect();
                    const address = provider.accounts[0];
                    if (!address) throw new Error("no_account_found");

                    const { nonce } = await request('/api/oauth/web3/login/options');
                    const message = `Welcome to NodeAuth.\n\nPlease sign this message to authenticate your wallet.\n\nNonce: ${nonce}`;
                    emitState('awaiting_signature');

                    const signature = await Promise.race([
                        provider.request({ method: 'personal_sign', params: [message, address] }),
                        new Promise((_, r) => setTimeout(() => r(new Error('signature_timeout')), 60000))
                    ]);

                    provider.removeListener?.("disconnect", handleDisconnect);
                    emitState('verifying');
                    const { getDeviceId } = await import('@/shared/utils/device');
                    const sessionData = await request('/api/oauth/web3/login/verify', {
                        method: 'POST',
                        body: JSON.stringify({ address, message, signature, deviceId: getDeviceId() })
                    });

                    cleanup();
                    resolve(sessionData);
                } catch (err) {
                    abortFlow(err);
                }
            })();
        });
    }

    async disconnect() {
        if (this.provider) { await this.provider.disconnect().catch(() => { }); }
        this._reset();
    }

    _reset() {
        this.provider = null;
        this.initPromise = null;
        this._initProjectId = null;
        this._initRelayUrl = null;
        this._initVerifyUrl = null;
    }

    _normalizeError(error) {
        const msg = String(error.message || error).toLowerCase();
        if (msg.includes('user rejected') || msg.includes('session_disconnected') || msg.includes('load failed')) {
            return new Error('User cancelled');
        }
        if (msg.includes('signature_timeout')) return new Error('Signature request timed out. Please try again.');
        return error;
    }
}

export const web3WalletAuthService = new Web3AuthProvider();
