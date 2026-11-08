using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyVersion("0.3.6.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.3.6.0")]

internal static class UninstallProgram
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length == 2 && args[0] == "--snapshot") {
            using (var form = new UninstallForm(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JobTracker", "app"))) {
                form.Show(); Application.DoEvents();
                using (var image = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(image, new Rectangle(Point.Empty, form.Size)); image.Save(args[1]); }
            }
            return;
        }
        if (args.Length == 2 && args[0] == "--root") {
            using (var mutex = new Mutex(false, "Local\\JobTrackerInstaller")) {
                bool acquired;
                try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) { MessageBox.Show("Feche a outra janela de instalação ou desinstalação antes de continuar.", "Job Tracker"); return; }
                try { Application.Run(new UninstallForm(Path.GetFullPath(args[1]))); } finally { mutex.ReleaseMutex(); }
            }
            return;
        }
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        if (!File.Exists(Path.Combine(root, "installation.json")) || !File.Exists(Path.Combine(root, "windows", "uninstall.ps1")))
        { MessageBox.Show("Execute este desinstalador dentro de uma instalação do Job Tracker.", "Job Tracker"); return; }
        try
        {
            // Executar fora da instalação permite remover também o executável original.
            string temporary = Path.Combine(Path.GetTempPath(), "JobTracker-Uninstall-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            string exe = Path.Combine(temporary, "Uninstall.exe");
            File.Copy(Application.ExecutablePath, exe);
            Process.Start(new ProcessStartInfo(exe, "--root \"" + root + "\"") { UseShellExecute = false });
        }
        catch (Exception error) { MessageBox.Show("Não foi possível abrir o desinstalador: " + error.Message, "Job Tracker"); }
    }
}

internal sealed class UninstallForm : Form
{
    private readonly string root;
    private readonly CheckBox erase = new CheckBox();
    private readonly Button remove = new Button();
    private readonly TextBox log = new TextBox();
    private bool busy;

    public UninstallForm(string installRoot)
    {
        root = installRoot;
        Text = "Desinstalar Job Tracker";
        Font = new Font("Segoe UI", 10);
        ClientSize = new Size(680, 430);
        MinimumSize = Size;
        StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 5 };
        foreach (int height in new[] { 48, 74, 64, 54 }) layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        layout.Controls.Add(new Label { Text = "Remover o Job Tracker", Font = new Font(Font.FontFamily, 21, FontStyle.Bold), Dock = DockStyle.Fill }, 0, 0);
        layout.Controls.Add(new Label { Text = "Feche o painel e recarregue ou remova a extensão no Chrome após desinstalar.\r\nPasta: " + root + "\r\nNode.js e Visual C++ compartilhados continuarão instalados.", Dock = DockStyle.Fill, AutoEllipsis = true }, 0, 1);
        erase.Text = "Excluir também meus dados, currículo, anexos e chave de API.\r\nSe desmarcado, os dados ficam disponíveis para uma reinstalação.";
        erase.Dock = DockStyle.Fill;
        layout.Controls.Add(erase, 0, 2);
        remove.Text = "Desinstalar"; remove.Size = new Size(170, 40);
        layout.Controls.Add(remove, 0, 3);
        log.Multiline = true; log.ReadOnly = true; log.Dock = DockStyle.Fill; log.ScrollBars = ScrollBars.Vertical;
        log.AccessibleName = "Resultado da desinstalação";
        layout.Controls.Add(log, 0, 4);
        remove.Click += async delegate { await Remove(); };
        FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) { e.Cancel = true; MessageBox.Show("Aguarde a conclusão da desinstalação.", "Job Tracker"); } };
    }

    private async Task Remove()
    {
        if (erase.Checked && MessageBox.Show(this, "Excluir permanentemente os dados desta instalação? Essa ação não pode ser desfeita.", "Excluir dados do Job Tracker", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        busy = true; remove.Enabled = false; erase.Enabled = false;
        bool success = false;
        string completionFile = Path.Combine(Path.GetTempPath(), "JobTracker-Uninstall-" + Guid.NewGuid().ToString("N") + ".complete");
        try
        {
            string script = Path.Combine(root, "windows", "uninstall.ps1");
            var info = new ProcessStartInfo("powershell.exe", "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -InstallRoot \"" + root + "\" -CompletionFile \"" + completionFile + "\"" + (erase.Checked ? " -DeleteData" : "")) {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Path.GetTempPath()
            };
            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
                process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
                // Não aguardar indefinidamente pipes herdados por outros processos.
                await Task.Run(delegate { while (!process.WaitForExit(200)) { } });
                success = process.ExitCode == 0 && File.Exists(completionFile) && File.ReadAllText(completionFile) == "JOBTRACKER_UNINSTALL_COMPLETE";
                if (!success) Append("Desinstalação incompleta. Corrija a mensagem acima e tente novamente.");
            }
        }
        catch (Exception error) { Append("Não foi possível desinstalar: " + error.Message); }
        finally {
            try { if (File.Exists(completionFile)) File.Delete(completionFile); } catch (IOException) { }
            busy = false; remove.Enabled = !success; erase.Enabled = !success;
        }
        if (success) { Close(); }
    }

    private void Append(string text)
    {
        if (!String.IsNullOrWhiteSpace(text) && !IsDisposed && IsHandleCreated) BeginInvoke((Action)delegate { if (!IsDisposed) log.AppendText(text + Environment.NewLine); });
    }
}
