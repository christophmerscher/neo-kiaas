// Custom Actions der neo-KIAS-MSI.
//
// Zwei Pruefungen, die waehrend der Oberflaeche laufen und nichts aendern:
// liegt unter dem angegebenen Pfad wirklich eine KIAS-Datenbank, und ist
// Docker Desktop schon da.
//
// Bewusst JScript und keine kompilierte Custom Action: das haelt die
// Werkzeugkette beim Bauen klein (kein C-Compiler, kein DTF), und beide
// Aktionen sind kurz genug, dass sie sich in dieser Sprache noch lesen
// lassen. Beide laufen "immediate", greifen also nur auf Eigenschaften
// und das Dateisystem zu.

/* global Session */

var MSG_ERROR = 1;

/** Eigenschaft lesen, ohne bei fehlender Eigenschaft zu stolpern. */
function prop(name) {
    try { return Session.Property(name); } catch (e) { return ''; }
}

function setProp(name, value) {
    Session.Property(name) = value;
}

/** Zeile ins MSI-Protokoll, damit ein Fehlschlag spaeter nachvollziehbar ist. */
function log(text) {
    try {
        var record = Session.Installer.CreateRecord(1);
        record.StringData(0) = 'neo-KIAS: [1]';
        record.StringData(1) = text;
        Session.Message(0x04000000, record);   // INSTALLMESSAGE_INFO
    } catch (e) { /* Protokollieren darf nie der Grund des Scheiterns sein */ }
}

function endsWithBackslash(path) {
    return path.length > 0 && path.charAt(path.length - 1) === '\\';
}

function join(path, name) {
    return endsWithBackslash(path) ? path + name : path + '\\' + name;
}

/**
 * Pruefen, ob unter KIASDATADIR eine KIAS-Datenbank liegt.
 *
 * Setzt KIASDATADIR_VALID auf "1" oder "0" und KIASDATADIR_PROBLEM auf den
 * Satz, den der Dialog anzeigt. Die Oberflaeche laesst erst weiter, wenn
 * hier "1" steht; ein Vertipper faellt damit vor der Installation auf und
 * nicht erst zwei Minuten spaeter an einer leeren Datenbank.
 */
function CheckDataDir() {
    var fso = new ActiveXObject('Scripting.FileSystemObject');
    var dir = prop('KIASDATADIR');

    setProp('KIASDATADIR_VALID', '0');

    if (!dir) {
        setProp('KIASDATADIR_PROBLEM', 'Bitte ein Verzeichnis angeben.');
        return 1;   // ERROR_SUCCESS: die Aktion selbst ist geglueckt
    }

    if (!fso.FolderExists(dir)) {
        setProp('KIASDATADIR_PROBLEM',
            'Das Verzeichnis "' + dir + '" gibt es nicht.');
        return 1;
    }

    var daten = join(dir, 'Daten');
    if (!fso.FolderExists(daten)) {
        setProp('KIASDATADIR_PROBLEM',
            'Unter "' + dir + '" fehlt der Ordner "Daten". Gemeint ist das '
            + 'Verzeichnis, das Daten, Update und Formulare enthaelt, nicht '
            + 'einer davon.');
        return 1;
    }

    // Ein Ordner "Daten" ohne DBF-Dateien ist genauso unbrauchbar wie keiner.
    var dbf = 0;
    var files = new Enumerator(fso.GetFolder(daten).Files);
    for (; !files.atEnd(); files.moveNext()) {
        var name = files.item().Name.toLowerCase();
        if (name.length > 4 && name.substr(name.length - 4) === '.dbf') dbf++;
    }
    if (dbf === 0) {
        setProp('KIASDATADIR_PROBLEM',
            'In "' + daten + '" liegt keine einzige DBF-Datei.');
        return 1;
    }

    // Leseprobe: ein Verzeichniseintrag sagt noch nicht, dass die Datei auch
    // gelesen werden darf.
    try {
        var probe = null;
        var again = new Enumerator(fso.GetFolder(daten).Files);
        for (; !again.atEnd(); again.moveNext()) {
            var candidate = again.item();
            if (candidate.Name.toLowerCase().indexOf('.dbf') > 0) { probe = candidate; break; }
        }
        if (probe !== null) {
            var stream = fso.OpenTextFile(probe.Path, 1, false);
            stream.Close();
        }
    } catch (e) {
        setProp('KIASDATADIR_PROBLEM',
            'Die Dateien unter "' + daten + '" lassen sich nicht lesen: ' + e.message);
        return 1;
    }

    setProp('KIASDATADIR_VALID', '1');
    setProp('KIASDATADIR_PROBLEM', '');
    // Ohne Schraegstrich am Ende weitergeben: KIASDATADIR ist eine
    // Verzeichniseigenschaft und endet deshalb immer auf einem Rueckstrich.
    // In einer Kommandozeile wuerde "C:\Kias\" das schliessende
    // Anfuehrungszeichen entwerten und alles Folgende verschlucken.
    setProp('KIASDATADIR_CLEAN', endsWithBackslash(dir) ? dir.substr(0, dir.length - 1) : dir);
    log('Datenverzeichnis geprueft: ' + dir + ', ' + dbf + ' DBF-Dateien');
    return 1;
}

