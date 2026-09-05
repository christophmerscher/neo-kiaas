// Windows-Dienst fuer neo-KIAS.
//
// Der Dienst fuehrt die Anwendung nicht selbst aus, er haelt den
// Docker-Stapel am Leben: beim Start "docker compose up -d", beim Stoppen
// "docker compose down". Das eigentliche Programm laeuft in den Containern,
// so wie unter Linux auch.
//
// Warum ueberhaupt ein Dienst, wo Docker Desktop keiner ist: damit der
// Stapel ohne Zutun hochkommt und in der Dienstverwaltung sichtbar ist.
// Die Engine von Docker Desktop steht allerdings erst bereit, wenn sich ein
// Benutzer angemeldet hat. Deshalb wartet der Dienst geduldig darauf,
// statt sofort aufzugeben, und die Installation legt zusaetzlich eine
// Anmeldeaufgabe an. Doppelt startet nichts: "up -d" ist wiederholbar.
//
// Uebersetzt wird ohne SDK, mit dem csc.exe des .NET Framework 4:
//   csc /target:exe /out:NeoKiasService.exe /r:System.ServiceProcess.dll NeoKiasService.cs

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.ServiceProcess;
using System.Threading;

public class NeoKiasService : ServiceBase
{
    public const string SERVICE_NAME = "neo-KIAS";

    /// <summary>Abstand zwischen zwei Versuchen, die Engine zu erreichen.</summary>
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(15);

    /// <summary>So oft erinnert das Protokoll daran, dass noch gewartet wird.</summary>
    private static readonly TimeSpan RemindEvery = TimeSpan.FromMinutes(10);

    /// <summary>Das erste Bauen des Abbilds dauert Minuten.</summary>
    private const int BuildTimeoutMs = 45 * 60 * 1000;

    private const int ComposeTimeoutMs = 10 * 60 * 1000;

    private Thread worker;
    private volatile bool stopping;
    private readonly string installDir;
    private readonly string logFile;

