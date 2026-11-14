using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyVersion("0.3.6.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.3.6.0")]

internal static class Program
{
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr first, IntPtr second);
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        if (!File.Exists(Path.Combine(root, "windows", "services.ps1")))
        {
            MessageBox.Show("Mantenha JobTracker.exe em dist\\windows dentro da pasta do projeto.", "Job Tracker");
            return;
        }
        using (var mutex = new Mutex(false, "Local\\JobTracker-" + root.GetHashCode().ToString("X")))
        {
            if (!mutex.WaitOne(0)) {
                foreach (var process in Process.GetProcessesByName("JobTracker")) {
                    try {
                        if (process.Id != Process.GetCurrentProcess().Id && process.MainModule.FileName.Equals(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) && process.MainWindowHandle != IntPtr.Zero) {
                            ShowWindow(process.MainWindowHandle, 9); SetForegroundWindow(process.MainWindowHandle);
                            if (args.Length == 1 && args[0] == "--guide") PostMessage(process.MainWindowHandle, 0x8001, IntPtr.Zero, IntPtr.Zero);
                            return;
                        }
                    } catch (System.ComponentModel.Win32Exception) { }
                }
                return;
            }
            try
            {
                bool guideMode = args.Length == 1 && args[0] == "--guide";
                var panel = new TrackerPanel(root, !(args.Length == 2 && args[0] == "--snapshot") && !guideMode);
                if (guideMode) panel.Shown += async delegate { await panel.ShowGuide(); };
                if (args.Length == 2 && args[0] == "--snapshot")
                {
                    panel.Show();
                    Application.DoEvents();
                    using (var image = new Bitmap(panel.Width, panel.Height))
                    { panel.DrawToBitmap(image, new Rectangle(Point.Empty, panel.Size)); image.Save(args[1]); }
                    panel.Close();
                    return;
                }
                Application.Run(panel);
            }
            finally { mutex.ReleaseMutex(); }
        }
    }
}

internal sealed class TrackerPanel : Form
{
    private readonly string root;
    private readonly Action<string> launchBrowser;
    private readonly TextBox log = new TextBox();
    private readonly Label status = new Label();
    private readonly Button start = new Button();
    private readonly Button stop = new Button();
    private readonly Button generate = new Button();
    private readonly Button open = new Button();
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private bool busy;
    private bool checking;
    private bool starting;
    private bool stopping;
    private bool stopRequested;
    private Task<bool> startupRun;
    private bool closing;
    private bool allowClose;
    private bool managedSession;
    private bool startupPending;
    private bool apiReady;
    private bool interfaceReady;
    private bool servicesStopped;
    private bool shutdownRequested;
    private int serviceOperation;
    private readonly WebView2 web = new WebView2();
    private readonly Label welcome = new Label();
    private readonly SplitContainer content = new SplitContainer();
    private Task browserInitialization;

