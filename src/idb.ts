export function getDB(): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('webmd', 1);
    req.onupgradeneeded = (e: any) => e.target.result.createObjectStore('handles');
    req.onsuccess = (e: any) => resolve(e.target.result);
    req.onerror = reject;
  });
}

export async function saveHandleToIDB(handle: any): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'root');
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

export async function loadHandleFromIDB(): Promise<any> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('root');
    req.onsuccess = (e: any) => resolve(e.target.result || null);
    req.onerror = reject;
  });
}
