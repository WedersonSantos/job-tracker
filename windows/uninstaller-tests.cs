using System;
using System.IO;
using System.Windows.Forms;

internal static class UninstallerTests
{
    private static Button Find(Control parent) { foreach (Control control in parent.Controls) { var button = control as Button; if (button != null && button.Text == "Desinstalar") return button; var child = Find(control); if (child != null) return child; } return null; }
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        var form = new UninstallForm(args[0]) { Opacity = 0.01, ShowInTaskbar = false };
        bool timedOut = false;
        bool unconfirmed = args.Length > 1 && args[1] == "unconfirmed", failureShown = false;
        DateTime deadline = DateTime.UtcNow.AddSeconds(15);
        var timer = new Timer { Interval = 100 };
        timer.Tick += delegate {
            if (unconfirmed && Find(form).Enabled && File.Exists(Path.Combine(args[0], "uninstall-stub-complete"))) {
                failureShown = true; timer.Stop(); form.Close(); return;
            }
            if (DateTime.UtcNow > deadline) { timedOut = true; timer.Stop(); form.Close(); }
        };
        form.Shown += delegate { timer.Start(); Find(form).PerformClick(); };
        Application.Run(form);
        timer.Stop();
        Environment.ExitCode = !timedOut && (!unconfirmed || failureShown) && File.Exists(Path.Combine(args[0], "uninstall-stub-complete")) ? 0 : 1;
    }
}
