# Genie-Bouchard-Tennis

An original 2D arcade tennis game for Windows and browsers, with animated human tennis players, tennis kits, strung rackets, stadium seating, and a classic console-inspired court. Play solo as **Eugenie “Genie” Bouchard of Canada**, the strongest character in this game's fictional offline balancing, or compete online with equal player stats.

No Nintendo code, sprites, music, logos, or other game assets are used. This is an unofficial fan project, not an endorsement by Eugenie Bouchard or Nintendo. Obtain any necessary name/likeness permissions before commercial distribution.

## Downloads and Chromebook

The project website is [Genie Bouchard Tennis](https://jcampbell1870.github.io/Genie-Bouchard-Tennis/). GitHub Actions builds the self-contained Windows x64 ZIP and the offline Chromebook/browser ZIP, then publishes both with the site. The Chromebook build is a browser edition: extract its ZIP and open `index.html` in Chrome, or install the website as a Chrome app after opening it online. The browser edition supports keyboard and touch play, selectable hard/grass/clay court visuals, and full-screen play, but does not include the desktop wallet/reward integration. Court surfaces are cosmetic and do not alter physics.

The Pages workflow runs on pushes to `main` and can also be started manually. GitHub Pages must be enabled with GitHub Actions as the deployment source for the site to go live.

## Online clubhouse

The browser has an original dark-and-gold, poker-lobby-inspired clubhouse: room filters, live seat counts, player rosters, and a quarterfinal/semifinal/final bracket. No GGPoker branding, assets, gambling, entry fees, or cash prizes are included.

- **1 vs 1:** create a heads-up room; the second player joining starts the match.
- **8-player tournaments:** create a knockout event; exactly eight entrants start four simultaneous quarterfinals. Winners advance automatically to two semifinals and one final.
- Every match is one ordinary tennis set with deuce/advantage and a 6–6 tie-break. Online players have identical speed, reach, and power.
- Enter a player name, connect to the same server as your friends, and join or create a room. You control the highlighted player, either at the bottom or top; movement follows screen directions for both seats. Release Space between swings.
- Online matches cannot pause or restart. Leaving a live match forfeits it. Closing the page or losing the connection eventually forfeits the match after the server heartbeat timeout. Keep the tournament page open while waiting for subsequent rounds.

### Run the multiplayer server

Online play is real server-authoritative multiplayer, not a simulated lobby. **GitHub Pages cannot run the server**: a separate Node.js host is required. Offline practice continues to work without it.

Install Node.js 22 or newer and run from the repository root:

```sh
node server/server.cjs
```

Open `http://localhost:8080` in two browsers (or eight for a tournament). The server serves the browser game and its API together, so the connection URL is prefilled. Sessions are temporary, held only in browser memory; names are display names, not verified accounts. Do not enter personal information. Reloading creates a new session rather than resuming a previous match.

For public play, deploy the server behind an HTTPS reverse proxy and configure its allowed browser origins to include your site. Players on the GitHub Pages site enter that deployed **HTTPS server URL** in the lobby. Opening the downloaded game directly from `file://` is intended for offline practice; use the hosted site for multiplayer.

Set `ALLOWED_ORIGINS` to a comma-separated list of exact browser origins, without paths or trailing slashes. Include the server's public origin if you also serve the game there. For example:

```sh
ALLOWED_ORIGINS=https://jcampbell1870.github.io,https://tennis.example.com node server/server.cjs
```

The defaults allow `http://localhost:8080` and `http://localhost:8000` for local development. `PORT` defaults to `8080`; `HOST` defaults to `0.0.0.0` (all network interfaces). For local-only use, set `HOST=127.0.0.1`. Disconnected entrants forfeit after 30 seconds without room polling; inactive players forfeit after two minutes without movement or swings.

The server owns physics, scoring, tournament advancement, and forfeits; clients send movement and swing inputs only. Rooms and sessions are in memory and disappear on restart. This is a single-process, free-play service, not a production ranked/reward backend. Use TLS, proxy-level rate limits, and operator monitoring before exposing it publicly. It does not authorize or issue A1870 rewards.

## Play on Windows

Install the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0), then run these commands from the repository root in PowerShell:

```powershell
dotnet run --project src/GenieBouchardTennis/GenieBouchardTennis.csproj
```

To distribute a Windows x64 build that does not require a separate .NET installation:

```powershell
dotnet publish src/GenieBouchardTennis/GenieBouchardTennis.csproj -c Release -r win-x64 --self-contained true -o artifacts/windows
```

Copy the **entire** `artifacts/windows` directory to a Windows PC and run `GenieBouchardTennis.exe`. Keep the bundled wallet HTML/JS/CSS beside the executable. Windows Forms requires Windows; Linux can build it and run the headless checks, but cannot run the desktop UI.

