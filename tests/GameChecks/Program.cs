using System.Net;
using System.Text.Json;
using GenieBouchardTennis;

int checks = 0;
void Check(bool condition, string description)
{
    if (!condition) throw new InvalidOperationException(description);
    checks++;
    Console.WriteLine($"PASS: {description}");
}
void Reject(Action action, string description)
{
    try { action(); }
    catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
    { Check(true, description); return; }
    throw new InvalidOperationException(description);
}
void WinGame(TennisScore score, int player) { for (int i = 0; i < 4; i++) score.Award(player); }

var score = new TennisScore();
Check(score.PointLabel(0) == "0" && score.Server == 0, "Initial love score and Genie serves");
score.Award(0);
Check(score.PointLabel(0) == "15", "First point is 15");
score.Award(0);
Check(score.PointLabel(0) == "30", "Second point is 30");
score.Award(0);
for (int i = 0; i < 3; i++) score.Award(1);
Check(score.PointLabel(0) == "40" && score.PointLabel(1) == "40", "Deuce at 40-all");
score.Award(0);
Check(score.PointLabel(0) == "AD", "Advantage requires another point");
score.Award(1);
Check(score.PointLabel(0) == "40" && score.Games[0] == 0, "Advantage lost returns to deuce");
score.Award(0); score.Award(0);
Check(score.Games[0] == 1 && score.Points.Sum() == 0 && score.Server == 1, "Game resets points and changes server");
for (int i = 0; i < 5; i++) WinGame(score, 0);
Check(score.Winner == 0 && score.Games[0] == 6, "A six-love set ends");
Check(!score.Award(1) && score.Points.Sum() == 0, "No points after set end");
Reject(() => score.Award(2), "Invalid scorer rejected");

var tie = new TennisScore();
for (int i = 0; i < 6; i++) { WinGame(tie, 0); WinGame(tie, 1); }
Check(tie.TieBreak && tie.Server == 0, "Six-all starts a tie-break");
tie.Award(0);
Check(tie.Server == 1, "Tie-break changes server after first point");
tie.Award(1);
Check(tie.Server == 1, "Tie-break opponent serves twice");
tie.Award(0);
Check(tie.Server == 0, "Tie-break changes server every two points");
for (int i = 0; i < 5; i++) tie.Award(1);
for (int i = 0; i < 4; i++) tie.Award(0);
Check(tie.PointLabel(0) == "6" && tie.PointLabel(1) == "6", "Tie-break uses numeric points");
tie.Award(0);
Check(tie.Winner < 0, "Tie-break still requires two-point margin");
tie.Award(0);
Check(tie.Winner == 0 && tie.Games[0] == 7, "Tie-break ends the set at seven-six");

foreach (var opponent in PlayerProfile.Opponents)
    Check(PlayerProfile.Eugenie.Speed > opponent.Speed &&
          PlayerProfile.Eugenie.Reach > opponent.Reach &&
          PlayerProfile.Eugenie.ShotSpeed > opponent.ShotSpeed, $"Genie is stronger than {opponent.Name}");
var game = new Game(random: new Random(1870));
game.Update(0.05f, 0, 0, false);
Check(game.ActiveSeconds == 0 && game.WaitingForServe, "Idle waiting earns no active time");
game.Paused = true;
game.Update(0.05f, 1, 1, true);
Check(game.WaitingForServe && game.ActiveSeconds == 0, "Pause freezes gameplay and reward time");
game.Paused = false;
game.Update(0.05f, 0, 0, true);
Check(!game.WaitingForServe, "Space starts a serve");
for (int i = 0; i < 500; i++) game.Update(0.016f, 0, 0, false);
Check(game.CompletedPoints >= 1 && game.WaitingForServe, "Unreturned rally awards a point and resets");
Check(RewardGame.From(game, "unfinished") is null, "Incomplete sets cannot request rewards");
var opponentServe = new Game();
WinGame(opponentServe.Score, 0);
for (int i = 0; i < 500; i++) opponentServe.Update(0.016f, 0, 0, false);
Check(opponentServe.CompletedPoints > 0, "Opponent can serve and complete a rally");

// Exercise an entire set with deterministic movement and timed swings, not injected scores.
game = new Game(random: new Random(1870));
for (int frame = 0; frame < 100000 && game.Score.Winner < 0; frame++)
{
    float dx = Math.Clamp((game.BallX - game.PlayerX) / 10, -1, 1);
    float dy = Math.Clamp((game.BallY - game.PlayerY) / 10, -1, 1);
    float distance = MathF.Sqrt(MathF.Pow(game.BallX - game.PlayerX, 2) + MathF.Pow(game.BallY - game.PlayerY, 2));
    bool swing = game.WaitingForServe ? frame % 2 == 0 : distance < 26 && frame % 2 == 0;
    game.Update(0.016f, dx, dy, swing);
}
Check(game.Score.Winner >= 0 && game.Returns > 0, "Simulated set completes with actual returns");
var proof = RewardGame.From(game, "tennis-check");
Check(proof is not null && proof.Mode == "tennis" && proof.GameId == "tennis-check",
    "Active completed set produces shared-issuer tennis proof");