/**
 * Das Installationsverzeichnis ohne Schraegstrich am Ende bereitstellen.
 *
 * Der Wert einer Verzeichniseigenschaft endet in Windows Installer immer
 * auf einem Rueckstrich. Steht er in einer Kommandozeile direkt vor dem
 * schliessenden Anfuehrungszeichen, entwertet er es, und alles Folgende
 * gehoert ploetzlich zum selben Argument. Ein aufgeraeumter Wert kostet
 * eine Zeile und erspart eine sehr schwer zu findende Fehlersuche.
 *
 * Laeuft nach CostFinalize, vorher steht INSTALLFOLDER noch nicht fest.
 */
function CleanPaths() {
    var dir = prop('INSTALLFOLDER');
    setProp('INSTALLFOLDER_CLEAN', endsWithBackslash(dir) ? dir.substr(0, dir.length - 1) : dir);
    log('Installationsverzeichnis: ' + prop('INSTALLFOLDER_CLEAN'));
    return 1;
}

/**
 * Den Abschlusstext an das anpassen, was tatsaechlich vorliegt.
 *
 * Laeuft in der Oberflaeche, nachdem die eigentliche Installation fertig
 * ist, und sieht noch einmal selbst nach: der Benutzer kann Docker Desktop
 * waehrend des Assistenten nachgeholt haben.
 *
 * Der Grund fuer den Aufwand: eine Installation, die "erfolgreich
 * abgeschlossen" meldet, waehrend Docker fehlt und deshalb nichts laeuft,
 * schickt den Benutzer auf eine lange Suche.
 */
function ExitText() {
    var gut = 'Die Suche laeuft auf http://localhost:5175, die Verwaltung auf '
        + 'http://localhost:5177 (Benutzer admin). Das Passwort steht in der Datei '
        + '.env im Installationsverzeichnis unter KIAS_ADMIN_PASSWORD. Der Dienst '
        + 'neo-KIAS baut beim ersten Start das Docker-Abbild; das dauert einige '
        + 'Minuten, der Fortschritt steht in %ProgramData%\\neo-KIAS\\service.log.';

    var schlecht = 'ACHTUNG: Docker Desktop wurde nicht gefunden. neo-KIAS ist '
        + 'vollstaendig installiert, laeuft aber erst, wenn Docker da ist. Bitte '
        + 'Docker Desktop von https://www.docker.com/products/docker-desktop/ '
        + 'installieren und einmal starten. Der Dienst neo-KIAS wartet darauf und '
        + 'startet die Anwendung dann von allein; der Fortschritt steht in '
        + '%ProgramData%\\neo-KIAS\\service.log.';

    var present = dockerPresent();
    setProp('WIXUI_EXITDIALOGOPTIONALTEXT', present ? gut : schlecht);
    log('Abschlusstext gesetzt, Docker vorhanden: ' + (present ? 'ja' : 'nein'));
    return 1;
}

/**
 * Die Docker-Seite im Standardbrowser oeffnen.
 *
 * Aufgerufen aus dem Hinweisfenster. Eine Adresse zum Abtippen waere hier
 * die einzige Alternative, und genau daran scheitert es dann.
 */
function OpenDockerPage() {
    try {
        var shell = new ActiveXObject('WScript.Shell');
        shell.Run('https://www.docker.com/products/docker-desktop/', 1, false);
    } catch (e) {
        log('Die Docker-Seite liess sich nicht oeffnen: ' + e.message);
    }
    return 1;
}

/**
 * Liegt Docker Desktop auf der Platte?
 *
 * Gesucht wird nach der Anwendung und nach docker.exe. Gefunden heisst
 * nicht "laeuft gerade", das kann die Installation nicht verlangen: der
 * Dienst wartet spaeter selbst darauf, dass die Engine antwortet.
 */
function dockerPresent() {
    var fso = new ActiveXObject('Scripting.FileSystemObject');
    var shell = new ActiveXObject('WScript.Shell');

    var programFiles = '';
    try { programFiles = shell.ExpandEnvironmentStrings('%ProgramFiles%'); } catch (e) { }
    if (!programFiles || programFiles === '%ProgramFiles%') programFiles = 'C:\\Program Files';

    return fso.FileExists(join(programFiles, 'Docker\\Docker\\Docker Desktop.exe'))
        || fso.FileExists(join(programFiles, 'Docker\\Docker\\resources\\bin\\docker.exe'));
}

/**
 * Docker suchen und das Ergebnis in DOCKER_PRESENT hinterlegen.
 *
 * Laeuft einmal zu Beginn und noch einmal, wenn im Hinweisfenster auf
 * "Erneut pruefen" geklickt wird, nachdem Docker nachgeholt wurde.
 */
function CheckDocker() {
    var present = dockerPresent();
    setProp('DOCKER_PRESENT', present ? '1' : '0');
    log('Docker Desktop gefunden: ' + (present ? 'ja' : 'nein'));
    return 1;
}
