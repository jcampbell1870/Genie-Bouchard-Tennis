using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace GenieBouchardTennis;

public sealed class Form1 : Form
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 16 };
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly HashSet<Keys> keys = [];
    private readonly ComboBox difficulty = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
    private readonly Button rewardButton = new() { Text = "Claim A1870", AutoSize = true, Enabled = false };
    private readonly Button pauseButton = new() { Text = "Pause (P)", AutoSize = true };
    private readonly ComboBox rewardSets = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 90 };
    private readonly Panel canvas = new() { Dock = DockStyle.Fill };
    private readonly List<(RewardGame Game, RewardBridge? Bridge)> rewards = [];
    private Game game = new();
    private string gameId = Guid.NewGuid().ToString("N");
    private double lastTick;
    private bool openingWallet;
    private bool closing;

    public Form1()
    {
        Text = "Genie Bouchard Tennis";
        ClientSize = new Size(960, 760);
        MinimumSize = new Size(640, 560);
        BackColor = Color.FromArgb(12, 29, 45);
        KeyPreview = true;
        var controls = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(8) };
        difficulty.Items.AddRange(PlayerProfile.Opponents.Select(p => (object)p.Name).ToArray());
        difficulty.SelectedIndex = 0;
        var restart = new Button { Text = "New set (N)", AutoSize = true };
        restart.Click += (_, _) => NewGame();
        pauseButton.Click += (_, _) => TogglePause();
        rewardButton.Click += async (_, _) => await OpenWalletAsync();
        controls.Controls.AddRange([difficulty, restart, pauseButton, rewardSets, rewardButton]);
        Controls.Add(canvas);
        Controls.Add(controls);
        canvas.Paint += Draw;
        canvas.Resize += (_, _) => canvas.Invalidate();
        typeof(Panel).GetProperty("DoubleBuffered", System.Reflection.BindingFlags.NonPublic |
            System.Reflection.BindingFlags.Instance)!.SetValue(canvas, true);
        KeyDown += OnKeyDown;
        KeyUp += (_, e) => keys.Remove(e.KeyCode);
        Deactivate += (_, _) => { keys.Clear(); game.Paused = true; pauseButton.Text = "Resume (P)"; };
        game.PointCompleted += OnPointCompleted;
        timer.Tick += (_, _) =>
        {
            double now = clock.Elapsed.TotalSeconds;
            float elapsed = (float)(now - lastTick);
            lastTick = now;
            game.Update(elapsed, Axis(Keys.Left, Keys.A, Keys.Right, Keys.D),
                Axis(Keys.Up, Keys.W, Keys.Down, Keys.S), keys.Contains(Keys.Space));
            canvas.Invalidate();
        };
        timer.Start();
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        Keys key = keyData & Keys.KeyCode;
        if (key is Keys.Up or Keys.Down or Keys.Left or Keys.Right or Keys.Space)
        {
            keys.Add(key);
            return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    private float Axis(Keys negative, Keys alternateNegative, Keys positive, Keys alternatePositive) =>
        (keys.Contains(positive) || keys.Contains(alternatePositive) ? 1 : 0) -
        (keys.Contains(negative) || keys.Contains(alternateNegative) ? 1 : 0);

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        bool first = keys.Add(e.KeyCode);
        if (first && e.KeyCode == Keys.P) TogglePause();
        if (first && e.KeyCode == Keys.N) NewGame();
        if (e.KeyCode is Keys.Space or Keys.Up or Keys.Down or Keys.Left or Keys.Right or
            Keys.W or Keys.A or Keys.S or Keys.D or Keys.P or Keys.N)
        {
            e.Handled = true;
            e.SuppressKeyPress = true;
        }
    }

    private void TogglePause()
    {
        game.Paused = !game.Paused;
        pauseButton.Text = game.Paused ? "Resume (P)" : "Pause (P)";
        canvas.Invalidate();
    }

    private void NewGame()
    {
        keys.Clear();
        game = new Game(difficulty.SelectedIndex);
        gameId = Guid.NewGuid().ToString("N");
        game.PointCompleted += OnPointCompleted;
        pauseButton.Text = "Pause (P)";
        canvas.Focus();
    }

    private void OnPointCompleted(int winner)
    {
        if (game.Score.Winner < 0) return;
        var reward = RewardGame.From(game, gameId);
        if (reward is not null)
        {
            rewards.Add((reward, null));
            rewardSets.Items.Add($"Set {rewards.Count}");
            rewardSets.SelectedIndex = rewards.Count - 1;
        }
        rewardButton.Enabled = rewards.Count > 0;
    }

    private async Task OpenWalletAsync()
    {
        if (openingWallet || rewards.Count == 0) return;
        string? issuer = Environment.GetEnvironmentVariable("GENIE_REWARD_ISSUER_URL");
        if (string.IsNullOrWhiteSpace(issuer))
        {
            MessageBox.Show(this, "Offline play is available. Rewards require GENIE_REWARD_ISSUER_URL to point to an authorized HTTPS issuer using Crypto Hockey's shared treasury vault. No tokens have been paid.",
                "Reward issuer not configured");
            return;
        }
        openingWallet = true;
        game.Paused = true;
        pauseButton.Text = "Resume (P)";
        try
        {
            // Preserve every completed set in this game session, even after starting another set.
            var selected = rewards[Math.Max(0, rewardSets.SelectedIndex)];
            if (selected.Bridge is null)
            {
                var bridge = await RewardBridge.StartAsync(issuer, selected.Game, AppContext.BaseDirectory);
                if (closing) { await bridge.DisposeAsync(); return; }
                int index = rewards.FindIndex(r => r.Game.GameId == selected.Game.GameId);
                rewards[index] = (selected.Game, bridge);
                selected = rewards[index];
            }
            Process.Start(new ProcessStartInfo(selected.Bridge!.Url) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            MessageBox.Show(this, ex.Message, "Unable to open reward wallet");
        }
        finally { openingWallet = false; }
    }

    private void Draw(object? sender, PaintEventArgs e)
    {
        var g = e.Graphics;
        float scale = Math.Min(canvas.Width / 480f, canvas.Height / 360f);
        g.TranslateTransform((canvas.Width - 480 * scale) / 2, (canvas.Height - 360 * scale) / 2);
        g.ScaleTransform(scale, scale);
        g.SmoothingMode = SmoothingMode.None;
        g.TextRenderingHint = TextRenderingHint.SingleBitPerPixelGridFit;
        using var font = new Font(FontFamily.GenericMonospace, 8, FontStyle.Bold, GraphicsUnit.Pixel);
        using var large = new Font(FontFamily.GenericMonospace, 13, FontStyle.Bold, GraphicsUnit.Pixel);
        g.Clear(BackColor);
        g.DrawString("GENIE BOUCHARD TENNIS", large, Brushes.LightGoldenrodYellow, 144, 8);
        g.DrawString($"GENIE  {game.Score.Games[0]}  {game.Score.PointLabel(0)}", font, Brushes.White, 45, 32);
        g.DrawString($"{game.Opponent.Name.ToUpperInvariant()}  {game.Score.Games[1]}  {game.Score.PointLabel(1)}",
            font, Brushes.White, 260, 32);
        g.FillRectangle(Brushes.DarkSeaGreen, 25, 55, 430, 272);
        g.FillRectangle(Brushes.SeaGreen, Game.Left, Game.Top, Game.Right - Game.Left, Game.Bottom - Game.Top);
        using var lines = new Pen(Color.Ivory, 2);
        g.DrawRectangle(lines, Game.Left, Game.Top, Game.Right - Game.Left, Game.Bottom - Game.Top);
        g.DrawRectangle(lines, 65, Game.Top, 350, Game.Bottom - Game.Top);
        g.DrawRectangle(lines, 65, 132, 350, 118);
        g.DrawLine(lines, 240, 132, 240, 250);
        g.FillRectangle(Brushes.Ivory, 30, Game.Net - 2, 420, 4);
        for (int x = 30; x < 450; x += 8)
            g.FillRectangle(Brushes.DarkSlateGray, x, Game.Net + 2, 2, 7);
        Sprite(g, game.OpponentX, game.OpponentY, false);
        Sprite(g, game.PlayerX, game.PlayerY, true);
        g.FillRectangle(Brushes.DarkOliveGreen, game.BallX - 2, game.BallY + 4, 6, 2);
        g.FillRectangle(Brushes.Yellow, game.BallX - 2, game.BallY - 2, 5, 5);
        g.DrawString(game.Paused ? "PAUSED · P TO RESUME" : game.Message, font, Brushes.Yellow, 45, 48);
        g.DrawString("ARROWS/WASD MOVE · SPACE SERVE/HIT · LEFT/RIGHT AIM", font, Brushes.White, 45, 335);
        string reward = game.Score.Winner >= 0 && RewardGame.From(game, gameId) is null
            ? "REWARD: COMPLETE AN ACTIVE SET WITH AT LEAST ONE RETURN"
            : $"CAN · EUGENIE IS THE STRONGEST PLAYER · {rewards.Count} ELIGIBLE SET(S)";
        g.DrawString(reward, font, Brushes.LightGoldenrodYellow, 45, 348);
    }

    private static void Sprite(Graphics g, float x, float y, bool genie)
    {
        x = MathF.Round(x); y = MathF.Round(y);
        var hair = genie ? Brushes.Goldenrod : Brushes.SaddleBrown;
        g.FillRectangle(Brushes.DarkSlateGray, x - 8, y + 4, 16, 4);
        g.FillRectangle(hair, x - 4, y - 21, 9, 7);
        if (genie) g.FillRectangle(hair, x - 8, y - 18, 4, 10);
        g.FillRectangle(Brushes.Bisque, x - 3, y - 17, 7, 7);
        g.FillRectangle(genie ? Brushes.White : Brushes.Coral, x - 6, y - 10, 12, 12);
        g.FillRectangle(Brushes.Bisque, x + 6, y - 8, 8, 3);
        g.FillRectangle(Brushes.White, x - 6, y + 2, 4, 6);
        g.FillRectangle(Brushes.White, x + 3, y + 2, 4, 6);
        g.FillRectangle(Brushes.DarkBlue, x - 6, y + 7, 5, 3);
        g.FillRectangle(Brushes.DarkBlue, x + 3, y + 7, 5, 3);
        g.DrawRectangle(Pens.White, x + 14, y - 16, 9, 12);
        g.DrawLine(Pens.Silver, x + 15, y - 3, x + 11, y);
    }

    protected override async void OnFormClosed(FormClosedEventArgs e)
    {
        closing = true;
        timer.Stop();
        timer.Dispose();
        foreach (var reward in rewards)
            if (reward.Bridge is not null) await reward.Bridge.DisposeAsync();
        base.OnFormClosed(e);
    }
}
