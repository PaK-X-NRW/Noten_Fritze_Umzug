# Noten-Fritze – Umzugsseite

Noten-Fritze ist von `noten-fritze.patrick-knapp.de` nach **https://noten-fritze.de** umgezogen.
Die App selbst liegt im Repo [PaK-X-NRW/Noten_Fritze](https://github.com/PaK-X-NRW/Noten_Fritze).

Dieses Repo läuft unter der **alten** Adresse. Grund: Die Daten der App liegen in IndexedDB,
und die ist an die Adresse gebunden. Unter der neuen Adresse startet die App leer. Diese Seite
kann die alten Daten noch lesen und überträgt sie an die neue Adresse. Sie ändert oder löscht
dabei nichts.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `umzug.js`, `umzug.css` | Umzugsseite: liest die Datenbank `noten-fritze`. Im Browser: Button „Daten übertragen“ (lädt zusätzlich automatisch ein Backup herunter), Backup als Rückfall. Als installierte App (`display-mode: standalone`): Anleitung über „Backup sichern“ (iOS: Teilen-Blatt) → neue App installieren → importieren → erst dann alte App löschen. Grund: Apps auf dem Home-Bildschirm haben unter iOS einen eigenen, vom Browser getrennten Speicher |
| `service-worker.js` | Löst den Offline-Cache der alten App ab (Cache löschen, Fenster neu laden, abmelden) |
| `404.html` | Jede unbekannte Adresse führt zur Umzugsseite |
| `info.html` | Leitet zur Infoseite unter der neuen Adresse weiter |
| `manifest.webmanifest`, `icons/` | Damit installierte Apps (PWA) weiter starten und die Umzugsseite zeigen |
| `google…html` | Verifizierung der alten Domain in der Google Search Console |
| `CNAME` | `noten-fritze.patrick-knapp.de` |

## Übertragungsprotokoll (postMessage)

Die Gegenstelle muss im Haupt-Repo eingebaut sein, **bevor** umgestellt wird.

1. Die Umzugsseite öffnet `https://noten-fritze.de/?umzug=1` per `window.open` (neues Fenster,
   kein iframe: in einem iframe bekäme die neue Adresse nur abgetrennten Drittanbieter-Speicher).
2. Die App unter der neuen Adresse sieht `?umzug=1` und `window.opener` und schickt
   `{ typ: "noten-fritze-umzug-bereit" }` an `https://noten-fritze.patrick-knapp.de`.
3. Die Umzugsseite antwortet mit `{ typ: "noten-fritze-umzug-daten", backup }`.
   `backup` hat das Format von `Store.exportAll({ mitDateien: true })` (`appVersion: "umzug"`):
   **alle** vorhandenen Stores außer `einstellungen` (davon nur der Datensatz `app`, ohne
   Export-Ordner-Handle), Datei-Inhalte als `daten64`. Neue Datenarten der App kommen so
   ohne Änderung an dieser Seite mit, sobald der Import der App sie kennt.
4. Die App prüft `event.origin`, fragt bei vorhandenen Daten nach (ersetzen / abbrechen),
   ruft `Store.importAll(backup, { replace: true })` auf und meldet
   `{ typ: "noten-fritze-umzug-fertig", ok: true }` bzw. `{ ok: false, fehler: "…" }`.

Beide Seiten prüfen die Absender-Adresse exakt, und die Umzugsseite zusätzlich das Fenster.

## Umstellung (Reihenfolge)

GitHub erlaubt eine eigene Domain nur in **einem** Repo. Deshalb:

1. `noten-fritze.de` im DNS auf GitHub Pages zeigen lassen und im GitHub-Konto verifizieren.
2. Haupt-Repo: Gegenstelle (Protokoll oben) veröffentlichen.
3. Haupt-Repo: `CNAME` auf `noten-fritze.de` ändern und „Enforce HTTPS“ aktivieren.
   Damit wird die alte Domain frei.
4. **Direkt danach** in diesem Repo: Settings → Pages → Branch `main` / Root, Custom domain
   `noten-fritze.patrick-knapp.de`, „Enforce HTTPS“. Der DNS-Eintrag der alten Subdomain
   bleibt unverändert (CNAME auf `pak-x-nrw.github.io`).
5. Testen: alte Adresse öffnen → Umzugsseite → „Daten übertragen“.
6. Dieses Repo mindestens bis Schuljahresende online lassen.