    public TrackerPanel(string projectRoot, bool autoStart = true, Action<string> browserLauncher = null)
    {
        root = projectRoot;
        launchBrowser = browserLauncher ?? delegate(string address) { Process.Start(new ProcessStartInfo(address) { UseShellExecute = true }); };
        managedSession = autoStart;
        startupPending = autoStart;
        Text = "Job Tracker 0.3.6";
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Font = new Font("Segoe UI", 10);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(1060, 720);
        MinimumSize = new Size(840, 620);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(246, 248, 251);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 4 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 78));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 62));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(layout);
        var header = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, ColumnCount = 1, Margin = Padding.Empty };
        header.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        header.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        header.Controls.Add(new Label { Text = "Job Tracker", Font = new Font(Font.FontFamily, 23, FontStyle.Bold), ForeColor = Color.FromArgb(20, 30, 48), Dock = DockStyle.Fill, Margin = Padding.Empty }, 0, 0);
        header.Controls.Add(new Label { Text = "Controle os serviços e acompanhe a inicialização do aplicativo.", ForeColor = Color.FromArgb(77, 90, 110), Dock = DockStyle.Fill, Margin = new Padding(0, 4, 0, 0) }, 0, 1);
        layout.Controls.Add(header, 0, 0);
        status.Text = autoStart ? "Iniciando API...    |    Iniciando interface..." : "Verificando serviços locais...";
        status.Dock = DockStyle.Fill;
        status.Font = new Font(Font, FontStyle.Bold);
        status.ForeColor = Color.FromArgb(30, 64, 140);
        status.TextAlign = ContentAlignment.MiddleLeft;
        status.Margin = Padding.Empty;
        status.AccessibleName = "Estado dos serviços";
        layout.Controls.Add(status, 0, 2);

        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Margin = Padding.Empty };
        ConfigureButton(start, "Iniciar", 110);
        ConfigureButton(open, "Abrir navegador", 155);
        ConfigureButton(stop, "Parar serviços", 160);
        var options = new Button(); ConfigureButton(options, "Opções", 110);
        var logs = new Button(); ConfigureButton(logs, "Ocultar registros", 145);
        open.EnabledChanged += delegate { StylePrimaryButton(open); };
        StylePrimaryButton(open);
        actions.Controls.AddRange(new Control[] { open, start, stop, options, logs });
        layout.Controls.Add(actions, 0, 1);
        content.Dock = DockStyle.Fill; content.Orientation = Orientation.Horizontal;
        content.Size = new Size(800, 450);
        content.Margin = Padding.Empty;
        content.Panel1MinSize = 105; content.Panel2MinSize = 120; content.Panel2Collapsed = false;
        content.SplitterWidth = 8;
        welcome.Dock = DockStyle.Fill; welcome.TextAlign = ContentAlignment.MiddleLeft;
        welcome.Padding = new Padding(0, 8, 0, 12);
        welcome.ForeColor = Color.FromArgb(48, 62, 82);
        welcome.Font = new Font(Font.FontFamily, 11);
        welcome.Text = "O Job Tracker será aberto no navegador padrão quando estiver pronto.\r\nMantenha este painel aberto para controlar os serviços.";
        web.Dock = DockStyle.Fill; web.Visible = false;
        content.Panel1.Controls.Add(welcome); content.Panel1.Controls.Add(web);
        layout.Controls.Add(content, 0, 3);
        log.Multiline = true;
        log.ReadOnly = true;
        log.ScrollBars = ScrollBars.Vertical;
        log.Dock = DockStyle.Fill;
        log.BackColor = Color.White;
        log.ForeColor = Color.FromArgb(35, 47, 64);
        log.Font = new Font("Consolas", 10);
        log.BorderStyle = BorderStyle.None;
        log.AccessibleName = "Registros da operação";
        log.Text = "Pronto para iniciar. A instalação Windows inclui PostgreSQL privado. O painel inicia e encerra o banco junto dos serviços.\r\n";
        var records = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = Padding.Empty };
        records.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        records.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        records.Controls.Add(new Label { Text = "Registros da operação", Font = new Font(Font, FontStyle.Bold), ForeColor = Color.FromArgb(35, 47, 64), Dock = DockStyle.Fill, Margin = Padding.Empty }, 0, 0);
        var logSurface = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Padding = new Padding(12), Margin = Padding.Empty, BorderStyle = BorderStyle.FixedSingle };
        logSurface.Controls.Add(log); records.Controls.Add(logSurface, 0, 1);
        content.Panel2.Controls.Add(records);
        logs.Click += delegate { content.Panel2Collapsed = !content.Panel2Collapsed; if (!content.Panel2Collapsed) SetContentSplit(); logs.Text = content.Panel2Collapsed ? "Ver registros" : "Ocultar registros"; };
        var menu = new ContextMenuStrip();
        menu.Items.Add("Configurar API de IA", null, delegate { ConfigureApi(); });
        menu.Items.Add("Gerar extensão Chrome", null, async delegate { if (await RunScript("scripts\\build-extension.ps1", "")) ShowFolder("dist\\chrome"); });
        menu.Items.Add("Abrir pasta da extensão", null, delegate { ShowFolder("dist\\chrome"); });
        menu.Items.Add("Abrir aplicativo nesta janela", null, async delegate { await NavigateInside(new Uri("http://127.0.0.1:3000")); });
        menu.Items.Add("Guia de uso", null, async delegate { await NavigateInside(new Uri(Path.Combine(root, "windows", "guide.html"))); });
        menu.Items.Add("Abrir registros dos serviços", null, delegate { ShowFolder("dist\\windows\\runtime"); });
        options.Click += delegate { menu.Show(options, new Point(0, options.Height)); };
        start.Click += async delegate { await StartApplication(); };
        stop.Click += async delegate { await StopApplication(); };
        open.Click += delegate { OpenExternal("http://127.0.0.1:3000"); };
        FormClosing += async delegate(object sender, FormClosingEventArgs e) {
            if (!managedSession || allowClose) return;
            e.Cancel = true;
            if (closing || stopping) return;
            if (busy && !starting) { MessageBox.Show("Aguarde a operação atual terminar antes de fechar.", "Job Tracker"); return; }
            closing = true;
            try { if (await StopApplication()) { allowClose = true; if (!IsDisposed) Close(); } }
            finally { closing = false; }
        };
        FormClosed += delegate { timer.Stop(); };
        timer.Interval = 10000;
        timer.Tick += async delegate { await RefreshStatus(); };
        UpdateControls();
        Shown += async delegate { SetContentSplit(); timer.Start(); if (autoStart) await StartApplication(); else await RefreshStatus(); };
    }

    private static void ConfigureButton(Button button, string text, int width)
    {
        button.Text = text;
        button.AccessibleName = text;
        button.Size = new Size(width, 40);
        button.Margin = new Padding(0, 4, 10, 4);
        button.UseVisualStyleBackColor = true;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderColor = Color.FromArgb(193, 203, 218);
        button.BackColor = Color.White;
        button.ForeColor = Color.FromArgb(30, 43, 62);
    }

    private static void StylePrimaryButton(Button button)
    {
        button.BackColor = button.Enabled ? Color.FromArgb(30, 64, 175) : Color.FromArgb(226, 232, 240);
        button.ForeColor = button.Enabled ? Color.White : Color.FromArgb(80, 95, 115);
        button.FlatAppearance.BorderColor = button.BackColor;
    }

    private void SetContentSplit()
    {
        if (content.Height >= content.Panel1MinSize + content.Panel2MinSize + content.SplitterWidth)
            content.SplitterDistance = Math.Max(content.Panel1MinSize, Math.Min(content.Height - content.Panel2MinSize - content.SplitterWidth, web.Visible ? content.Height * 2 / 3 : 115));
    }

    private void RenderServiceStatus()
    {
        status.Text = ServiceStatus("API", apiReady) + "    |    " + ServiceStatus("interface", interfaceReady);
        status.ForeColor = apiReady && interfaceReady && !stopping ? Color.FromArgb(20, 100, 70) : Color.FromArgb(30, 64, 140);
        open.Enabled = apiReady && interfaceReady && !starting && !stopping && !busy;
    }

    private string ServiceStatus(string name, bool ready)
    {
        if (stopping) return "Parando " + name + "...";
        if (ready) return name + ": ativa";
        if (starting || startupPending) return "Iniciando " + name + "...";
        return name + (servicesStopped ? ": parada" : ": indisponível");
    }

    public Task ShowGuide() { return NavigateInside(new Uri(Path.Combine(root, "windows", "guide.html"))); }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == 0x8001) { BeginInvoke((Action)(async delegate { await ShowGuide(); })); return; }
        base.WndProc(ref message);
    }

    private void ConfigureApi()
    {
        using (var dialog = new Form { Text = "API de IA — Anthropic", ClientSize = new Size(560, 230), StartPosition = FormStartPosition.CenterParent, Font = Font, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false })
        {
            var description = new Label { Text = "Use sua própria chave da Anthropic. As chamadas podem gerar cobranças.\r\nA chave fica protegida para seu usuário Windows. Não será exibida novamente.", Location = new Point(20, 18), Size = new Size(520, 60) };
            var label = new Label { Text = "Chave de API", Location = new Point(20, 82), AutoSize = true };
            var input = new TextBox { UseSystemPasswordChar = true, Location = new Point(20, 106), Width = 520, AccessibleName = "Chave de API Anthropic" };
            var save = new Button { Text = "Salvar chave", Location = new Point(20, 160), Size = new Size(140, 40) };
            var remove = new Button { Text = "Remover chave", Location = new Point(174, 160), Size = new Size(140, 40) };
            dialog.Controls.AddRange(new Control[] { description, label, input, save, remove });
            string file = Path.Combine(root, "dist", "windows", "runtime", "anthropic.key");
            save.Click += delegate {
                string key = input.Text.Trim();
                if (!key.StartsWith("sk-ant-") || key.Length < 24 || key.IndexOfAny(new[] { '\r', '\n', ' ' }) >= 0)
                { MessageBox.Show(dialog, "Informe uma chave Anthropic válida, sem espaços.", "Verifique a chave"); return; }
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    byte[] plain = System.Text.Encoding.UTF8.GetBytes(key);
                    try { File.WriteAllBytes(file, ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser)); }
                    finally { Array.Clear(plain, 0, plain.Length); input.Clear(); }
                    Append("Chave de API salva. Pare os serviços e inicie novamente para aplicar. A validade será conferida na primeira geração solicitada.");
                    dialog.Close();
                }
                catch { MessageBox.Show(dialog, "Não foi possível proteger e salvar a chave. Confira as permissões da pasta.", "Job Tracker"); }
            };
            remove.Click += delegate {
                try { if (File.Exists(file)) File.Delete(file); input.Clear(); Append("Chave protegida removida. Reinicie os serviços. Configurações manuais em .env, se existirem, continuam valendo."); dialog.Close(); }
                catch { MessageBox.Show(dialog, "Não foi possível remover a chave.", "Job Tracker"); }
            };
            dialog.ShowDialog(this);
        }
    }

    private void Append(string text)
    {
        if (IsDisposed || !IsHandleCreated || String.IsNullOrWhiteSpace(text)) return;
        BeginInvoke((Action)delegate { if (!IsDisposed) log.AppendText(text + Environment.NewLine); });
    }

    private void UpdateControls()
    {
        start.Enabled = generate.Enabled = !busy && !stopping;
        stop.Enabled = !stopping && (!busy || starting);
        stop.Text = stopping ? "Parando..." : "Parar serviços";
        RenderServiceStatus();
    }

    private async Task StartApplication()
    {
        if (busy || stopping || shutdownRequested || IsDisposed) return;
        int operation = ++serviceOperation;
        managedSession = true;
        stopRequested = false;
        servicesStopped = false;
        startupPending = true;
        SetWelcome("Iniciando o Job Tracker...\r\nVocê pode usar Parar serviços durante esta etapa.");
        startupRun = RunScript("windows\\services.ps1", "-Action start", true);
        bool ready = await startupRun;
        startupPending = false;
        RenderServiceStatus();
        if (ready && !stopRequested && !shutdownRequested && operation == serviceOperation && !IsDisposed)
        {
            SetWelcome("Job Tracker pronto.\r\nAbrindo no navegador padrão...\r\nMantenha este painel aberto enquanto usar o aplicativo.");
            OpenExternal("http://127.0.0.1:3000");
        }
        else if (!stopRequested) SetWelcome("Não foi possível iniciar o Job Tracker.\r\nConfira o motivo nos registros e use Iniciar para tentar novamente.");
    }

    private async Task<bool> StopApplication()
    {
        if (stopping || (busy && !starting)) return false;
        bool stopped = false;
        shutdownRequested = true; serviceOperation++;
        stopping = true; stopRequested = true; UpdateControls();
        SetWelcome("Parando com segurança...\r\nA etapa em andamento será concluída antes do encerramento.");
        try
        {
            if (starting)
            {
                while (starting)
                {
                    int code = await ExecuteScript("windows\\services.ps1", "-Action cancel");
                    if (code != 3) break;
                    await Task.Delay(200);
                }
                if (startupRun != null) await startupRun;
            }
            stopped = await RunScript("windows\\services.ps1", "-Action stop");
            if (stopped) { servicesStopped = true; startupPending = false; apiReady = interfaceReady = false; SetWelcome("Serviços encerrados.\r\nUse Iniciar para abrir o Job Tracker novamente."); }
            else SetWelcome("Não foi possível concluir a parada.\r\nConfira o motivo em Ver registros antes de tentar novamente.");
        }
        finally { stopping = false; if (!stopped) shutdownRequested = false; UpdateControls(); }
        if (stopped) { allowClose = true; Close(); }
        return stopped;
    }

    private async Task<bool> RunScript(string relativePath, string arguments, bool isStartup = false)
    {
        if (busy) return false;
        busy = true;
        if (isStartup) starting = true;
        UpdateControls();
        bool success = false;
        try
        {
            int code = await ExecuteScript(relativePath, arguments);
            success = code == 0;
            if (code != 0 && code != 2) Append("A operação não foi concluída. Confira os registros para corrigir e tentar novamente.");
        }
        finally { busy = false; if (isStartup) starting = false; UpdateControls(); }
        await RefreshStatus();
        return success;
    }

    private async Task<int> ExecuteScript(string relativePath, string arguments)
    {
        try
        {
            var info = new ProcessStartInfo("powershell.exe", "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + Path.Combine(root, relativePath) + "\" " + arguments);
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = info.RedirectStandardError = true;
            info.StandardOutputEncoding = info.StandardErrorEncoding = System.Text.Encoding.UTF8;
            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Append(e.Data); };
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                // Filhos podem manter os pipes abertos mesmo após a saída do inicializador.
                await Task.Run(delegate { while (!process.WaitForExit(200)) { } });
                return process.ExitCode;
            }
        }
        catch (Exception error) { Append("Não foi possível executar a operação: " + error.Message); }
        return -1;
    }

    private async Task RefreshStatus()
    {
        if (checking || IsDisposed) return;
        checking = true;
        try
        {
            using (var client = new HttpClient(new HttpClientHandler { UseProxy = false }))
            {
                client.Timeout = TimeSpan.FromSeconds(3);
                bool api = await IsReady(client, "http://127.0.0.1:3333/profiles", "[");
                bool web = await IsReady(client, "http://127.0.0.1:3000/api/health", "\"app\":\"job-tracker\"");
                if (!IsDisposed)
                {
                    apiReady = api; interfaceReady = web;
                    RenderServiceStatus();
                }
            }
        }
        finally { checking = false; }
    }

    private static async Task<bool> IsReady(HttpClient client, string url, string marker)
    {
        try
        {
            using (var response = await client.GetAsync(url))
            {
                if (!response.IsSuccessStatusCode) return false;
                string body = (await response.Content.ReadAsStringAsync()).TrimStart();
                return marker == "[" ? body.StartsWith("[") : body.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0;
            }
        }
        catch { return false; }
    }

    private void SetWelcome(string text)
    {
        if (web.CoreWebView2 != null) web.CoreWebView2.Stop();
        web.Visible = false; welcome.Visible = true; welcome.Text = text;
        SetContentSplit();
    }

    private bool InternalAddress(Uri uri)
    {
        if (uri.AbsoluteUri == "about:blank") return true;
        if (uri.Scheme == "http" && uri.UserInfo.Length == 0 && uri.Port == 3000 && (uri.Host == "127.0.0.1" || uri.Host == "localhost")) return true;
        return uri.IsFile && Path.GetFullPath(uri.LocalPath).Equals(Path.Combine(root, "windows", "guide.html"), StringComparison.OrdinalIgnoreCase);
    }

    private void OpenExternal(string address)
    {
        if (shutdownRequested || IsDisposed) return;
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http") || uri.UserInfo.Length != 0) return;
        try { launchBrowser(uri.AbsoluteUri); }
        catch (Exception error) {
            Append("Não foi possível abrir o navegador padrão: " + error.Message);
            SetWelcome("Não foi possível abrir o navegador padrão.\r\nAbra http://127.0.0.1:3000 no seu navegador ou tente Abrir navegador novamente.");
        }
    }

    private async Task NavigateInside(Uri address)
    {
        try
        {
            if (!InternalAddress(address)) return;
            if (web.CoreWebView2 == null)
            {
                if (browserInitialization == null) browserInitialization = InitializeBrowser();
                await browserInitialization;
            }
            welcome.Visible = false; web.Visible = true;
            SetContentSplit();
            web.CoreWebView2.Navigate(address.AbsoluteUri);
        }
        catch (Exception error)
        {
            browserInitialization = null;
            Append("Não foi possível abrir a janela integrada: " + error.Message);
            SetWelcome("Não foi possível carregar a interface integrada.\r\nConfira o Microsoft Edge WebView2 Runtime e os registros da operação.");
        }
    }

    private async Task InitializeBrowser()
    {
                string data = Path.Combine(root, "data", "desktop-webview");
                var environment = await CoreWebView2Environment.CreateAsync(null, data);
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Settings.AreDevToolsEnabled = false;
                web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                    Uri uri;
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || !InternalAddress(uri)) { e.Cancel = true; OpenExternal(e.Uri); }
                };
                web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
                    e.Handled = true;
                    Uri uri;
                    if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) && InternalAddress(uri)) web.CoreWebView2.Navigate(uri.AbsoluteUri);
                    else OpenExternal(e.Uri);
                };
    }

    private void ShowFolder(string relativePath)
    {
        string path = Path.Combine(root, relativePath);
        if (!Directory.Exists(path)) { Append("Pasta ainda não disponível: " + path); return; }
        try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true }); }
        catch (Exception error) { Append("Não foi possível abrir a pasta: " + error.Message); }
    }
}