    public NeoKiasService()
    {
        ServiceName = SERVICE_NAME;
        CanStop = true;
        CanShutdown = true;

        // Der Dienst liegt in <Installation>\service\, das Compose-Projekt
        // eine Ebene darueber.
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        installDir = Path.GetFullPath(Path.Combine(exeDir, ".."));

        string logDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "neo-KIAS");
        try { Directory.CreateDirectory(logDir); }
        catch { /* dann bleibt nur das Ereignisprotokoll */ }
        logFile = Path.Combine(logDir, "service.log");
    }

    public static void Main(string[] args)
    {
        NeoKiasService service = new NeoKiasService();

        // Mit "--once" laesst sich derselbe Ablauf von Hand ausloesen, ohne
        // den Dienstverwalter. Hilfreich beim Suchen nach der Ursache, wenn
        // der Stapel nicht hochkommt.
        if (args.Length > 0 && args[0] == "--once")
        {
            service.BringUp();
            return;
        }

        ServiceBase.Run(service);
    }

    protected override void OnStart(string[] args)
    {
        Log("Dienst startet, Installation: " + installDir);
        stopping = false;
        // Der Dienstverwalter erwartet eine schnelle Rueckkehr. Alles
        // Langsame, und das Warten auf Docker ist langsam, gehoert deshalb
        // in einen eigenen Faden.
        worker = new Thread(BringUp);
        worker.IsBackground = true;
        worker.Start();
    }

    protected override void OnStop()
    {
        Log("Dienst wird gestoppt");
        stopping = true;
        if (worker != null && worker.IsAlive) worker.Join(TimeSpan.FromSeconds(20));

        string output;
        int code = RunDocker("compose down", ComposeTimeoutMs, out output);
        Log(code == 0 ? "Container gestoppt" : "compose down meldete " + code + ": " + output);
    }

    protected override void OnShutdown()
    {
        // Beim Herunterfahren nicht noch minutenlang aufraeumen, Windows
        // wartet nicht. Die Container haben "restart: unless-stopped" und
        // kommen beim naechsten Start von allein wieder.
        stopping = true;
    }

    /// <summary>Warten, notfalls bauen, dann starten.</summary>
    private void BringUp()
    {
        try
        {
            if (!WaitForEngine()) return;   // nur beim Stoppen
            if (stopping) return;

            string output;
            if (RunDocker("image inspect neo-kias:local", 60000, out output) != 0)
            {
                Log("Abbild fehlt, es wird gebaut. Das dauert einige Minuten.");
                int build = RunDocker("compose build", BuildTimeoutMs, out output);
                if (build != 0)
                {
                    Log("Der Bau ist fehlgeschlagen (" + build + "): " + Tail(output));
                    return;
                }
                Log("Abbild gebaut");
            }
            if (stopping) return;

            int code = RunDocker("compose up -d", ComposeTimeoutMs, out output);
            Log(code == 0
                ? "Container gestartet"
                : "compose up meldete " + code + ": " + Tail(output));
        }
        catch (Exception ex)
        {
            Log("Unerwarteter Fehler: " + ex.Message);
        }
    }

    /// <summary>
    /// Warten, bis die Engine antwortet. Ohne Zeitlimit.
    ///
    /// Docker Desktop laeuft nur, solange ein Benutzer angemeldet ist, und
    /// startet nach dem Hochfahren erst mit dessen Anmeldung. Wann das ist,
    /// weiss niemand: eine Frist waere geraten, und danach bliebe der
    /// Stapel bis zum naechsten Neustart unten. Also wartet der Dienst,
    /// bis die Engine da ist oder er selbst gestoppt wird, und erinnert
    /// alle zehn Minuten im Protokoll daran, woran es liegt.
    /// </summary>
    /// <returns>true, wenn die Engine antwortet; false nur beim Stoppen.</returns>
    private bool WaitForEngine()
    {
        bool announced = false;
        DateTime nextReminder = DateTime.UtcNow + RemindEvery;
        while (!stopping)
        {
            string output;
            // "docker version" und nicht "docker info": info liefert auch
            // dann den Rueckgabewert 0, wenn nur der Client antwortet und
            // die Engine fehlt. Zusaetzlich die Ausgabe ansehen, denn der
            // Client schreibt seinen Verbindungsfehler ins Ergebnis.
            int code = RunDocker("version --format {{.Server.Version}}", 30000, out output);
            string version = (output ?? "").Trim();
            bool reachable = code == 0
                && version.Length > 0
                && version.IndexOf("error", StringComparison.OrdinalIgnoreCase) < 0;
            if (reachable)
            {
                Log("Docker-Engine erreichbar, Version " + version);
                return true;
            }
            if (!announced)
            {
                Log("Warte auf die Docker-Engine. Sie steht erst bereit, wenn "
                    + "Docker Desktop laeuft, und das braucht eine angemeldete "
                    + "Sitzung. Meldung: " + Tail(output));
                announced = true;
            }
            else if (DateTime.UtcNow >= nextReminder)
            {
                Log("Warte weiterhin auf die Docker-Engine.");
                nextReminder = DateTime.UtcNow + RemindEvery;
            }
            // In kleinen Schritten schlafen, damit ein Stopp nicht erst
            // nach der vollen Wartezeit bemerkt wird.
            int slept = 0;
            while (slept < RetryDelay.TotalMilliseconds && !stopping)
            {
                Thread.Sleep(500);
                slept += 500;
            }
        }
        return false;
    }

    /// <summary>docker.exe finden. Der Systemkontext hat den PATH nicht immer.</summary>
    private static string FindDocker()
    {
        string[] candidates = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                         @"Docker\Docker\resources\bin\docker.exe"),
            @"C:\Program Files\Docker\Docker\resources\bin\docker.exe",
            @"C:\ProgramData\DockerDesktop\version-bin\docker.exe",
        };
        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }
        // Letzter Versuch: ueber den PATH, dann loest Windows selbst auf.
        return "docker.exe";
    }

    private int RunDocker(string arguments, int timeoutMs, out string output)
    {
        ProcessStartInfo psi = new ProcessStartInfo(FindDocker(), arguments);
        psi.WorkingDirectory = installDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;

        try
        {
            using (Process process = Process.Start(psi))
            {
                string stdout = process.StandardOutput.ReadToEnd();
                string stderr = process.StandardError.ReadToEnd();
                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch { }
                    output = "Zeitueberschreitung nach " + (timeoutMs / 1000) + " s";
                    return -2;
                }
                output = (stdout + stderr).Trim();
                return process.ExitCode;
            }
        }
        catch (Exception ex)
        {
            output = ex.Message;
            return -1;
        }
    }

    private static string Tail(string text)
    {
        if (string.IsNullOrEmpty(text)) return "(keine Ausgabe)";
        text = text.Replace("\r\n", " ").Replace("\n", " ").Trim();
        return text.Length <= 300 ? text : text.Substring(text.Length - 300);
    }

    private void Log(string message)
    {
        string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message;
        try { File.AppendAllText(logFile, line + Environment.NewLine); }
        catch { /* ein nicht schreibbares Protokoll darf den Dienst nicht stoppen */ }
        try { EventLog.WriteEntry(SERVICE_NAME, message, EventLogEntryType.Information); }
        catch { }
    }
}
