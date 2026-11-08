using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyVersion("0.3.6.0")]
[assembly: AssemblyFileVersion("0.3.6.0")]

internal static class Setup
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length == 2 && args[0] == "--verify-to")
        {
            // Verificação automatizada: extrair e validar, sem dependências, atalhos ou banco.
            try { Payload.Extract(args[1]); Environment.ExitCode = 0; }
            catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
            return;
        }
        if (args.Length == 2 && args[0] == "--snapshot")
        {
            using (var form = new SetupForm())
            {
                form.Show(); Application.DoEvents();
                using (var image = new Bitmap(form.Width, form.Height))
                { form.DrawToBitmap(image, new Rectangle(Point.Empty, form.Size)); image.Save(args[1]); }
            }
            return;
        }
        using (var mutex = new Mutex(false, "Local\\JobTrackerInstaller"))
        {
            bool acquired;
            try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) { MessageBox.Show("Outro instalador do Job Tracker está em execução.", "Job Tracker"); return; }
            try { Application.Run(new SetupForm()); } finally { mutex.ReleaseMutex(); }
        }
    }
}

internal sealed class ReleaseEntry
{
    public string path { get; set; }
    public string sha256 { get; set; }
    public int size { get; set; }
}

internal static class Payload
{
    public static void Extract(string destination, Action<int, string> report = null)
    {
        destination = Path.GetFullPath(destination);
        Directory.CreateDirectory(destination);
        string prefix = destination.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var assembly = Assembly.GetExecutingAssembly();
        List<ReleaseEntry> manifest;
        using (var reader = new StreamReader(assembly.GetManifestResourceStream("release-manifest.json"), Encoding.UTF8))
            manifest = new JavaScriptSerializer().Deserialize<List<ReleaseEntry>>(reader.ReadToEnd());
        var expected = new Dictionary<string, ReleaseEntry>(StringComparer.Ordinal);
        foreach (var entry in manifest) expected.Add(entry.path, entry);
        long totalBytes = 0, verifiedBytes = 0, extractedBytes = 0;
        foreach (var record in manifest) totalBytes += record.size;
        int lastPercent = -1;
        Action<int, string> progress = delegate(int percent, string message) {
            if (report != null && percent != lastPercent) { lastPercent = percent; report(percent, message); }
        };
        progress(0, "Verificando a integridade do pacote...");
        using (var stream = assembly.GetManifestResourceStream("payload.zip"))
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
        {
            if (zip.Entries.Count != expected.Count) throw new InvalidDataException("Quantidade inesperada de arquivos no pacote.");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // Validar todo o pacote antes de gravar o primeiro arquivo.
            foreach (var entry in zip.Entries)
            {
                ReleaseEntry record;
                if (!seen.Add(entry.FullName) || !expected.TryGetValue(entry.FullName, out record)) throw new InvalidDataException("Arquivo inesperado no pacote.");
                string normalized = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                string target = Path.GetFullPath(Path.Combine(destination, normalized));
                if (Path.IsPathRooted(normalized) || !target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Caminho inválido no pacote.");
                if (entry.Length != record.size || entry.Length > 40 * 1024 * 1024) throw new InvalidDataException("Tamanho inválido no pacote.");
                using (var input = entry.Open())
                using (var hash = SHA256.Create())
                {
                    string digest = BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
                    if (digest != record.sha256) throw new InvalidDataException("Falha na integridade do pacote.");
                }
                // Não seguir junções ou links de uma instalação adulterada.
                string ancestor = target;
                while (ancestor != null && ancestor.Length >= destination.Length)
                {
                    if ((File.Exists(ancestor) || Directory.Exists(ancestor)) && (File.GetAttributes(ancestor) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("Pasta de instalação contém um link. Escolha uma pasta normal.");
                    ancestor = Path.GetDirectoryName(ancestor);
                }
                if (entry.FullName.EndsWith(".env", StringComparison.OrdinalIgnoreCase) || entry.FullName.StartsWith("dist/windows/runtime/", StringComparison.OrdinalIgnoreCase) || entry.FullName.StartsWith("data/"))
                    throw new InvalidDataException("O pacote contém dados locais proibidos.");
                verifiedBytes += entry.Length;
                progress(totalBytes == 0 ? 50 : (int)(verifiedBytes * 50 / totalBytes), "Verificando a integridade do pacote...");
            }
            foreach (var entry in zip.Entries)
            {
                string target = Path.Combine(destination, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (var input = entry.Open())
                using (var output = File.Create(target)) input.CopyTo(output);
                extractedBytes += entry.Length;
                progress(totalBytes == 0 ? 100 : 50 + (int)(extractedBytes * 50 / totalBytes), "Preparando os arquivos do programa...");
            }
        }
        File.WriteAllText(Path.Combine(destination, "windows", "installed-files.json"), new JavaScriptSerializer().Serialize(manifest), Encoding.UTF8);
    }
}

internal sealed class SetupForm : Form
{
    private string destination = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JobTracker", "app");
    private readonly TextBox folder = new TextBox();
    private readonly ProgressBar progress = new ProgressBar();
    private readonly Label progressText = new Label();
    private readonly Label progressPercent = new Label();
    private readonly Button browse = new Button();
    private readonly TextBox log = new TextBox();
    private readonly Button install = new Button();
    private bool working;
    private bool installationFinished;

    private readonly TableLayoutPanel layout = new TableLayoutPanel();
    private readonly TableLayoutPanel setupPanel = new TableLayoutPanel();
    private readonly TableLayoutPanel activityPanel = new TableLayoutPanel();
    private readonly Panel recoveryPanel = new Panel();
    private readonly Label errorMessage = new Label();
    private readonly LinkLabel details = new LinkLabel();
    private bool detailsVisible;

    public SetupForm()
    {
        Text = "Instalar Job Tracker 0.3.6";
        Font = new Font("Segoe UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        BackColor = Color.FromArgb(246, 248, 251);
        try { using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\JobTracker")) { if (key != null) destination = key.GetValue("InstallLocation", destination).ToString(); } } catch { }

        layout.Dock = DockStyle.Fill; layout.Padding = new Padding(20);
        layout.ColumnCount = 1; layout.RowCount = 4;
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (int row = 0; row < 4; row++) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 0));
        Controls.Add(layout);
        setupPanel.Dock = DockStyle.Fill; setupPanel.Margin = Padding.Empty;
        setupPanel.ColumnCount = 2; setupPanel.RowCount = 3;
        setupPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        setupPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 104));
        setupPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        setupPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        setupPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        var label = new Label { Text = "Pasta de instalação", Dock = DockStyle.Fill, Margin = Padding.Empty };
        setupPanel.Controls.Add(label, 0, 0); setupPanel.SetColumnSpan(label, 2);
        folder.Text = destination; folder.Dock = DockStyle.Fill; folder.Margin = new Padding(0, 0, 8, 0);
        folder.AccessibleName = "Pasta de instalação";
        browse.Text = "Escolher..."; browse.Dock = DockStyle.Top; browse.Height = 29; browse.Margin = Padding.Empty;
        setupPanel.Controls.Add(folder, 0, 1); setupPanel.Controls.Add(browse, 1, 1);
        install.Text = "Baixar e instalar"; install.Size = new Size(164, 38); install.Margin = Padding.Empty;
        setupPanel.Controls.Add(install, 0, 2);
        layout.Controls.Add(setupPanel, 0, 0);

        activityPanel.Dock = DockStyle.Fill; activityPanel.Margin = Padding.Empty;
        activityPanel.ColumnCount = 1; activityPanel.RowCount = 3;
        activityPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (int height in new[] { 28, 24, 28 }) activityPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        progressText.Dock = DockStyle.Fill; progressText.Margin = Padding.Empty;
        progressText.AccessibleName = "Etapa da instalação";
        progress.Dock = DockStyle.Fill; progress.Margin = new Padding(0, 0, 0, 4);
        progress.AccessibleName = "Progresso geral da instalação";
        progressPercent.Dock = DockStyle.Fill; progressPercent.Margin = Padding.Empty;
        progressPercent.ForeColor = Color.FromArgb(75, 85, 99);
        activityPanel.Controls.Add(progressText, 0, 0); activityPanel.Controls.Add(progress, 0, 1); activityPanel.Controls.Add(progressPercent, 0, 2);
        layout.Controls.Add(activityPanel, 0, 1);

        recoveryPanel.Dock = DockStyle.Fill; recoveryPanel.Margin = Padding.Empty;
        errorMessage.Dock = DockStyle.Top; errorMessage.Height = 60; errorMessage.ForeColor = Color.FromArgb(153, 27, 27);
        errorMessage.AccessibleName = "Erro da instalação";
        details.Text = "Mostrar detalhes"; details.Dock = DockStyle.Bottom; details.Height = 26;
        recoveryPanel.Controls.Add(errorMessage); recoveryPanel.Controls.Add(details);
        layout.Controls.Add(recoveryPanel, 0, 2);
        log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical; log.Dock = DockStyle.Fill;
        log.Margin = new Padding(0, 8, 0, 0); log.AccessibleName = "Registros da instalação";
        layout.Controls.Add(log, 0, 3);
        details.LinkClicked += delegate { detailsVisible = !detailsVisible; ShowView("error", errorMessage.Text); };
        browse.Click += delegate {
            using (var picker = new FolderBrowserDialog { Description = "Escolha uma pasta exclusiva para o Job Tracker", SelectedPath = folder.Text, ShowNewFolderButton = true })
                if (picker.ShowDialog(this) == DialogResult.OK) folder.Text = picker.SelectedPath;
        };
        install.Click += async delegate { await Install(); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (working) { e.Cancel = true; MessageBox.Show("Aguarde o término da instalação.", "Job Tracker"); } };
        ShowView("setup");
    }

    private void ShowView(string mode, string error = null)
    {
        bool setup = mode == "setup" || mode == "error";
        bool failed = mode == "error";
        float scale = DeviceDpi / 96f;
        layout.SuspendLayout();
        setupPanel.Visible = setup;
        activityPanel.Visible = !setup;
        recoveryPanel.Visible = failed;
        errorMessage.Visible = details.Visible = failed;
        log.Visible = failed && detailsVisible;
        if (error != null) errorMessage.Text = error;
        details.Text = detailsVisible ? "Ocultar detalhes" : "Mostrar detalhes";
        install.Text = failed ? "Tentar novamente" : "Baixar e instalar";
        layout.RowStyles[0].Height = setup ? 116 * scale : 0;
        layout.RowStyles[1].Height = !setup ? 80 * scale : 0;
        layout.RowStyles[2].Height = (failed ? 96 : 0) * scale;
        layout.RowStyles[3].Height = failed && detailsVisible ? 200 * scale : 0;
        ClientSize = new Size((int)((setup ? 560 : 480) * scale), (int)((40 + (setup ? 116 : 80) + (failed ? 96 : 0) + (failed && detailsVisible ? 200 : 0)) * scale));
        layout.ResumeLayout(true);
        if (mode == "progress") progressText.Focus();
    }

    private void UpdateProgress(int percent, string message, bool indeterminate)
    {
        progress.Value = Math.Max(progress.Value, Math.Max(0, Math.Min(100, percent)));
        progress.Style = indeterminate ? ProgressBarStyle.Marquee : ProgressBarStyle.Blocks;
        progress.MarqueeAnimationSpeed = indeterminate ? 30 : 0;
        progressText.Text = message;
        progressPercent.Text = progress.Value + "% • progresso geral por etapas";
    }

    private void HandleOutput(string text)
    {
        if (String.IsNullOrEmpty(text) || IsDisposed || !IsHandleCreated) return;
        Post(delegate {
            if (IsDisposed) return;
            const string prefix = "JOBTRACKER_PROGRESS:";
            if (text.StartsWith(prefix, StringComparison.Ordinal)) {
                if (installationFinished) return;
                try {
                    var update = new JavaScriptSerializer().Deserialize<InstallProgress>(text.Substring(prefix.Length));
                    if (update.completed < 2 || update.completed > 6 || String.IsNullOrWhiteSpace(update.message)) throw new InvalidDataException();
                    UpdateProgress(update.completed * 100 / 7, update.message, update.indeterminate);
                    return;
                } catch { /* Preservar mensagens inválidas nos registros. */ }
            }
            log.AppendText(text + Environment.NewLine);
        });
    }

    private void Post(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke((Action)delegate { if (!IsDisposed) action(); }); }
        catch (InvalidOperationException) { /* A janela já está encerrando. */ }
    }

    private void Append(string text)
    {
        if (!String.IsNullOrEmpty(text)) Post(delegate { log.AppendText(text + Environment.NewLine); });
    }

    private static bool ContainsFilesOrLinks(string directory)
    {
        foreach (string entry in Directory.GetFileSystemEntries(directory)) {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0 || (attributes & FileAttributes.Directory) == 0) return true;
            if (ContainsFilesOrLinks(entry)) return true;
        }
        return false;
    }

