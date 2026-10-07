using System.Net;
using System.Net.Http.Json;
using System.Numerics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Nethereum.ABI.FunctionEncoding;
using Nethereum.ABI.Model;

namespace GenieBouchardTennis;

public sealed record RewardGame(string GameId, string Mode, int PlayerScore, int OpponentScore,
    string DifficultyLevel, DateTimeOffset CompletedAt, bool PlayerWon)
{
    public static RewardGame? From(Game game, string gameId) =>
        game.Score.Winner < 0 || game.ActiveSeconds < 30 || game.Returns < 1 ? null :
        new(gameId, "tennis", game.Score.Games[0], game.Score.Games[1],
            game.Opponent.Name, DateTimeOffset.UtcNow, game.Score.Winner == 0);
}

public sealed record RewardClaim(string Amount, string Nonce, long Deadline, string Signature,
    string VaultAddress, int ChainId);

public sealed class RewardClient : IDisposable
{
    // Public configuration shared with Crypto-Hockey/appsettings.json.
    public const string TokenAddress = "0x8eddD4edea39c5B5f77662453600F53A202EE47C";
    public const string VaultAddress = "0x1e4f6e4a382adbdb662733a19ae773d3ab8f497d";
    public const int ChainId = 1;
    public static readonly BigInteger RewardAmount = BigInteger.Parse("10000000000000000000");
    private static readonly Regex AddressPattern = new(@"\A0x[0-9a-fA-F]{40}\z", RegexOptions.CultureInvariant);
    private readonly Uri endpoint;
    private readonly HttpClient http;

    public RewardClient(string issuerUrl, HttpMessageHandler? handler = null)
    {
        if (!Uri.TryCreate(issuerUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0)
            throw new ArgumentException("Configure GENIE_REWARD_ISSUER_URL with the exact HTTPS claim endpoint.");
        endpoint = uri;
        http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(20)
        };
    }

    public static bool IsAddress(string? address) =>
        address is not null && AddressPattern.IsMatch(address) &&
        !address.Equals("0x0000000000000000000000000000000000000000", StringComparison.OrdinalIgnoreCase);

