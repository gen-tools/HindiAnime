/**
 * Browser-only IndexedDB wrapper for Hindi Anime structured user data.
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
let activeDb: IDBDatabase | null = null;
const closingDatabases = new WeakSet<IDBDatabase>();

class DatabaseConnectionClosingError extends Error {
  constructor() {
    super("IndexedDB connection closed while starting a transaction");
    this.name = "DatabaseConnectionClosingError";
  }
}

function resetDbPromise(database?: IDBDatabase, openingPromise?: Promise<IDBDatabase>) {
  if (database) {
    closingDatabases.add(database);
    // A late close event from an old connection must not clear a newer open.
    if (activeDb !== database) return;
    activeDb = null;
  }
  if (!openingPromise || dbPromise === openingPromise) dbPromise = null;
}

function isConnectionClosingError(error: unknown, database: IDBDatabase): boolean {
  return (
    closingDatabases.has(database) ||
    (error instanceof DOMException && error.name === "InvalidStateError")
  );
}

export function isIndexedDbSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export function getDb(): Promise<IDBDatabase> {
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error("IndexedDB is not supported or not running in a browser context"));
  }

  if (dbPromise) return dbPromise;

  const openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
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
      const database = request.result;
      activeDb = database;
      database.onversionchange = () => {
        // A second tab or a newer app version is changing the schema. Close
        // this handle and make the next operation open a fresh connection.
        resetDbPromise(database, openingPromise);
        database.close();
      };
      database.onclose = () => resetDbPromise(database, openingPromise);
      resolve(database);
    };

    request.onerror = () => {
      resetDbPromise(undefined, openingPromise);
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn("IndexedDB upgrade blocked by another open tab.");
    };
  });

  dbPromise = openingPromise;
  return dbPromise;
}

async function runStoreRequest<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const database = await getDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        let transaction: IDBTransaction;
        let request: IDBRequest;
        let result: T | undefined;

        try {
          transaction = database.transaction(storeName, mode);
          request = createRequest(transaction.objectStore(storeName));
        } catch (error) {
          reject(error);
          return;
        }

        request.onsuccess = () => {
          result = request.result as T;
        };
        request.onerror = () => reject(request.error || transaction.error);
        transaction.oncomplete = () => resolve(result as T);
        transaction.onabort = () => reject(transaction.error || request.error);
      });
    } catch (error) {
      const canRetry = attempt === 0 && isConnectionClosingError(error, database);
      if (canRetry) {
        resetDbPromise(database);
        continue;
      }
      if (isConnectionClosingError(error, database)) {
        throw new DatabaseConnectionClosingError();
      }
      throw error;
    }
  }

  throw new DatabaseConnectionClosingError();
}

export async function dbGetAll<T>(storeName: StoreName): Promise<T[]> {
  if (!isIndexedDbSupported()) return [];
  try {
    return (await runStoreRequest<T[]>(storeName, "readonly", (store) => store.getAll())) || [];
  } catch (error) {
    if (error instanceof DatabaseConnectionClosingError) return [];
    throw error;
  }
}

export async function dbGet<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  if (!isIndexedDbSupported()) return undefined;
  try {
    return await runStoreRequest<T | undefined>(storeName, "readonly", (store) => store.get(key));
  } catch (error) {
    if (error instanceof DatabaseConnectionClosingError) return undefined;
    throw error;
  }
}

export async function dbPut<T>(storeName: StoreName, value: T): Promise<void> {
  if (!isIndexedDbSupported()) return;
  await runStoreRequest<undefined>(storeName, "readwrite", (store) => store.put(value));
}

export async function dbDelete(storeName: StoreName, key: IDBValidKey): Promise<void> {
  if (!isIndexedDbSupported()) return;
  await runStoreRequest<undefined>(storeName, "readwrite", (store) => store.delete(key));
}

export async function dbClearStore(storeName: StoreName): Promise<void> {
  if (!isIndexedDbSupported()) return;
  await runStoreRequest<undefined>(storeName, "readwrite", (store) => store.clear());
}

export async function dbClearAllStores(): Promise<void> {
  if (!isIndexedDbSupported()) return;
  const allStores = Object.values(STORES);
  for (const store of allStores) {
    await dbClearStore(store);
  }
}
