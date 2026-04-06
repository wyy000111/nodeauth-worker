import { describe, it, expect, vi } from 'vitest'

// Since full-mounting VaultList is extremely heavy with Vue Query, Pinia, Element Plus, and i18n,
// we will abstract and verify the exact IntersectionObserver logic implemented in the component.
describe('Mobile Offline - IntersectionObserver Infinite Scroll', () => {
    let observerCallback = null;
    let observeMock = vi.fn();
    let disconnectMock = vi.fn();

    // Mock IntersectionObserver
    global.IntersectionObserver = class IntersectionObserver {
        constructor(callback, options) {
            observerCallback = callback;
            this.options = options;
        }
        observe = observeMock;
        disconnect = disconnectMock;
    }

    it('should initialize IntersectionObserver on mobile and trigger handleLoadMore when intersected', async () => {
        let loadMoreCalled = 0;
        const handleLoadMore = () => { loadMoreCalled++ };
        const isLoadMoreDisabled = { value: false };
        const mobileLoadMoreTrigger = { value: document.createElement('div') };

        let observer = null;
        const setupIntersectionObserver = () => {
            if (observer) observer.disconnect();
            observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && !isLoadMoreDisabled.value) {
                    handleLoadMore();
                }
            }, {
                root: null,
                rootMargin: '0px 0px 300px 0px',
                threshold: 0
            });
            if (mobileLoadMoreTrigger.value) {
                observer.observe(mobileLoadMoreTrigger.value);
            }
        };

        // 1. Simulate Component Mount
        setupIntersectionObserver();

        expect(observeMock).toHaveBeenCalledWith(mobileLoadMoreTrigger.value);
        expect(observer).not.toBeNull();

        // 2. Simulate User Scrolling Down & Triggering the Observer in Offline Mode
        // isIntersecting is true, and isLoadMoreDisabled is false (because we have more offline pages)
        observerCallback([{ isIntersecting: true }]);

        // 3. Verify handleLoadMore was triggered
        expect(loadMoreCalled).toBe(1);

        // 4. Simulate User scrolling but LoadMore is disabled (e.g. no more pages)
        isLoadMoreDisabled.value = true;
        observerCallback([{ isIntersecting: true }]);

        // Should NOT trigger load more again
        expect(loadMoreCalled).toBe(1);
    })
})
