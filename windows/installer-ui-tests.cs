using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class InstallerUiTests
{
    private static readonly BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
    private static T Field<T>(object form, string name) { return (T)typeof(SetupForm).GetField(name, Private).GetValue(form); }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static bool HasCheckbox(Control parent) { foreach (Control child in parent.Controls) if (child is CheckBox || HasCheckbox(child)) return true; return false; }
    private static void View(SetupForm form, string mode, string error = null) { typeof(SetupForm).GetMethod("ShowView", Private).Invoke(form, new object[] {mode, error}); }
    private static void Snapshot(SetupForm form, string path)
    {
        form.PerformLayout(); Application.DoEvents();
        using (var image = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(image, new Rectangle(Point.Empty, form.Size)); image.Save(path); }
    }
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        try {
            using (var form = new SetupForm() { Opacity = 0.01, ShowInTaskbar = false }) {
                form.Show(); Application.DoEvents();
                Check(!HasCheckbox(form), "Checkbox de requisitos ainda presente.");
                Check(Field<TextBox>(form, "folder").Visible && Field<Button>(form, "install").Visible, "Controles iniciais ausentes.");
                Check(!Field<ProgressBar>(form, "progress").Visible && !Field<TextBox>(form, "log").Visible, "Detalhes ocupam a janela inicial.");
                Check(form.ClientSize.Height <= 180, "Janela inicial não ficou compacta.");
                Field<TextBox>(form, "folder").Text = @"C:\Aplicativos\JobTracker";
                Snapshot(form, Path.Combine(args[0], "installer-ready.png"));
                View(form, "progress");
                Check(!Field<TextBox>(form, "folder").Visible && !Field<Button>(form, "install").Visible, "Controles não foram ocultados ao baixar.");
                Check(form.ClientSize.Height <= 140 && !Field<TextBox>(form, "log").Visible, "Andamento não ficou compacto.");
                var command = (ProcessStartInfo)typeof(SetupForm).GetMethod("InitializationInfo", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] {args[0]});
                Check(command.Arguments.EndsWith(" -InstallPrerequisites"), "Instalação automática não foi habilitada.");
                var output = typeof(SetupForm).GetMethod("HandleOutput", Private);
                output.Invoke(form, new object[] {"JOBTRACKER_PROGRESS:{\"completed\":3,\"message\":\"Baixando e instalando as dependências...\",\"indeterminate\":true}"});
                Application.DoEvents();
                Check(Field<ProgressBar>(form, "progress").Value == 42 && Field<ProgressBar>(form, "progress").Style == ProgressBarStyle.Marquee, "Download sem percentual não usa atividade por etapa.");
                Snapshot(form, Path.Combine(args[0], "installer-downloading.png"));
                output.Invoke(form, new object[] {"npm warn deprecated pacote-de-teste"});
                output.Invoke(form, new object[] {"JOBTRACKER_PROGRESS:{\"completed\":7,\"message\":\"Conclusão inválida\"}"});
                Application.DoEvents();
                Check(Field<ProgressBar>(form, "progress").Value == 42, "Mensagem não confirmada levou a 100%.");
                Check(Field<TextBox>(form, "log").Text.Contains("npm warn deprecated"), "Avisos sumiram dos registros.");
                typeof(SetupForm).GetMethod("UpdateProgress", Private).Invoke(form, new object[] {42, "Instalação interrompida.", false});
                View(form, "error", "Não foi possível baixar as dependências. Confira a conexão e tente novamente.");
                Check(Field<ProgressBar>(form, "progress").Style == ProgressBarStyle.Blocks, "Atividade continua após falha.");
                Check(Field<Button>(form, "install").Visible && Field<Button>(form, "install").Text == "Tentar novamente", "Falha não permite nova tentativa.");
                Check(!Field<TextBox>(form, "log").Visible, "Registros expandiram automaticamente.");
                Snapshot(form, Path.Combine(args[0], "installer-error.png"));
                typeof(SetupForm).GetField("detailsVisible", Private).SetValue(form, true);
                View(form, "error");
                Check(Field<TextBox>(form, "log").Visible, "Detalhes não podem ser consultados.");
                typeof(SetupForm).GetField("detailsVisible", Private).SetValue(form, false);
                var finish = (System.Threading.Tasks.Task)typeof(SetupForm).GetMethod("FinishInstallation", Private).Invoke(form, null);
                DateTime deadline = DateTime.UtcNow.AddSeconds(5);
                while (!finish.IsCompleted && DateTime.UtcNow < deadline) { Application.DoEvents(); System.Threading.Thread.Sleep(10); }
                Check(finish.IsCompleted && form.IsDisposed, "O instalador não fechou após concluir.");
                form.Close();
            }
            File.WriteAllText(Path.Combine(args[0], "installer-ui-result.txt"), "PASS");
        } catch (Exception error) { File.WriteAllText(Path.Combine(args[0], "installer-ui-result.txt"), error.ToString()); Environment.ExitCode = 1; }
    }
}