### Controls and rules

- **Arrows / WASD:** move on your half of the court.
- **Space:** serve, or swing when the bounced ball is near Genie. Release between swings.
- **Left / right while swinging:** aim the return.
- **P:** pause/resume. Switching away from the window automatically pauses.
- **N / New set:** start a fresh set against the selected opponent.

One set: love/15/30/40, deuce/advantage, win games by two points and the set by two games from six. At 6–6, a seven-point tie-break (win by two) decides the set. Servers alternate games and follow the one-then-two service rotation in a tie-break. Rallies use simplified arcade physics and automatic computer swings.

## Arcade1870 play rewards

Offline play always works. A completed active set qualifies **whether you win or lose**, provided you played for at least 30 active seconds and returned at least one shot. Pausing and waiting idle to serve do not count. Select an eligible set in the toolbar and click **Claim A1870** to open its wallet page in your default browser. Eligible sets and claim pages are retained only while the game is open; claim before exiting.

The integration uses the public configuration and claim protocol from [Crypto Hockey](https://github.com/jcampbell1870/Crypto-Hockey/blob/master/appsettings.json):

| Setting | Shared value |
| --- | --- |
| Network | Ethereum mainnet (chain ID 1) |
| Token | `0x8eddD4edea39c5B5f77662453600F53A202EE47C` |
| Treasury reward vault | `0x1e4f6e4a382adbdb662733a19ae773d3ab8f497d` |
| Reward | 10 A1870, 18 decimals |

**Live payouts are not enabled by default.** Crypto Hockey's checked-in issuer URL is empty. These addresses are shared configuration, not proof of a live, funded, or authorized deployment. An operator must supply an authorized HTTPS reward issuer, verify the contracts and vault signer on mainnet, and fund the shared vault. This project does not deploy a new vault or hold treasury keys.

Set the **exact** issuer endpoint before launching:

```powershell
$env:GENIE_REWARD_ISSUER_URL = "https://your-authorized-issuer.example/api/reward-claim"
dotnet run --project src/GenieBouchardTennis/GenieBouchardTennis.csproj
```

The game sends Crypto Hockey's `{ recipient, game }` JSON request with a unique game ID, `mode: "tennis"`, final game scores, difficulty, completion time, and win flag. The issuer returns `{ amount, nonce, deadline, signature, vaultAddress, chainId }`. Amount and nonce are decimal strings. Chain, vault, amount, uint256 bounds, expiry, and signature format are checked before encoding `claim(uint256,uint256,uint256,bytes)`.

Use MetaMask or a compatible browser wallet. If your default browser lacks the extension, copy the local URL into your wallet-enabled browser. The wallet page is served only on a random loopback port and unguessable path; it requires same-origin claim requests. Connect the recipient wallet, review the **10 A1870** claim, and approve it. The wallet must be on mainnet and have **ETH for transaction gas**. No seed phrases, wallet keys, or treasury signing keys are requested or stored. Contract code must exist at the vault before submission, and the vault validates the issuer signature during simulation and execution. A submitted hash is **not** reported as a confirmed reward until a successful receipt includes the expected **10 A1870 token transfer from the vault to the recipient**.

### Operator/security limitations

Desktop results are **not authoritative anti-cheat proof**. Before enabling funded production rewards, the issuer must authenticate players, verify completed play server-side, rate-limit issuance, and enforce durable one-reward-per-game accounting across restarts and claim expiry. Crypto Hockey's public issuer code accepts client game metadata and has in-memory deduplication; do not expose that implementation unchanged as an unrestricted payout service. This client intentionally does not add an issuer or distribute any signing credentials.

Within one running game, each set is bound to its first recipient and its signed claim is cached without renewing expired claims. The vault is responsible for nonce replay protection. Browser refreshes cannot prove that an earlier transaction is absent: check your wallet before retrying, and never submit twice for the same set. Claim bridges shut down when the game exits. Rejected, unavailable, expired, pending, and reverted claims do not count as paid rewards. Real-wallet payouts require operator setup and have not been verified against a live deployment.

## Validate

Console checks with no test-framework dependency cover scoring, serving, deterministic winning/losing sets, reward eligibility, shared-issuer JSON, ABI encoding, and malformed claim rejection:

```powershell
dotnet run --project tests/GameChecks/GameChecks.csproj -- --bridge
dotnet build GenieBouchardTennis.sln -c Release
node --test tests/wallet-checks.cjs
node --test tests/online-checks.cjs tests/browser-checks.cjs
```

`--bridge` also checks the running loopback wallet page and its origin/Host protections. Add `--wait` to leave that page running for browser inspection. The wallet checks use Node.js's built-in test runner with a mocked provider to verify rejection, pending, reverted, and successful receipt states. No real issuer or wallet is contacted by these checks.
