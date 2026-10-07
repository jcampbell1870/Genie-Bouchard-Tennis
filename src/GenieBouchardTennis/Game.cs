namespace GenieBouchardTennis;

public sealed record PlayerProfile(string Name, float Speed, float Reach, float ShotSpeed)
{
    public static readonly PlayerProfile Eugenie = new("Eugenie Bouchard · CAN", 155, 27, 210);
    public static readonly PlayerProfile[] Opponents =
    [
        new("Rookie", 78, 18, 140),
        new("Club Champion", 105, 20, 165),
        new("Tour Challenger", 125, 22, 185)
    ];
}

public sealed class TennisScore
{
    public int[] Points { get; } = new int[2];
    public int[] Games { get; } = new int[2];
    public int Winner { get; private set; } = -1;
    public bool TieBreak => Games[0] == 6 && Games[1] == 6;
    public int Server => TieBreak
        ? ((12 % 2) + (Points.Sum() + 1) / 2) % 2
        : Games.Sum() % 2;

    public string PointLabel(int player)
    {
        if (TieBreak) return Points[player].ToString();
        if (Points[0] >= 3 && Points[1] >= 3)
            return Points[player] > Points[1 - player] ? "AD" : "40";
        return new[] { "0", "15", "30", "40" }[Math.Min(Points[player], 3)];
    }

    public bool Award(int player)
    {
        if (player is < 0 or > 1) throw new ArgumentOutOfRangeException(nameof(player));
        if (Winner >= 0) return false;
        Points[player]++;
        if (Points[player] < (TieBreak ? 7 : 4) || Points[player] - Points[1 - player] < 2)
            return false;
        bool tieBreak = TieBreak;
        Games[player]++;
        Array.Clear(Points);
        if (tieBreak || (Games[player] >= 6 && Games[player] - Games[1 - player] >= 2))
            Winner = player;
        return true;
    }
}

public sealed class Game
{
    public const float Left = 45, Right = 435, Top = 72, Bottom = 310, Net = 191;
    private readonly Random random;
    private float velocityX, velocityY, bounceY, aiDelay, aiServeDelay, swingCooldown;
    private bool servingFlight, bounced, swung;
    private int lastHitter;

    public Game(int difficulty = 0, Random? random = null)
    {
        Opponent = PlayerProfile.Opponents[Math.Clamp(difficulty, 0, 2)];
        this.random = random ?? new Random();
        PreparePoint();
    }

    public TennisScore Score { get; } = new();
    public PlayerProfile Opponent { get; }
    public float PlayerX { get; private set; }
    public float PlayerY { get; private set; }
    public float OpponentX { get; private set; }
    public float OpponentY { get; private set; }
    public float BallX { get; private set; }
    public float BallY { get; private set; }
    public bool WaitingForServe { get; private set; }
    public bool Paused { get; set; }
    public bool ServingRight => Score.Points.Sum() % 2 == 0;
    public int CompletedPoints { get; private set; }
    public int Returns { get; private set; }
    public double ActiveSeconds { get; private set; }
    public string Message { get; private set; } = "";
    public event Action<int>? PointCompleted;

    private void PreparePoint()
    {
        PlayerX = ServingRight ? 315 : 165;
        OpponentX = ServingRight ? 165 : 315;
        PlayerY = Bottom - 10;
        OpponentY = Top + 10;
        WaitingForServe = true;
        servingFlight = bounced = false;
        aiServeDelay = 1.2f;
        velocityX = velocityY = 0;
        BallX = Score.Server == 0 ? PlayerX : OpponentX;
        BallY = Score.Server == 0 ? PlayerY : OpponentY;
        Message = Score.Winner >= 0
            ? (Score.Winner == 0 ? "GENIE WINS!" : $"{Opponent.Name.ToUpperInvariant()} WINS")
            : (Score.Server == 0 ? "SPACE TO SERVE" : "OPPONENT SERVING");
    }

