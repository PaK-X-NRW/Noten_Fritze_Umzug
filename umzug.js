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
  // Gelesen werden alle vorhandenen Stores außer „einstellungen“ – so kommen
  // auch Datenarten mit, die die App nach dieser Seite bekommen hat. Was der
  // Import der App nicht kennt, ignoriert er.
  const EINSTELLUNGEN = "einstellungen";
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

  // Datei-Inhalte (ArrayBuffer) als Base64 – Format wie Store.exportAll
  // mit „mitDateien“, damit der Import der App sie wiederherstellt.
  function zuBase64(buf) {
    const b = buf instanceof ArrayBuffer ? new Uint8Array(buf)
      : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function dateiFuerBackup(d) {
    const x = Object.assign({}, d);
    const inhalt = d.daten;
    x.daten64 = inhalt && (inhalt instanceof ArrayBuffer || ArrayBuffer.isView(inhalt)) ? zuBase64(inhalt) : null;
    delete x.daten;
    return x;
  }

  function leseBackup(db) {
    const namen = Array.prototype.filter.call(db.objectStoreNames, (n) => n !== EINSTELLUNGEN);
    const mitEinstellungen = db.objectStoreNames.contains(EINSTELLUNGEN);
    const data = { klassen: [], schueler: [], settings: null };
    const alle = mitEinstellungen ? namen.concat(EINSTELLUNGEN) : namen;
    const verpackt = () => ({
      app: "noten-fritze", appVersion: "umzug",
      dbVersion: db.version,
      schemaVersion: (data.settings && data.settings.schemaVersion) || null,
      exportedAt: new Date().toISOString(),
      data
    });
    return new Promise((resolve, reject) => {
      if (!alle.length) { resolve(verpackt()); return; }
      const tx = db.transaction(alle, "readonly");
      namen.forEach((n) => {
        const r = tx.objectStore(n).getAll();
        r.onsuccess = () => { data[n] = n === "dateien" ? r.result.map(dateiFuerBackup) : r.result; };
      });
      // Nur der Datensatz „app“; der Export-Ordner (Datei-Handle) gilt nur
      // für diese Adresse und wird auf der neuen Seite neu gewählt.
      if (mitEinstellungen) {
        const r = tx.objectStore(EINSTELLUNGEN).get("app");
        r.onsuccess = () => { data.settings = r.result || null; };
      }
      tx.oncomplete = () => resolve(verpackt());
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

  // Als App auf dem Home-Bildschirm gestartet? Dann hat sie (iOS) einen eigenen
  // Speicher, getrennt vom Browser – der Weg führt über die Backup-Datei.
  function istInstalliert() {
    return window.navigator.standalone === true ||
      !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }
  // iPad meldet sich als Mac, hat aber Touch
  function istIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  // Zuletzt gelesenes Backup: Das Teilen-Blatt muss direkt im Tipp öffnen
  // (iOS), ein Lesen davor wäre zu spät. Beim Zurückkehren wird neu gelesen.
  let letztes = null;
  function backupDatei(b) {
    const name = "noten-fritze-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    return { name, inhalt: JSON.stringify(b, null, 2) };
  }
  function herunterladen(b) {
    const d = backupDatei(b);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([d.inhalt], { type: "application/json" }));
    a.download = d.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // Backup sichern: auf iPad/iPhone über das Teilen-Blatt („In Dateien
  // sichern“), sonst als Download – wie CSV.speichern in der App.
  function sichern() {
    if (!letztes) { status("Die Daten konnten nicht gelesen werden.", "fehler"); return; }
    const d = backupDatei(letztes);
    if (istIOS() && typeof File === "function") {
      let datei = null;
      try { datei = new File([d.inhalt], d.name, { type: "application/json" }); } catch (_) { datei = null; }
      if (datei && navigator.canShare && navigator.canShare({ files: [datei] })) {
        navigator.share({ files: [datei] })
          .then(() => status("Backup gesichert. Weiter mit Schritt 2.", "ok"))
          .catch((err) => {
            if (err && err.name === "AbortError") return;
            alsDownload();
          });
        return;
      }
    }
    alsDownload();
  }
  function alsDownload() {
    herunterladen(letztes);
    status("Backup wurde heruntergeladen" + (istInstalliert() ? ". Weiter mit Schritt 2." : "."), "ok");
  }

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
    // Zur Sicherheit immer auch eine Backup-Datei herunterladen
    backup.then((b) => { if (b) { letztes = b; herunterladen(b); } }).catch(() => { /* Meldung unten */ });
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
        const jetzt = new Date().toISOString();
        try { localStorage.setItem(MERKER, jetzt); } catch (_) { /* egal */ }
        schonUebertragen(jetzt);
        status("Fertig: Die Daten sind auf noten-fritze.de, eine Backup-Datei liegt zusätzlich " +
          "in deinen Downloads. Bitte ab jetzt nur noch auf noten-fritze.de arbeiten.", "ok");
      } else {
        status(m.fehler || "Die Übertragung wurde abgebrochen.", "fehler");
      }
    }
  });

  // Schon einmal übertragen: nur bremsen, nicht sperren. Die eigentliche
  // Sicherung sitzt in der App (Warnung + Backup vor dem Überschreiben).
  function schonUebertragen(am) {
    const hinweis = $("schon-hinweis");
    hinweis.textContent = "Du hast am " + new Date(am).toLocaleDateString("de-DE") + " schon übertragen. " +
      "Ein erneutes Übertragen überschreibt deine Änderungen auf noten-fritze.de.";
    hinweis.hidden = false;
    $("uebertragen").textContent = "Erneut übertragen";
    $("uebertragen").classList.remove("primary");
  }

  async function start() {
    const installiert = istInstalliert();
    $("app-hinweis").hidden = installiert;
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
    letztes = b;
    $("umfang").textContent = plural(klassen, "Klasse", "Klassen") + " mit " +
      plural(b.data.schueler.length, "Schüler/in", "Schüler/innen");
    $("mit-daten").hidden = false;
    if (installiert) {
      $("weg-installiert").hidden = false;
      // Am Computer (Chrome/Edge) teilen sich App und Browser den Speicher –
      // dort klappt auch die direkte Übertragung.
      if (!istIOS()) { $("weg-uebertragen").hidden = false; $("computer-hinweis").hidden = false; }
    } else {
      $("weg-uebertragen").hidden = false;
      $("weg-backup").hidden = false;
    }
    let schonAm = null;
    try { schonAm = localStorage.getItem(MERKER); } catch (_) { /* egal */ }
    if (schonAm) schonUebertragen(schonAm);
    $("uebertragen").addEventListener("click", uebertragen);
    Array.prototype.forEach.call(document.querySelectorAll(".sichern"), (btn) => btn.addEventListener("click", sichern));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        aktuellesBackup().then((neu) => { if (neu) letztes = neu; }).catch(() => { /* altes behalten */ });
      }
    });
  }

  start();
})();
