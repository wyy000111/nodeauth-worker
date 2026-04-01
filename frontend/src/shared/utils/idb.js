// frontend/src/shared/utils/idb.js

const DB_NAME = 'NodeAuthDB'
const STORE_NAME = 'app_key_store'
const DB_VERSION = 1

function openDB() {
    return new Promise((resolve, reject) => {
        // 🛡️ 针对 iOS PWA 的防御性设计：防止 IndexedDB 在进程异常关闭后死锁导致应用挂起
        const timeout = setTimeout(() => {
            reject(new Error('IndexedDB initialization timeout. The database may be locked by another instance.'))
        }, 5000)

        const request = indexedDB.open(DB_NAME, DB_VERSION)

        // 当其他标签页或旧进程仍占用数据库且阻止版本更新（或打开）时触发
        request.onblocked = () => {
            console.warn('[IDB] Database access is blocked by another session.')
        }

        request.onerror = () => {
            clearTimeout(timeout)
            reject(request.error)
        }

        request.onsuccess = () => {
            clearTimeout(timeout)
            resolve(request.result)
        }

        request.onupgradeneeded = (event) => {
            const db = event.target.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME)
            }
        }
    })
}

export async function setIdbItem(key, value) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.put(value, key)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

export async function getIdbItem(key) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export async function removeIdbItem(key) {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.delete(key)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}
export async function clearIdbStore() {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        const request = store.clear()
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}