    public void Update(float seconds, float moveX, float moveY, bool swing)
    {
        if (Paused || Score.Winner >= 0 || seconds <= 0) return;
        seconds = Math.Min(seconds, 0.05f);
        // Idle time never counts as play time, including waiting to serve.
        if (moveX != 0 || moveY != 0 || swing || !WaitingForServe)
            ActiveSeconds += seconds;
        float length = MathF.Sqrt(moveX * moveX + moveY * moveY);
        if (length > 1) { moveX /= length; moveY /= length; }
        if (!WaitingForServe)
        {
            PlayerX = Math.Clamp(PlayerX + moveX * PlayerProfile.Eugenie.Speed * seconds, Left, Right);
            PlayerY = Math.Clamp(PlayerY + moveY * PlayerProfile.Eugenie.Speed * seconds, Net + 18, Bottom);
        }
        swingCooldown = Math.Max(0, swingCooldown - seconds);
        bool newSwing = swing && !swung && swingCooldown == 0;
        swung = swing;
        if (WaitingForServe)
        {
            aiServeDelay -= seconds;
            if ((Score.Server == 0 && newSwing) || (Score.Server == 1 && aiServeDelay <= 0))
                Serve();
            return;
        }

        aiDelay -= seconds;
        if (aiDelay <= 0)
        {
            float targetX = lastHitter == 0
                ? BallX + velocityX * Math.Max(0, (112 - BallY) / velocityY)
                : 240;
            OpponentX = MoveTowards(OpponentX, Math.Clamp(targetX, Left, Right), Opponent.Speed * seconds);
            OpponentY = MoveTowards(OpponentY, lastHitter == 0 ? 112 : Top + 10, Opponent.Speed * seconds);
        }
        BallX += velocityX * seconds;
        BallY += velocityY * seconds;

        if (!bounced && (velocityY > 0 ? BallY >= bounceY : BallY <= bounceY))
        {
            bounced = true;
            bool landingLeft = ServingRight == (lastHitter == 0);
            float minX = servingFlight && !landingLeft ? 240 : Left;
            float maxX = servingFlight && landingLeft ? 240 : Right;
            if (BallX < minX || BallX > maxX)
            {
                EndPoint(1 - lastHitter, "OUT");
                return;
            }
        }
        if (lastHitter == 1 && bounced && newSwing &&
            Distance(BallX, BallY, PlayerX, PlayerY) <= PlayerProfile.Eugenie.Reach)
        {
            Hit(0, moveX < 0 ? 100 : moveX > 0 ? 380 : 150 + (float)random.NextDouble() * 180);
            Returns++;
        }
        else if (lastHitter == 0 && bounced &&
                 Distance(BallX, BallY, OpponentX, OpponentY) <= Opponent.Reach)
            Hit(1, 80 + (float)random.NextDouble() * 320);

        if (BallY < Top - 24 || BallY > Bottom + 24 || BallX < Left - 50 || BallX > Right + 50)
            EndPoint(lastHitter, "POINT");
        if (newSwing) swingCooldown = 0.18f;
    }

    private void Serve()
    {
        WaitingForServe = false;
        servingFlight = true;
        bounced = false;
        lastHitter = Score.Server;
        bounceY = lastHitter == 0 ? Net - 43 : Net + 43;
        float targetX = ServingRight == (lastHitter == 0) ? 180 : 300;
        SetVelocity(targetX, lastHitter == 0 ? PlayerProfile.Eugenie.ShotSpeed : Opponent.ShotSpeed);
        aiDelay = 0.12f;
        Message = "RALLY · SPACE TO HIT";
    }

    private void Hit(int player, float targetX)
    {
        lastHitter = player;
        servingFlight = bounced = false;
        bounceY = player == 0 ? Top + 32 : Bottom - 32;
        SetVelocity(targetX, player == 0 ? PlayerProfile.Eugenie.ShotSpeed : Opponent.ShotSpeed);
        aiDelay = 0.16f;
    }

    private void SetVelocity(float targetX, float speed)
    {
        float dx = targetX - BallX, dy = bounceY - BallY;
        float distance = MathF.Sqrt(dx * dx + dy * dy);
        velocityX = dx / distance * speed;
        velocityY = dy / distance * speed;
    }

    private void EndPoint(int winner, string reason)
    {
        CompletedPoints++;
        Score.Award(winner);
        PreparePoint();
        if (Score.Winner < 0) Message = $"{reason}: {(winner == 0 ? "GENIE" : Opponent.Name.ToUpperInvariant())} · {Message}";
        PointCompleted?.Invoke(winner);
    }

    private static float Distance(float x1, float y1, float x2, float y2) =>
        MathF.Sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));

    private static float MoveTowards(float current, float target, float amount) =>
        current + Math.Clamp(target - current, -amount, amount);
}
