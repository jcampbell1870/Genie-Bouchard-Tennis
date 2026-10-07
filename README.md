# Genie-Bouchard-Tennis

An original 2D Windows arcade tennis game with a low-resolution court, pixel players, and keyboard controls inspired by early console sports games. Play as **Eugenie “Genie” Bouchard of Canada**, the strongest selectable character in this game's fictional balancing: she has more speed, reach, and shot power than all three computer opponents.

No Nintendo code, sprites, music, logos, or other game assets are used. This is an unofficial fan project, not an endorsement by Eugenie Bouchard or Nintendo. Obtain any necessary name/likeness permissions before commercial distribution.

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

Use MetaMask or a compatible browser wallet. If your default browser lacks the extension, copy the local URL into your wallet-enabled browser. The wallet page is served only on a random loopback port and unguessable path; it requires same-origin claim requests. Connect the recipient wallet, review the **10 A1870** claim, and approve it. The wallet must be on mainnet and have **ETH for transaction gas**. No seed phrases, wallet keys, or treasury signing keys are requested or stored. The vault validates the issuer signature during simulation and execution. A submitted hash is **not** reported as confirmed until a successful receipt arrives.

### Operator/security limitations

Desktop results are **not authoritative anti-cheat proof**. Before enabling funded production rewards, the issuer must authenticate players, verify completed play server-side, rate-limit issuance, and enforce durable one-reward-per-game accounting across restarts and claim expiry. Crypto Hockey's public issuer code accepts client game metadata and has in-memory deduplication; do not expose that implementation unchanged as an unrestricted payout service. This client intentionally does not add an issuer or distribute any signing credentials.

Within one running game, each set is bound to its first recipient and its signed claim is cached without renewing expired claims. The vault is responsible for nonce replay protection. Browser refreshes cannot prove that an earlier transaction is absent: check your wallet before retrying, and never submit twice for the same set. Claim bridges shut down when the game exits. Rejected, unavailable, expired, pending, and reverted claims do not count as paid rewards. Real-wallet payouts require operator setup and have not been verified against a live deployment.

## Validate

Console checks with no test-framework dependency cover scoring, serving, deterministic winning/losing sets, reward eligibility, shared-issuer JSON, ABI encoding, and malformed claim rejection:

```powershell
dotnet run --project tests/GameChecks/GameChecks.csproj -- --bridge
dotnet build GenieBouchardTennis.sln -c Release
node --test tests/wallet-checks.cjs
```

`--bridge` also checks the running loopback wallet page and its origin/Host protections. Add `--wait` to leave that page running for browser inspection. The wallet checks use Node.js's built-in test runner with a mocked provider to verify rejection, pending, reverted, and successful receipt states. No real issuer or wallet is contacted by these checks.