    private static ProcessStartInfo InitializationInfo(string root)
    {
        return new ProcessStartInfo("powershell.exe", "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "windows", "initialize.ps1") + "\" -InstallPrerequisites") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = root,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
    }

    private async Task Install()
    {
        working = true; install.Enabled = false;
        bool success = false;
        installationFinished = false;
        folder.Enabled = browse.Enabled = false;
        progress.Value = 0;
        detailsVisible = false;
        ShowView("progress");
        UpdateProgress(0, "Verificando a pasta de instalação...", false);
        try
        {
            destination = Path.GetFullPath(Environment.ExpandEnvironmentVariables(folder.Text.Trim()));
            if (destination.StartsWith(@"\\") || Path.GetPathRoot(destination).TrimEnd('\\') == destination.TrimEnd('\\'))
                throw new InvalidOperationException("Escolha uma pasta local exclusiva do Job Tracker, não a raiz de uma unidade ou pasta de rede.");
            foreach (var special in new[] { Environment.SpecialFolder.Windows, Environment.SpecialFolder.System, Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments })
            {
                string protectedPath = Environment.GetFolderPath(special);
                if (destination.TrimEnd('\\').Equals(protectedPath.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Crie uma subpasta exclusiva para o Job Tracker.");
            }
            string runningState = Path.Combine(destination, "dist", "windows", "runtime", "processes.json");
            if (File.Exists(runningState))
            {
                var entries = new JavaScriptSerializer().Deserialize<List<OwnedProcess>>(File.ReadAllText(runningState));
                foreach (var entry in entries)
                {
                    try
                    {
                        using (var process = Process.GetProcessById(entry.id))
                            if (process.StartTime.ToUniversalTime().ToString("o") == entry.started)
                                throw new InvalidOperationException("Pare os serviços pelo painel antes de atualizar a instalação.");
                    }
                    catch (ArgumentException) { /* Processo já encerrado. */ }
                }
            }
            string panelExe = Path.Combine(destination, "dist", "windows", "JobTracker.exe");
            if (File.Exists(panelExe))
            {
                try { using (var file = File.Open(panelExe, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } }
                catch (IOException) { throw new InvalidOperationException("Feche o painel Job Tracker antes de atualizar."); }
            }
            if (Directory.Exists(destination) && !File.Exists(Path.Combine(destination, "installation.json")) && ContainsFilesOrLinks(destination))
                throw new InvalidOperationException("A pasta de destino contém arquivos de outra origem. Preserve-os e escolha uma instalação limpa.");
            Append("Verificando integridade e preparando arquivos...");
            await Task.Run((Action)delegate { Payload.Extract(destination, delegate(int percent, string message) {
                Post(delegate { UpdateProgress(percent * 2 / 7, message, false); });
            }); });
            var directory = new DirectoryInfo(destination);
            var acl = new DirectorySecurity();
            acl.SetAccessRuleProtection(true, false);
            acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            directory.SetAccessControl(acl);
            var info = InitializationInfo(destination);
            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { HandleOutput(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
                await Task.Run(delegate { while (!process.WaitForExit(200)) { } });
                if (process.ExitCode != 0) throw new InvalidOperationException("Preparação incompleta. Corrija a mensagem acima e execute a instalação novamente. Seus dados locais serão preservados.");
            }
            Append("Instalação concluída. Abra o painel, consulte o guia e configure seu perfil.");
            success = true;
        }
        catch (Exception error) { installationFinished = true; UpdateProgress(progress.Value, "Instalação interrompida. Confira o motivo nos registros.", false); Append("Não foi possível concluir: " + error.Message); ShowView("error", error.Message); }
        finally { working = false; install.Enabled = true; folder.Enabled = browse.Enabled = true; }
        if (success) await FinishInstallation();
    }

    private async Task FinishInstallation()
    {
        installationFinished = true;
        UpdateProgress(100, "Instalação concluída.", false);
        ShowView("complete");
        await Task.Delay(700);
        if (!IsDisposed) Close();
    }

    private sealed class InstallProgress { public int completed { get; set; } public string message { get; set; } public bool indeterminate { get; set; } }

    private sealed class OwnedProcess
    {
        public int id { get; set; }
        public string started { get; set; }
    }
}
