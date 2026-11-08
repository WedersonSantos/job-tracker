using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class DesktopTests
{
    private static T Field<T>(object target, string name) { return (T)target.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).GetValue(target); }
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "hold-pipe") { System.Threading.Thread.Sleep(12000); return; }
        Application.EnableVisualStyles();
        string mode = args[0], root = args[1];
        int browserLaunches = 0;
        string browserAddress = null;
        var form = new TrackerPanel(root, false, delegate(string address) { browserLaunches++; browserAddress = address; }) { Opacity = 0.01, ShowInTaskbar = false };
        bool passed = false, clicked = false;
        var timer = new System.Windows.Forms.Timer { Interval = 100 };
        DateTime deadline = DateTime.UtcNow.AddSeconds(30);
        form.FormClosed += delegate {
            if (mode == "cancel" && clicked)
                passed = browserLaunches == 0 && !Field<bool>(form, "starting") && !Field<bool>(form, "stopping") && File.Exists(Path.Combine(root, "native-stopped"));
            if (mode == "stop")
                passed = browserLaunches == 1 && File.Exists(Path.Combine(root, "services-stopped")) && !Field<bool>(form, "starting") && !Field<bool>(form, "stopping");
        };
        timer.Tick += delegate {
            if (DateTime.UtcNow > deadline) { timer.Stop(); form.Close(); return; }
            if (mode != "cancel") return;
            if (!clicked && Field<bool>(form, "starting") && File.Exists(Path.Combine(root, "native-starting"))) {
                string serviceStatus = Field<Label>(form, "status").Text;
                if (serviceStatus.Contains("indisponível") || (!serviceStatus.Contains("Iniciando") && !serviceStatus.Contains("ativa"))) { timer.Stop(); form.Close(); return; }
                if (!Field<Button>(form, "stop").Enabled) { timer.Stop(); form.Close(); return; }
                clicked = true; Field<Button>(form, "stop").PerformClick();
            }
            if (clicked && !Field<bool>(form, "busy") && !Field<bool>(form, "stopping") && File.Exists(Path.Combine(root, "native-stopped"))) {
                passed = !Field<bool>(form, "starting") && Field<Button>(form, "start").Enabled && browserLaunches == 0;
                timer.Stop(); form.Close();
            }
        };
        form.Shown += async delegate {
            timer.Start();
            if (Field<SplitContainer>(form, "content").Panel2Collapsed) { passed = false; form.Close(); return; }
            if (mode == "cancel") { Field<Button>(form, "start").PerformClick(); return; }
            if (mode == "stop") {
                var method = typeof(TrackerPanel).GetMethod("StartApplication", BindingFlags.NonPublic | BindingFlags.Instance);
                await (Task)method.Invoke(form, null);
                Field<Button>(form, "stop").PerformClick();
                return;
            }
            if (mode == "preview") {
                foreach (bool narrow in new[] { false, true }) {
                    form.ClientSize = narrow ? new Size(824, 581) : new Size(1060, 720);
                    typeof(TrackerPanel).GetField("starting", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(form, true);
                    typeof(TrackerPanel).GetMethod("UpdateControls", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(form, null);
                    typeof(TrackerPanel).GetMethod("SetWelcome", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(form, new object[] { "Iniciando o Job Tracker...\r\nVocê pode usar Parar serviços durante esta etapa." });
                    Field<TextBox>(form, "log").Text = "Preparando banco local...\r\nTodas as migrações foram aplicadas.\r\nIniciando API local...\r\nIniciando interface local...";
                    form.PerformLayout(); Application.DoEvents();
                    using (var image = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(image, new Rectangle(Point.Empty, form.Size)); image.Save(Path.Combine(root, narrow ? "panel-narrow.png" : "panel-wide.png")); }
                }
                typeof(TrackerPanel).GetField("starting", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(form, false);
                passed = true; timer.Stop(); form.Close(); return;
            }
            if (mode == "browser") {
                try {
                    var start = typeof(TrackerPanel).GetMethod("StartApplication", BindingFlags.NonPublic | BindingFlags.Instance);
                    var elapsed = System.Diagnostics.Stopwatch.StartNew();
                    await (Task)start.Invoke(form, null);
                    if (elapsed.Elapsed.TotalSeconds >= 10) return;
                    if (browserLaunches != 1 || browserAddress != "http://127.0.0.1:3000/") return;
                    if (Field<WebView2>(form, "web").CoreWebView2 != null) return;
                    File.WriteAllText(Path.Combine(root, "fail-start"), "fail");
                    await (Task)start.Invoke(form, null);
                    passed = browserLaunches == 1;
                } finally { timer.Stop(); form.Close(); }
                return;
            }
            try {
                var navigate = typeof(TrackerPanel).GetMethod("NavigateInside", BindingFlags.NonPublic | BindingFlags.Instance);
                await (Task)navigate.Invoke(form, new object[] { new Uri(Path.Combine(root, "windows", "guide.html")) });
                var view = Field<WebView2>(form, "web");
                if (view.CoreWebView2 == null) return;
                DateTime loadDeadline = DateTime.UtcNow.AddSeconds(10);
                while (DateTime.UtcNow < loadDeadline) {
                    string title = await view.CoreWebView2.ExecuteScriptAsync("document.title");
                    if (title.Contains("Job Tracker")) {
                        var internalAddress = typeof(TrackerPanel).GetMethod("InternalAddress", BindingFlags.NonPublic | BindingFlags.Instance);
                        bool local = (bool)internalAddress.Invoke(form, new object[] { new Uri("http://127.0.0.1:3000/curriculo") });
                        bool external = (bool)internalAddress.Invoke(form, new object[] { new Uri("https://example.com/") });
                        passed = local && !external && view.Visible && new Uri(view.CoreWebView2.Source).IsFile;
                        using (var stream = File.Create(Path.Combine(root, "desktop-preview.png"))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                        break;
                    }
                    await Task.Delay(100);
                }
            } finally { timer.Stop(); form.Close(); }
        };
        Application.Run(form);
        File.WriteAllText(Path.Combine(root, "desktop-test-result.txt"), passed ? "PASS" : Field<TextBox>(form, "log").Text);
        Environment.ExitCode = passed ? 0 : 1;
    }
}
