'use strict';

const Storage = (() => {
  const key = 'app-per-la-spesa';
  const conflict = () => new Error('I dati sono cambiati in un’altra finestra. Copia le modifiche che vuoi conservare e riapri l’app.');

  async function browserDatabase() {
    const request = indexedDB.open(key, 1);
    const db = await new Promise((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('data');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('L’archivio locale è aperto in un’altra finestra.'));
    });
    db.onversionchange = () => db.close();

    function access(update) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('data', update ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('data');
        const read = store.get('state');
        let current = null;
        let failure;
        read.onsuccess = () => {
          current = read.result ?? null;
          if (!update) return;
          if (current !== update.expected) {
            failure = conflict();
            transaction.abort();
            return;
          }
          store.put(update.value, 'state');
        };
        transaction.oncomplete = () => resolve(current);
        transaction.onabort = () => reject(failure || transaction.error || new Error('Salvataggio interrotto.'));
      });
    }
    const raw = await access();
    return { mode: 'browser', raw, write: (value, expected) => access({ value, expected }) };
  }

  async function open() {
    if (window.SpesaDevice) {
      const raw = window.SpesaInitialArchive ?? null;
      delete window.SpesaInitialArchive;
      return { mode: 'device', raw, write: (value, expected) => window.SpesaDevice.call('save', { value, expected }) };
    }
    try {
      return await browserDatabase();
    } catch {
      try {
        const raw = localStorage.getItem(key);
        return {
          mode: 'browser',
          raw,
          write(value, expected) {
            if (localStorage.getItem(key) !== expected) throw conflict();
            localStorage.setItem(key, value);
          }
        };
      } catch {
        return { mode: 'temporary', raw: null, write() {} };
      }
    }
  }

  return { open };
})();
