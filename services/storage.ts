
export const DB_NAME = 'MiaaulaDB_v1';
export const DB_VERSION = 1;

export const STORES = {
    NUCLEUS: 'nucleus',
    CONTENT: 'content',
    PROGRESS: 'progress'
};

// --- LocalStorage Wrappers ---

export async function saveData<T>(key: string, data: T): Promise<void> {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error('Error saving to localStorage', e);
        throw e;
    }
}

export async function loadData<T>(key: string): Promise<T | null> {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        console.error('Error loading from localStorage', e);
        return null;
    }
}

export async function factoryReset(): Promise<void> {
    localStorage.clear();
    const db = await openDB();
    db.close();
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => console.warn('Delete blocked');
    });
}

// --- IndexedDB Logic ---

export function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            if (!db.objectStoreNames.contains(STORES.NUCLEUS)) {
                db.createObjectStore(STORES.NUCLEUS, { keyPath: 'id' });
            }
            
            if (!db.objectStoreNames.contains(STORES.CONTENT)) {
                const store = db.createObjectStore(STORES.CONTENT, { keyPath: 'id' });
                store.createIndex('litRef', 'litRef', { unique: false });
                store.createIndex('type', 'type', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(STORES.PROGRESS)) {
                const store = db.createObjectStore(STORES.PROGRESS, { keyPath: 'pk' }); // pk = userId:itemId
                store.createIndex('litRef', 'litRef', { unique: false });
                store.createIndex('itemId', 'itemId', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            resolve((event.target as IDBOpenDBRequest).result);
        };

        request.onerror = (event) => {
            reject((event.target as IDBOpenDBRequest).error);
        };
    });
}

export async function dbPut(storeName: string, data: any): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function dbGetByIndex<T>(storeName: string, indexName: string, value: any): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const req = index.getAll(value);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllFromStore<T>(storeName: string): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function bulkPutToStore(storeName: string, items: any[]): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        
        items.forEach(item => store.put(item));
    });
}

export async function dbDelete(storeName: string, key: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

/**
 * ATOMIC BATCH DELETE
 * Deletes a Nucleus and ALL associated Content and Progress in a single transaction.
 * Ensures data consistency when removing a Law Card (LIT_REF).
 */
export async function deleteAtomicBatch(litRef: string): Promise<void> {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORES.NUCLEUS, STORES.CONTENT, STORES.PROGRESS], 'readwrite');
        
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted'));

        // 1. Delete Nucleus
        tx.objectStore(STORES.NUCLEUS).delete(litRef);

        // 2. Delete Content (Questions, Gaps, Flashcards) linked to this LitRef
        const contentStore = tx.objectStore(STORES.CONTENT);
        const contentIndex = contentStore.index('litRef');
        const contentReq = contentIndex.openKeyCursor(IDBKeyRange.only(litRef));
        
        contentReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result;
            if (cursor) {
                contentStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };

        // 3. Delete Progress (History) linked to this LitRef
        const progressStore = tx.objectStore(STORES.PROGRESS);
        const progressIndex = progressStore.index('litRef');
        const progressReq = progressIndex.openKeyCursor(IDBKeyRange.only(litRef));
        
        progressReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest).result;
            if (cursor) {
                progressStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };
    });
}