var loss = new Game();
for (int i = 0; i < 6; i++) WinGame(loss.Score, 1);
Check(RewardGame.From(loss, "idle-loss") is null, "AFK/injected completion does not qualify");
loss = new Game(random: new Random(1870));
for (int frame = 0; frame < 100000 && loss.Score.Winner < 0; frame++)
{
    bool returning = loss.Returns == 0;
    float dx = returning ? Math.Clamp((loss.BallX - loss.PlayerX) / 10, -1, 1) : 0;
    float dy = returning ? Math.Clamp((loss.BallY - loss.PlayerY) / 10, -1, 1) : 0;
    float distance = MathF.Sqrt(MathF.Pow(loss.BallX - loss.PlayerX, 2) + MathF.Pow(loss.BallY - loss.PlayerY, 2));
    loss.Update(0.016f, dx, dy, frame % 2 == 0 && (loss.WaitingForServe || returning && distance < 26));
}
Check(loss.Score.Winner == 1 && RewardGame.From(loss, "played-loss") is { PlayerWon: false },
    $"Active losing set qualifies too; winner={loss.Score.Winner}, returns={loss.Returns}, active={loss.ActiveSeconds:F0}s");

var claim = new RewardClaim("10000000000000000000", "42", DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 600,
    "0x" + new string('1', 128) + "1b", RewardClient.VaultAddress, 1);
RewardClient.Validate(claim);
Check(RewardClient.Encode(claim).Length == 2 + 8 + 64 * 8, "Shared vault calldata has correctly padded ABI arguments");
Check(RewardClient.Encode(claim with { Signature = claim.Signature[..^2] + "00" }) ==
      RewardClient.Encode(claim), "Signature recovery byte zero normalizes to 27");
Reject(() => RewardClient.Validate(claim with { VaultAddress = RewardClient.TokenAddress }), "Different treasury rejected");
Reject(() => RewardClient.Validate(claim with { ChainId = 137 }), "Wrong network rejected");
Reject(() => RewardClient.Validate(claim with { Amount = "99999999999999999999999999" }), "Unexpected reward amount rejected");
Reject(() => RewardClient.Validate(claim with { Nonce = "-1" }), "Negative nonce rejected");
Reject(() => RewardClient.Validate(claim with { Nonce = new string('9', 78) }), "uint256 overflow rejected");
Reject(() => RewardClient.Validate(claim with { Deadline = 1 }), "Expired claim rejected");
Reject(() => RewardClient.Validate(claim with { Signature = "0x1234" }), "Malformed signature rejected");
Reject(() => RewardClient.Validate(claim with { Signature = claim.Signature[..^2] + "ff" }), "Invalid recovery byte rejected");
Reject(() => new RewardClient("http://issuer.example/api/reward-claim"), "Plain HTTP issuer rejected");
Check(!RewardClient.IsAddress("0x" + new string('0', 40)) &&
      !RewardClient.IsAddress("0x" + new string('z', 40)), "Zero and non-hex wallets rejected");
Check(!RewardClient.IsAddress(RewardClient.TokenAddress + "\n"), "Wallet address trailing newline rejected");
Reject(() => RewardClient.Validate(claim with { Signature = claim.Signature + "\n" }),
    "Signature trailing newline rejected");

var handler = new IssuerStub(claim);
using var client = new RewardClient("https://issuer.example/api/reward-claim", handler);
var issued = await client.RequestAsync(RewardClient.TokenAddress, proof!, CancellationToken.None);
Check(issued == claim, "Issuer response validated");
using var requestBody = JsonDocument.Parse(handler.Body!);
Check(requestBody.RootElement.GetProperty("game").GetProperty("mode").GetString() == "tennis" &&
      requestBody.RootElement.GetProperty("recipient").GetString() == RewardClient.TokenAddress,
    "Request matches Crypto Hockey recipient/game schema");
handler.Status = HttpStatusCode.ServiceUnavailable;
bool unavailable = false;
try { await client.RequestAsync(RewardClient.TokenAddress, proof!, CancellationToken.None); }
catch (HttpRequestException) { unavailable = true; }
Check(unavailable, "Unavailable issuer never produces a successful reward");

if (args.Contains("--bridge"))
{
    await using var bridge = await RewardBridge.StartAsync("https://issuer.example/api/reward-claim", proof!, AppContext.BaseDirectory);
    using var browser = new HttpClient();
    Check((await browser.GetStringAsync(bridge.Url)).Contains("Claim your play reward"), "Loopback wallet page served");
    Check((await browser.GetStringAsync(bridge.Url + "wallet.js")).Contains("eth_sendTransaction"), "Wallet script served under CSP");
    using var denied = await browser.PostAsync(bridge.Url + "claim",
        new StringContent("{\"recipient\":\"" + RewardClient.TokenAddress + "\"}", System.Text.Encoding.UTF8, "application/json"));
    Check(denied.StatusCode == HttpStatusCode.Forbidden, "Cross-origin/missing-origin claim rejected");
    using var foreignHost = new HttpRequestMessage(HttpMethod.Get, bridge.Url);
    foreignHost.Headers.Host = "attacker.example";
    using var rejected = await browser.SendAsync(foreignHost);
    Check(rejected.StatusCode == HttpStatusCode.Forbidden, "Foreign Host/DNS rebinding rejected");
    Console.WriteLine($"BROWSER_URL={bridge.Url}");
    if (args.Contains("--wait")) await Task.Delay(TimeSpan.FromMinutes(10));
}
Console.WriteLine($"All {checks} checks passed.");

sealed class IssuerStub(RewardClaim claim) : HttpMessageHandler
{
    public string? Body { get; private set; }
    public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Body = await request.Content!.ReadAsStringAsync(cancellationToken);
        return new(Status) { Content = new StringContent(JsonSerializer.Serialize(claim)) };
    }
}
