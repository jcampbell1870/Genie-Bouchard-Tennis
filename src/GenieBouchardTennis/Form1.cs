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
    private double animationTime;
    private double playerSwingAt = -1;
    private double opponentSwingAt = -1;
    private bool swingHeld;
    private float playerMotion;
    private float opponentMotion;
    private float lastBallStep;

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
            float playerX = game.PlayerX, playerY = game.PlayerY;
            float opponentX = game.OpponentX, opponentY = game.OpponentY;
            float ballY = game.BallY;
            bool waiting = game.WaitingForServe;
            bool active = !game.Paused && game.Score.Winner < 0;
            bool swing = keys.Contains(Keys.Space);
            if (active)
            {
                animationTime += Math.Min(elapsed, 0.05f);
                if (swing && !swingHeld) playerSwingAt = animationTime;
            }
            game.Update(elapsed, Axis(Keys.Left, Keys.A, Keys.Right, Keys.D),
                Axis(Keys.Up, Keys.W, Keys.Down, Keys.S), swing);
            if (active)
            {
                playerMotion = Math.Min(1, (Math.Abs(game.PlayerX - playerX) + Math.Abs(game.PlayerY - playerY)) / 2);
                opponentMotion = Math.Min(1, (Math.Abs(game.OpponentX - opponentX) + Math.Abs(game.OpponentY - opponentY)) / 2);
                float ballStep = game.BallY - ballY;
                if (!game.WaitingForServe &&
                    ((waiting && game.Score.Server == 1) ||
                     (lastBallStep < 0 && ballStep > 0 && Math.Abs(ballY - game.OpponentY) < 35)))
                    opponentSwingAt = animationTime;
                lastBallStep = ballStep;
            }
            swingHeld = swing;
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
        playerSwingAt = opponentSwingAt = -1;
        playerMotion = opponentMotion = lastBallStep = 0;
        swingHeld = false;
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
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using var font = new Font(FontFamily.GenericMonospace, 8, FontStyle.Bold, GraphicsUnit.Pixel);
        using var large = new Font(FontFamily.GenericMonospace, 13, FontStyle.Bold, GraphicsUnit.Pixel);
        g.Clear(BackColor);
        DrawStadium(g);
        using var court = new LinearGradientBrush(new Rectangle(45, 72, 390, 238),
            Color.FromArgb(48, 132, 139), Color.FromArgb(30, 102, 121), 90);
        g.FillRectangle(court, Game.Left, Game.Top, Game.Right - Game.Left, Game.Bottom - Game.Top);
        using var lane = new SolidBrush(Color.FromArgb(18, 231, 255, 240));
        g.FillRectangle(lane, 45, 72, 20, 238);
        g.FillRectangle(lane, 415, 72, 20, 238);
        using var stripe = new SolidBrush(Color.FromArgb(7, 255, 255, 255));
        for (int y = 72; y < 310; y += 34)
            g.FillRectangle(stripe, 65, y, 350, 17);
        using var lines = new Pen(Color.FromArgb(238, 245, 225), 1.5f);
        g.DrawRectangle(lines, Game.Left, Game.Top, Game.Right - Game.Left, Game.Bottom - Game.Top);
        g.DrawRectangle(lines, 65, Game.Top, 350, Game.Bottom - Game.Top);
        g.DrawRectangle(lines, 65, 132, 350, 118);
        g.DrawLine(lines, 240, 132, 240, 250);
        g.DrawLine(lines, 236, 76, 244, 76);
        g.DrawLine(lines, 236, 306, 244, 306);
        Sprite(g, game.OpponentX, game.OpponentY, false, opponentMotion, opponentSwingAt);
        DrawNet(g);
        Sprite(g, game.PlayerX, game.PlayerY, true, playerMotion, playerSwingAt);
        using var shadow = new SolidBrush(Color.FromArgb(70, 7, 31, 36));
        g.FillEllipse(shadow, game.BallX - 3, game.BallY + 4, 7, 3);
        g.FillEllipse(Brushes.DarkOliveGreen, game.BallX - 3, game.BallY - 3, 6, 6);
        g.FillEllipse(Brushes.GreenYellow, game.BallX - 2.5f, game.BallY - 2.5f, 5, 5);
        g.DrawArc(Pens.Ivory, game.BallX - 1.5f, game.BallY - 2, 3, 4, 70, 150);
        DrawScoreboard(g, font, large);
        using var status = new SolidBrush(Color.FromArgb(24, 49, 63));
        g.FillRectangle(status, 25, 325, 430, 13);
        g.DrawString(game.Paused ? "PAUSED · P TO RESUME" : game.Message, font, Brushes.LightGoldenrodYellow, 35, 327);
        g.DrawString("ARROWS/WASD MOVE · SPACE SERVE/HIT · LEFT/RIGHT AIM", font, Brushes.White, 35, 340);
        string reward = game.Score.Winner >= 0 && RewardGame.From(game, gameId) is null
            ? "REWARD: COMPLETE AN ACTIVE SET WITH AT LEAST ONE RETURN"
            : $"CAN · EUGENIE IS THE STRONGEST PLAYER · {rewards.Count} ELIGIBLE SET(S)";
        g.DrawString(reward, font, Brushes.LightGoldenrodYellow, 35, 351);
    }

    private static void DrawStadium(Graphics g)
    {
        using var terrace = new SolidBrush(Color.FromArgb(23, 43, 57));
        using var seat = new SolidBrush(Color.FromArgb(49, 78, 94));
        using var rail = new Pen(Color.FromArgb(90, 123, 137), 1);
        using var apron = new LinearGradientBrush(new Rectangle(25, 55, 430, 270),
            Color.FromArgb(47, 91, 79), Color.FromArgb(24, 65, 62), 90);
        g.FillRectangle(terrace, 0, 55, 480, 270);
        for (int row = 0; row < 24; row++)
        {
            int y = 60 + row * 11;
            for (int column = 0; column < 3; column++)
            {
                int x = 2 + column * 7;
                g.FillRectangle(seat, x, y, 5, 7);
                g.FillRectangle(seat, 473 - column * 7, y, 5, 7);
                if ((row + column) % 3 == 0)
                {
                    g.FillEllipse(Brushes.Tan, x + 1, y, 3, 3);
                    g.FillEllipse(Brushes.Tan, 474 - column * 7, y, 3, 3);
                }
            }
        }
        g.FillRectangle(apron, 25, 55, 430, 270);
        g.DrawLine(rail, 23, 55, 23, 325);
        g.DrawLine(rail, 457, 55, 457, 325);
        using var border = new Pen(Color.FromArgb(100, 158, 132), 1);
        g.DrawRectangle(border, 32, 62, 416, 255);
    }

    private void DrawScoreboard(Graphics g, Font font, Font title)
    {
        using var header = new LinearGradientBrush(new Rectangle(25, 0, 430, 54),
            Color.FromArgb(27, 57, 74), Color.FromArgb(13, 30, 45), 90);
        using var accent = new Pen(Color.FromArgb(216, 186, 104), 1);
        g.FillRectangle(header, 25, 0, 430, 54);
        g.DrawString("GENIE BOUCHARD TENNIS", title, Brushes.LightGoldenrodYellow, 143, 5);
        g.DrawLine(accent, 35, 21, 445, 21);
        for (int player = 0; player < 2; player++)
        {
            int x = player == 0 ? 35 : 247;
            g.FillRectangle(Brushes.DarkSlateGray, x, 26, 198, 24);
            g.FillRectangle(player == 0 ? Brushes.Turquoise : Brushes.Coral, x, 26, 3, 24);
            g.DrawString(player == 0 ? "GENIE · CAN" : game.Opponent.Name.ToUpperInvariant(),
                font, Brushes.White, x + 10, 28);
            g.DrawString($"SET {game.Score.Games[player]}   POINT {game.Score.PointLabel(player)}",
                font, Brushes.LightGoldenrodYellow, x + 10, 39);
            if (game.Score.Server == player)
                g.FillEllipse(Brushes.GreenYellow, x + 184, 30, 5, 5);
        }
    }

    private static void DrawNet(Graphics g)
    {
        using var shadow = new SolidBrush(Color.FromArgb(48, 5, 25, 31));
        using var mesh = new Pen(Color.FromArgb(155, 195, 214, 208), 0.55f);
        using var cable = new Pen(Color.FromArgb(248, 247, 226), 2.5f);
        g.FillRectangle(shadow, 30, Game.Net + 4, 420, 9);
        for (int x = 32; x <= 448; x += 5)
            g.DrawLine(mesh, x, Game.Net - 6, x, Game.Net + 6);
        for (int y = -6; y <= 6; y += 3)
            g.DrawLine(mesh, 30, Game.Net + y, 450, Game.Net + y);
        g.DrawLine(cable, 30, Game.Net - 7, 450, Game.Net - 7);
        g.FillRectangle(Brushes.SlateGray, 28, Game.Net - 10, 4, 19);
        g.FillRectangle(Brushes.SlateGray, 448, Game.Net - 10, 4, 19);
        g.FillRectangle(Brushes.Ivory, 28, Game.Net - 10, 4, 2);
        g.FillRectangle(Brushes.Ivory, 448, Game.Net - 10, 4, 2);
    }

    private void Sprite(Graphics g, float x, float y, bool genie, float motion, double swingAt)
    {
        float stride = MathF.Sin((float)animationTime * 15) * motion;
        float swingAge = (float)(animationTime - swingAt);
        float swing = swingAt >= 0 && swingAge is >= 0 and < 0.34f
            ? MathF.Sin(swingAge / 0.34f * MathF.PI) : 0;
        using var shadow = new SolidBrush(Color.FromArgb(75, 9, 31, 39));
        g.FillEllipse(shadow, x - 10, y + 5, 21, 5);
        var state = g.Save();
        g.TranslateTransform(MathF.Round(x), MathF.Round(y) - Math.Abs(stride) * 1.2f);
        using var outline = new Pen(Color.FromArgb(31, 44, 56), 4.5f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        using var skin = new Pen(genie ? Color.FromArgb(240, 192, 151) : Color.FromArgb(194, 139, 100), 3)
            { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        using var skinFill = new SolidBrush(skin.Color);
        using var hair = new SolidBrush(genie ? Color.FromArgb(181, 128, 54) : Color.FromArgb(66, 43, 34));
        using var kit = new SolidBrush(genie ? Color.FromArgb(248, 246, 231) : Color.FromArgb(235, 110, 88));
        using var kitShade = new SolidBrush(genie ? Color.FromArgb(180, 216, 210) : Color.FromArgb(178, 65, 59));
        using var sock = new Pen(Color.FromArgb(248, 246, 231), 3.5f);
        using var shoe = new Pen(Color.FromArgb(30, 49, 73), 4) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var sole = new Pen(Color.FromArgb(213, 227, 220), 1);
        for (int side = -1; side <= 1; side += 2)
        {
            float step = side * stride;
            float hip = side * 3;
            float knee = side * 4 + step * 2;
            float foot = side * 5 + step * 3;
            PointF[] leg = [new(hip, -6), new(knee, -1 - Math.Abs(step)), new(foot, 5 - Math.Abs(step) * 2)];
            g.DrawLines(outline, leg);
            g.DrawLines(skin, leg);
            g.DrawLine(sock, foot, 2 - Math.Abs(step) * 2, foot, 5 - Math.Abs(step) * 2);
            g.DrawLine(shoe, foot - 1, 7 - Math.Abs(step) * 2, foot + 2, 7 - Math.Abs(step) * 2);
            g.DrawLine(sole, foot - 2, 8 - Math.Abs(step) * 2, foot + 3, 8 - Math.Abs(step) * 2);
        }
        PointF[] leftArm = [new(-5, -18), new(-9 - stride, -12), new(-7 - stride, -8 - swing * 5)];
        PointF hand = new(10 - swing * 13, -10 - swing * 10);
        PointF[] rightArm = [new(5, -18), new(10, -15 - swing * 5), hand];
        g.DrawLines(outline, leftArm);
        g.DrawLines(outline, rightArm);
        g.DrawLines(skin, leftArm);
        g.DrawLines(skin, rightArm);
        PointF[] torso = [new(-4, -20), new(4, -20), new(6, -16), new(4, -8), new(-4, -8), new(-6, -16)];
        g.FillPolygon(kit, torso);
        g.FillPolygon(kitShade, new PointF[] { new(3, -19), new(6, -16), new(4, -8), new(1, -8) });
        g.FillPolygon(genie ? kit : kitShade, new PointF[] { new(-4, -9), new(4, -9), new(7, -5), new(-7, -5) });
        g.DrawLine(Pens.DarkSlateGray, -4, -8, 4, -8);
        g.FillRectangle(skinFill, -1.5f, -23, 3, 4);
        g.FillEllipse(hair, -4.5f, -32, 9, 10);
        g.FillEllipse(skinFill, -3.5f, -29, 7, 8);
        if (genie)
        {
            g.FillEllipse(hair, -4, -32, 8, 9);
            g.FillEllipse(hair, -3 - stride, -25, 4, 9);
            g.DrawLine(Pens.Turquoise, -3, -24, 0, -24);
            g.DrawLine(Pens.DarkSlateGray, -2, -16, 2, -16);
        }
        else
        {
            g.FillPie(hair, -4.5f, -32, 9, 9, 180, 180);
            g.FillRectangle(Brushes.Ivory, -4, -29, 8, 1.5f);
            g.FillRectangle(Brushes.DarkSlateGray, -2, -26, 1, 1);
            g.FillRectangle(Brushes.DarkSlateGray, 1, -26, 1, 1);
            g.DrawLine(Pens.Sienna, -1, -23, 1, -23);
        }
        var racketState = g.Save();
        g.TranslateTransform(hand.X, hand.Y);
        g.RotateTransform(genie ? 35 - swing * 145 : 140 + swing * 145);
        using var grip = new Pen(Color.FromArgb(42, 51, 68), 2.5f);
        using var frame = new Pen(genie ? Color.FromArgb(100, 227, 212) : Color.FromArgb(253, 212, 124), 1.5f);
        using var strings = new Pen(Color.FromArgb(195, 233, 240, 236), 0.5f);
        g.DrawLine(grip, 0, 1, 0, -5);
        g.DrawLine(Pens.Silver, 0, -5, -3, -9);
        g.DrawLine(Pens.Silver, 0, -5, 3, -9);
        using var oval = new GraphicsPath();
        oval.AddEllipse(-5, -22, 10, 14);
        var stringState = g.Save();
        g.SetClip(oval, CombineMode.Intersect);
        for (int i = -22; i <= -8; i += 3) g.DrawLine(strings, -5, i, 5, i);
        for (int i = -4; i <= 4; i += 2) g.DrawLine(strings, i, -22, i, -8);
        g.Restore(stringState);
        g.DrawEllipse(frame, -5, -22, 10, 14);
        g.Restore(racketState);
        g.FillEllipse(skinFill, hand.X - 1.5f, hand.Y - 1.5f, 3, 3);
        g.Restore(state);
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