    public async Task<RewardClaim> RequestAsync(string recipient, RewardGame game, CancellationToken cancellationToken)
    {
        if (!IsAddress(recipient)) throw new ArgumentException("Invalid wallet address.");
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = JsonContent.Create(new { recipient, game })
        };
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await response.Content.LoadIntoBufferAsync(65536)
            .WaitAsync(TimeSpan.FromSeconds(20), cancellationToken);
        var claim = await response.Content.ReadFromJsonAsync<RewardClaim>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("The issuer returned no claim.");
        Validate(claim);
        return claim;
    }

    public static void Validate(RewardClaim claim)
    {
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (claim.ChainId != ChainId || !VaultAddress.Equals(claim.VaultAddress, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The issuer returned a different chain or treasury vault.");
        if (!TryUInt256(claim.Amount, out var amount) || amount != RewardAmount ||
            !TryUInt256(claim.Nonce, out _) || claim.Deadline <= now || claim.Deadline > now + 3600)
            throw new InvalidOperationException("Invalid amount, nonce, or claim expiry.");
        if (claim.Signature is null || !Regex.IsMatch(claim.Signature, @"\A0x[0-9a-fA-F]{130}\z"))
            throw new InvalidOperationException("Invalid reward signature.");
        byte recovery = Convert.ToByte(claim.Signature[^2..], 16);
        if (recovery is not (0 or 1 or 27 or 28))
            throw new InvalidOperationException("Invalid signature recovery byte.");
    }

    private static bool TryUInt256(string? value, out BigInteger result)
    {
        result = 0;
        return value is not null && value.Length is > 0 and <= 78 &&
               value.All(c => c is >= '0' and <= '9') &&
               BigInteger.TryParse(value, out result) && result >= 0 && result < (BigInteger.One << 256);
    }

    public static string Encode(RewardClaim claim)
    {
        Validate(claim);
        byte[] signature = Convert.FromHexString(claim.Signature[2..]);
        if (signature[64] < 27) signature[64] += 27;
        var parameters = new[]
        {
            new Parameter("uint256", 1), new Parameter("uint256", 2),
            new Parameter("uint256", 3), new Parameter("bytes", 4)
        };
        var abi = new FunctionABI("claim", false) { InputParameters = parameters };
        return new FunctionCallEncoder().EncodeRequest(abi.Sha3Signature, parameters,
            [BigInteger.Parse(claim.Amount), BigInteger.Parse(claim.Nonce), new BigInteger(claim.Deadline), signature]);
    }

    public void Dispose() => http.Dispose();
}

// The browser holds the wallet keys. This bridge only proxies one completed set to the configured issuer.
public sealed class RewardBridge : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly RewardClient client;
    private readonly SemaphoreSlim gate = new(1, 1);
    private string? recipient;
    private RewardClaim? cached;

    private RewardBridge(WebApplication app, RewardClient client) { this.app = app; this.client = client; }
    public string Url { get; private set; } = "";

    public static async Task<RewardBridge> StartAsync(string issuerUrl, RewardGame game, string assetDirectory)
    {
        string walletHtml = await File.ReadAllTextAsync(Path.Combine(assetDirectory, "wallet.html"));
        string walletScript = await File.ReadAllTextAsync(Path.Combine(assetDirectory, "wallet.js"));
        string walletStyle = await File.ReadAllTextAsync(Path.Combine(assetDirectory, "wallet.css"));
        var client = new RewardClient(issuerUrl);
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [] });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, 0);
            options.Limits.MaxRequestBodySize = 512;
        });
        var app = builder.Build();
        var bridge = new RewardBridge(app, client);
        string path = "/" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        string origin = "";
        app.Use(async (context, next) =>
        {
            if (context.Request.Host.Value != new Uri(origin).Authority)
            {
                context.Response.StatusCode = 403;
                return;
            }
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            context.Response.Headers["Content-Security-Policy"] =
                "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
            await next(context);
        });
        app.MapGet(path + "/", () => Results.Content(walletHtml, "text/html"));
        app.MapGet(path + "/wallet.js", () => Results.Content(walletScript, "text/javascript"));
        app.MapGet(path + "/wallet.css", () => Results.Content(walletStyle, "text/css"));
        app.MapPost(path + "/claim", async (HttpContext context) =>
        {
            if (context.Request.Headers.Origin != origin || !context.Request.HasJsonContentType())
                return Results.StatusCode(403);
            await bridge.gate.WaitAsync(context.RequestAborted);
            try
            {
                var body = await context.Request.ReadFromJsonAsync<WalletRequest>(context.RequestAborted);
                if (body is null || !RewardClient.IsAddress(body.Recipient))
                    return Results.BadRequest(new { error = "Invalid wallet address." });
                if (bridge.recipient is not null &&
                    !bridge.recipient.Equals(body.Recipient, StringComparison.OrdinalIgnoreCase))
                    return Results.BadRequest(new { error = "This set is already linked to another wallet." });
                // Bind before requesting: a timeout may occur after the issuer has already signed.
                bridge.recipient = body.Recipient;
                bridge.cached ??= await client.RequestAsync(body.Recipient, game, context.RequestAborted);
                string data = RewardClient.Encode(bridge.cached);
                return Results.Json(new
                {
                    claim = bridge.cached, recipient = bridge.recipient, data,
                    tokenAddress = RewardClient.TokenAddress
                });
            }
            catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or
                                        JsonException or ArgumentException or OperationCanceledException or TimeoutException)
            {
                return Results.BadRequest(new { error = "Claim unavailable. Check the configured issuer, its authorization, and expiry. No tokens were sent." });
            }
            finally { bridge.gate.Release(); }
        });
        try
        {
            await app.StartAsync();
            origin = app.Services.GetRequiredService<IServer>().Features
                .Get<IServerAddressesFeature>()!.Addresses.Single();
            bridge.Url = origin + path + "/";
            return bridge;
        }
        catch
        {
            await bridge.DisposeAsync();
            throw;
        }
    }

    private sealed record WalletRequest(string Recipient);

    public async ValueTask DisposeAsync()
    {
        await app.StopAsync();
        await app.DisposeAsync();
        client.Dispose();
        gate.Dispose();
    }
}
