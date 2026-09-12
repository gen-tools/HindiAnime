/**
 * Browser-only IndexedDB wrapper for HINDIANIME structured user data.
 * Zero external dependencies. Zero backend database.
 */

const DB_NAME = "hindianime_user_db";
const DB_VERSION = 1;

export const STORES = {
  WATCH_HISTORY: "watch_history",
  CONTINUE_WATCHING: "continue_watching",
  FAVORITES: "favorites",
  ANIME_STATUS: "anime_status",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIndexedDbSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function getDb(): Promise<IDBDatabase> {
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error("IndexedDB is not supported or not running in a browser context"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Watch History: store per watched episode
      if (!db.objectStoreNames.contains(STORES.WATCH_HISTORY)) {
        const store = db.createObjectStore(STORES.WATCH_HISTORY, { keyPath: "id" });
        store.createIndex("animeSlug", "animeSlug", { unique: false });
        store.createIndex("watchedAt", "watchedAt", { unique: false });
      }

      // 2. Continue Watching: 1 item per anime with latest watched episode
      if (!db.objectStoreNames.contains(STORES.CONTINUE_WATCHING)) {
        const store = db.createObjectStore(STORES.CONTINUE_WATCHING, { keyPath: "animeSlug" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      // 3. Favorites / My List: 1 item per anime
      if (!db.objectStoreNames.contains(STORES.FAVORITES)) {
        const store = db.createObjectStore(STORES.FAVORITES, { keyPath: "animeSlug" });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }

      // 4. Anime Status: watching, completed, dropped, plan_to_watch
      if (!db.objectStoreNames.contains(STORES.ANIME_STATUS)) {
        db.createObjectStore(STORES.ANIME_STATUS, { keyPath: "animeSlug" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn("IndexedDB upgrade blocked by another open tab.");
    };
  });

  return dbPromise;
}

export async function dbGetAll<T>(storeName: StoreName): Promise<T[]> {
  if (!isIndexedDbSupported()) return [];
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve((request.result as T[]) || []);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  if (!isIndexedDbSupported()) return undefined;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function dbPut<T>(storeName: StoreName, value: T): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(value);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function dbDelete(storeName: StoreName, key: IDBValidKey): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function dbClearStore(storeName: StoreName): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function dbClearAllStores(): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const allStores = Object.values(STORES);
  for (const store of allStores) {
    await dbClearStore(store);
  }
}
