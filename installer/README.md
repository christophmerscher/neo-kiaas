# neo-KIAS als MSI

Ein Installationspaket für Windows 11, das neo-KIAS ablegt, die
Konfiguration erzeugt und einen Windows-Dienst einrichtet, der die
Docker-Container startet.

Herausgeber ist **fMerscher**, das Produkt heißt **neo-KIAS**, die Lizenz
ist MIT und muss im Installationsprogramm ausdrücklich angenommen werden.

## Voraussetzung

**Docker Desktop muss vorher installiert und einmal gestartet worden
sein.** Zu holen unter <https://www.docker.com/products/docker-desktop/>.
Docker verlangt seinerseits WSL 2 und eingeschaltete Virtualisierung, in
einer virtuellen Maschine also verschachtelte Virtualisierung. Die MSI
prüft das und sagt es, installiert Docker aber nicht selbst; warum,
steht weiter unten.

## Bauen

Einmalig die Werkzeuge holen:

```bash
dotnet tool install --global wix
```

```bash
wix extension add -g WixToolset.UI.wixext/5.0.2
```

```bash
wix extension add -g WixToolset.Util.wixext/5.0.2
```

Dann:

```bash
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

Das Ergebnis liegt unter `installer\build\neo-KIAS.msi`. Das Skript
übersetzt zuerst den Dienst mit dem `csc.exe` des .NET Framework, wandelt
`License.txt` nach RTF, sammelt die Projektdateien in eine
WiX-Dateiliste, ruft `wix build` auf und prüft das Paket mit den
ICE-Regeln.

Ein .NET SDK wird nur für das WiX-Werkzeug gebraucht, nicht für den
Dienst: der übersetzt sich mit dem Compiler, der in jedem Windows steckt.

## Was das Paket beim Installieren tut

1. **Lizenz.** Der Dialog zeigt `License.txt` als RTF. Ohne Zustimmung
   bleibt die Schaltfläche „Weiter" gesperrt, das ist Standardverhalten
   von Windows Installer.
2. **Zielverzeichnis**, voreingestellt `C:\Program Files\neo-KIAS`.
3. **Datenverzeichnis.** Eigener Dialog mit Eingabefeld und
   Durchsuchen-Schaltfläche. Beim Klick auf „Weiter" prüft eine Custom
   Action, ob dort ein Ordner `Daten` mit DBF-Dateien liegt und ob sich
   eine davon lesen lässt. Schlägt das fehl, erscheint die Meldung, und
   der Dialog bleibt stehen. Weiter geht es erst mit einem brauchbaren
   Pfad.
4. **Docker.** Eine zweite Custom Action sucht `Docker Desktop.exe` und
   `docker.exe`. Fehlt beides, erscheint ein Hinweisfenster: Docker
   Desktop ist Voraussetzung und muss selbst installiert werden. Das
   Fenster hat eine Schaltfläche, die die Seite von Docker öffnet, und
   eine zweite, die noch einmal nachsieht, wenn das erledigt ist. Weiter
   geht es auch ohne, die Dateien und der Dienst sind ja unabhängig davon
   richtig.
5. **Dateien ablegen**, `.env` erzeugen (`msi-configure.ps1`, benutzt
   dieselben Helfer wie das PowerShell-Skript unter `scripts\`), Dienst
   registrieren und starten.

Fehlt Docker am Ende immer noch, sagt das Abschlussfenster genau das,
statt nur „erfolgreich abgeschlossen" zu melden. Die Aktion `ExitText`
sieht dafür noch einmal selbst nach.

## Warum Docker nicht mitinstalliert wird

Eine frühere Fassung hat Docker Desktop geladen und still eingerichtet.
Das ist wieder heraus, und zwar aus Gründen, die sich nicht wegprogrammieren
lassen:

- Docker Desktop braucht WSL 2 und eingeschaltete Virtualisierung. Sein
  eigenes Installationsprogramm richtet das ein und verlangt danach einen
  Neustart. Eine MSI, die währenddessen offen bleibt, kann das nicht
  auflösen.
- In einer virtuellen Maschine läuft das nur mit verschachtelter
  Virtualisierung. Unter VirtualBox ist die je nach Fassung gar nicht oder
  nur für AMD-Prozessoren zu haben. Dann installiert sich Docker zwar,
  startet aber nie.
- Der Download sind rund 600 MB. Reißt er ab, hat der Benutzer eine
  Viertelstunde gewartet und trotzdem kein Docker.

Ein Satz mit der Bezugsquelle ist ehrlicher und schneller. Für einen
Rechner, der unbeaufsichtigt durchlaufen soll, bleibt ohnehin die
Debian-Installation die bessere Wahl, dort ist die Engine ein Dienst.

Das Docker-Abbild wird **nicht** während der Installation gebaut. Bei
einer eben erst nachinstallierten Docker-Umgebung läuft die Engine noch
gar nicht, und eine Installation, die zwanzig Minuten auf einen Container
wartet, würde jeder abbrechen. Stattdessen macht es der Dienst beim ersten
Start.

## Der Dienst

`NeoKiasService.exe`, angelegt als `neo-KIAS`, Start automatisch, Konto
LocalSystem. Er führt die Anwendung nicht selbst aus, sondern hält den
Docker-Stapel am Leben:

- beim Start: auf die Docker-Engine warten, ohne Zeitlimit, dann das
  Abbild bauen falls es fehlt, dann `docker compose up -d`. Kein Limit,
  weil niemand weiß, wann sich jemand anmeldet; nach einer Frist bliebe
  der Stapel sonst bis zum nächsten Neustart unten. Alle zehn Minuten
  steht im Protokoll, worauf gewartet wird.
- beim Stoppen: `docker compose down`
- Protokoll: `%ProgramData%\neo-KIAS\service.log`

Zum Suchen nach Ursachen lässt sich derselbe Ablauf von Hand auslösen:

```bash
"C:\Program Files\neo-KIAS\service\NeoKiasService.exe" --once
```

**Die Einschränkung, die man kennen muss:** Docker Desktop ist kein
Dienst, sondern eine Anwendung, und seine Engine steht erst bereit, wenn
sich ein Benutzer angemeldet hat. Der Dienst startet zwar beim Hochfahren,
findet aber bis zur ersten Anmeldung keine Engine und wartet. Auf einem
Rechner, der wirklich unbeaufsichtigt durchlaufen soll, ist die
Debian-Installation die bessere Wahl.

## Stille Installation

```bash
msiexec /i neo-KIAS.msi /qn KIASDATADIR=C:\Kias
```

Die Prüfung des Datenverzeichnisses läuft auch hier. Ist der Pfad
unbrauchbar, bricht die Installation mit einer Meldung ab, statt ein
Produkt zu hinterlassen, das nichts findet.

Weitere Eigenschaften: `INSTALLFOLDER` für das Zielverzeichnis,
`ADMINPASSWORD` für das Passwort der Verwaltung. Ohne Angabe wird eines
gewürfelt; es steht danach in der `.env` im Installationsverzeichnis.

Deinstallieren:

```bash
msiexec /x neo-KIAS.msi /qn
```

Dabei werden die Container gestoppt und der Dienst entfernt. Die
Docker-Volumes bleiben liegen, darin stehen die Einstellungen der
Verwaltung.

## Dateien

| Datei | Zweck |
|---|---|
| `neo-KIAS.wxs` | Das Paket: Verzeichnisse, Dienst, Dialoge, Ablauf |
| `CustomActions.js` | Prüfung des Datenpfads, Suche nach Docker, Abschlusstext |
| `msi-configure.ps1` | Erzeugt die `.env`, aufgerufen aus dem Paket |
| `service\NeoKiasService.cs` | Der Windows-Dienst |
| `License.txt` | Lizenz und Haftungsausschluss, Quelle für das RTF |
| `build.ps1` | Baut alles zusammen |

Die Prüfungen liegen bewusst in JScript und nicht in einer übersetzten
Custom Action: das hält die Werkzeugkette klein, und beide Aktionen sind
kurz genug, dass sie sich in dieser Sprache noch lesen lassen.
