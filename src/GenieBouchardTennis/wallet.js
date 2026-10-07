"use strict";
const connect = document.getElementById("connect");
const send = document.getElementById("send");
const status = document.getElementById("status");
let prepared = null;
let submitted = false;
const vault = "0x1e4f6e4a382adbdb662733a19ae773d3ab8f497d";
const token = "0x8eddd4edea39c5b5f77662453600f53a202ee47c";
function report(message) { status.textContent = message; }
function wallet() {
  if (!window.ethereum) throw new Error("Open this URL in a browser with an Ethereum wallet extension.");
  return window.ethereum;
}
async function assertAccount() {
  const accounts = await wallet().request({ method: "eth_accounts" });
  if (!accounts[0] || accounts[0].toLowerCase() !== prepared.recipient.toLowerCase())
    throw new Error("Select the wallet that requested this claim.");
  const chain = await wallet().request({ method: "eth_chainId" });
  if (BigInt(chain) !== 1n) throw new Error("Select Ethereum mainnet in your wallet.");
}
connect.addEventListener("click", async () => {
  connect.disabled = true;
  send.disabled = true;
  try {
    const accounts = await wallet().request({ method: "eth_requestAccounts" });
    report("Requesting issuer authorization…");
    const response = await fetch("claim", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: accounts[0] })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Issuer request failed.");
    if (result.claim.chainId !== 1 || result.claim.vaultAddress.toLowerCase() !== vault ||
        result.tokenAddress.toLowerCase() !== token || result.claim.amount !== "10000000000000000000")
      throw new Error("Unexpected reward destination or amount.");
    prepared = result;
    await wallet().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    await assertAccount();
    report("Issuer authorized 10 A1870 for " + prepared.recipient +
      ".\nNot paid yet. Approve only the claim transaction to the displayed vault. ETH gas is required.");
    send.disabled = false;
  } catch (error) { report(error.message || "Wallet or issuer request failed."); }
  finally { connect.disabled = submitted; }
});
send.addEventListener("click", async () => {
  send.disabled = true;
  connect.disabled = true;
  try {
    await assertAccount();
    if (prepared.claim.deadline <= Math.floor(Date.now() / 1000))
      throw new Error("The claim expired. Ask the issuer operator for help; do not request another payout for this set.");
    const tx = { from: prepared.recipient, to: vault, data: prepared.data, value: "0x0" };
    // The vault checks the issuer signature and nonce before the wallet prompts for spending gas.
    await wallet().request({ method: "eth_call", params: [tx, "latest"] });
    const gas = await wallet().request({ method: "eth_estimateGas", params: [tx] });
    await assertAccount();
    const hash = await wallet().request({ method: "eth_sendTransaction", params: [{ ...tx, gas }] });
    submitted = true;
    report("Submitted, NOT confirmed: " + hash + "\nWaiting for a receipt…");
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await assertAccount();
      const receipt = await wallet().request({ method: "eth_getTransactionReceipt", params: [hash] });
      if (!receipt) continue;
      if (BigInt(receipt.status) !== 1n) throw new Error("Transaction reverted. No reward was confirmed; gas may have been spent.");
      report("Vault claim confirmed: " + hash + "\nCheck your A1870 balance in the wallet. Never approve a second transaction for this set.");
      return;
    }
    report("Still pending. Check this transaction in your wallet; do not submit again.");
  } catch (error) {
    report((error.message || "Claim failed.") + (submitted ? "\nA transaction was submitted. Check your wallet before any retry." : "\nNo confirmed reward."));
  } finally {
    send.disabled = submitted;
    connect.disabled = submitted;
  }
});
