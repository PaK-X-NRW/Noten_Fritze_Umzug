/* =========================================================================
   umzug.js – Datenübertragung von der alten an die neue Adresse
   Die Daten der App liegen in IndexedDB und sind an die Adresse (Origin)
   gebunden. Diese Seite läuft unter der alten Adresse, liest die Datenbank
   „noten-fritze“ nur lesend aus und übergibt sie als Backup (Format wie
   Store.exportAll im Haupt-Repo) per postMessage an noten-fritze.de.
   Ablauf (Protokoll, siehe README.md):
     1. Klick öffnet ZIEL/?umzug=1 in einem neuen Fenster.
     2. Das neue Fenster meldet { typ: "noten-fritze-umzug-bereit" }.
     3. Diese Seite schickt { typ: "noten-fritze-umzug-daten", backup }.
     4. Das neue Fenster antwortet { typ: "noten-fritze-umzug-fertig", ok, fehler }.
   Die alte Datenbank wird nie verändert oder gelöscht.
   ========================================================================= */
(function () {
  "use strict";

  const ZIEL = "https://noten-fritze.de";
  const DB_NAME = "noten-fritze";
  const DATEN_STORES = ["klassen", "schueler", "kategorien", "leistungen", "noten",
    "sitzplaene", "ereignisse", "abwesenheiten", "stunden"];
  // Merkt sich nur, ob schon übertragen wurde – keine Nutzdaten.
  const MERKER = "noten-fritze-umzug";

  const $ = (id) => document.getElementById(id);
  let fenster = null;
  let wartezeit = null;
  let backup = null; // Promise des zuletzt gelesenen Backups

  // Öffnet die vorhandene Datenbank, ohne ihre Version zu ändern. Gibt es
  // keine, wird das Anlegen abgebrochen (null) – sonst bliebe eine leere
  // Datenbank zurück.
  function oeffneDB() {
    return new Promise((resolve, reject) => {
      let gibtEsNicht = false;
      const req = indexedDB.open(DB_NAME);
      req.onupgradeneeded = (e) => {
        if (e.oldVersion === 0) { gibtEsNicht = true; req.transaction.abort(); }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => {
        if (gibtEsNicht) { e.preventDefault(); resolve(null); } else reject(req.error);
      };
    });
  }

  function leseBackup(db) {
    const namen = DATEN_STORES.filter((n) => db.objectStoreNames.contains(n));
    const mitEinstellungen = db.objectStoreNames.contains("einstellungen");
    const data = { settings: null };
    DATEN_STORES.forEach((n) => { data[n] = []; });
    const alle = mitEinstellungen ? namen.concat("einstellungen") : namen;
    return new Promise((resolve, reject) => {
      if (!alle.length) { resolve(data); return; }
      const tx = db.transaction(alle, "readonly");
      namen.forEach((n) => {
        const r = tx.objectStore(n).getAll();
        r.onsuccess = () => { data[n] = r.result; };
      });
      // Nur der Datensatz „app“; der Export-Ordner (Datei-Handle) gilt nur
      // für diese Adresse und wird auf der neuen Seite neu gewählt.
      if (mitEinstellungen) {
        const r = tx.objectStore("einstellungen").get("app");
        r.onsuccess = () => { data.settings = r.result || null; };
      }
      tx.oncomplete = () => resolve({
        app: "noten-fritze", appVersion: "umzug",
        dbVersion: db.version,
        schemaVersion: (data.settings && data.settings.schemaVersion) || null,
        exportedAt: new Date().toISOString(),
        data
      });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Liest bei jedem Aufruf frisch, falls die alte App noch in einem anderen
  // Tab offen war und seitdem etwas gespeichert hat.
  async function aktuellesBackup() {
    const db = await oeffneDB();
    if (!db) return null;
    try { return await leseBackup(db); } finally { db.close(); }
  }

  function status(text, art) {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (art ? " " + art : "");
  }

  function plural(n, eins, mehr) { return n + " " + (n === 1 ? eins : mehr); }

  function uebertragen() {
    // Das Fenster muss synchron im Klick geöffnet werden – nach einem await
    // blockieren Safari & Co. es als Pop-up. Gelesen wird parallel.
    fenster = window.open(ZIEL + "/?umzug=1", "noten-fritze-umzug");
    if (!fenster) {
      status("Der Browser hat das neue Fenster blockiert. Bitte Pop-ups für diese Seite erlauben " +
        "oder die Übertragung per Backup-Datei nutzen.", "fehler");
      return;
    }
    backup = aktuellesBackup();
    $("uebertragen").disabled = true;
    status("Warte auf noten-fritze.de …");
    clearTimeout(wartezeit);
    wartezeit = setTimeout(() => {
      $("uebertragen").disabled = false;
      status("Keine Antwort von noten-fritze.de. Bitte erneut versuchen oder die Übertragung " +
        "per Backup-Datei nutzen.", "fehler");
    }, 60000);
  }

  window.addEventListener("message", (e) => {
    // Nur Nachrichten aus genau dem Fenster, das diese Seite geöffnet hat
    if (e.origin !== ZIEL || !fenster || e.source !== fenster) return;
    const m = e.data || {};
    if (m.typ === "noten-fritze-umzug-bereit") {
      // Ab hier wartet die neue Seite ggf. auf eine Rückfrage an die Nutzerin.
      clearTimeout(wartezeit);
      status("Daten werden übertragen …");
      const ziel = fenster;
      backup.then((b) => {
        ziel.postMessage({ typ: "noten-fritze-umzug-daten", backup: b }, ZIEL);
      }).catch((err) => {
        $("uebertragen").disabled = false;
        status("Die Daten konnten nicht gelesen werden: " + err.message, "fehler");
      });
    } else if (m.typ === "noten-fritze-umzug-fertig") {
      $("uebertragen").disabled = false;
      if (m.ok) {
        try { localStorage.setItem(MERKER, new Date().toISOString()); } catch (_) { /* egal */ }
        status("Fertig: Die Daten sind auf noten-fritze.de. Bitte ab jetzt nur noch dort arbeiten.", "ok");
      } else {
        status(m.fehler || "Die Übertragung wurde abgebrochen.", "fehler");
      }
    }
  });

  function herunterladen() {
    aktuellesBackup().then((b) => {
      if (!b) return;
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "noten-fritze-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }).catch((err) => status("Das Backup konnte nicht erstellt werden: " + err.message, "fehler"));
  }

  async function start() {
    let b = null;
    try {
      b = await aktuellesBackup();
    } catch (err) {
      console.warn("Umzug:", err);
    }
    const klassen = b ? b.data.klassen.length : 0;
    if (!klassen) {
      $("ohne-daten").hidden = false;
      return;
    }
    $("umfang").textContent = plural(klassen, "Klasse", "Klassen") + " mit " +
      plural(b.data.schueler.length, "Schüler/in", "Schüler/innen");
    $("mit-daten").hidden = false;
    let schonAm = null;
    try { schonAm = localStorage.getItem(MERKER); } catch (_) { /* egal */ }
    if (schonAm) {
      status("Bereits übertragen am " + new Date(schonAm).toLocaleDateString("de-DE") + ".", "ok");
    }
    $("uebertragen").addEventListener("click", uebertragen);
    $("herunterladen").addEventListener("click", herunterladen);
  }

  start();
})();
