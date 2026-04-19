import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// Bun's runtime installs a broken `localStorage` global (missing methods) that
// shadows jsdom's implementation. Replace it with a simple in-memory Storage.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
  };
}

Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), writable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: memoryStorage(), writable: true });
