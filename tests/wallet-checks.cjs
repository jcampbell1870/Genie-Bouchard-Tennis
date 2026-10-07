const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const { test } = require("node:test");

const script = readFileSync(join(__dirname, "../src/GenieBouchardTennis/wallet.js"), "utf8");
const recipient = "0x" + "a".repeat(40);
function page(options = {}) {
  const elements = Object.fromEntries(["connect", "send", "status"].map(id =>
    [id, { disabled: id === "send", textContent: "", addEventListener(event, handler) { this.click = handler; } }]));
  const calls = [];
  const prepared = {
    recipient, data: "0x1234", tokenAddress: "0x8eddD4edea39c5B5f77662453600F53A202EE47C",
    claim: {
      amount: "10000000000000000000", chainId: 1,
      vaultAddress: "0x1e4f6e4a382adbdb662733a19ae773d3ab8f497d",
      deadline: Math.floor(Date.now() / 1000) + 600
    }
  };
  const ethereum = {
    async request({ method, params }) {
      calls.push({ method, params });
      if (options.reject === method) throw new Error("Wallet rejected");
      if (method === "eth_requestAccounts") return [recipient];
      if (method === "eth_accounts") return [options.account || recipient];
      if (method === "eth_chainId") return options.chain || "0x1";
      if (method === "eth_getCode") return options.noCode ? "0x" : "0x60016000";
      if (method === "eth_estimateGas") return "0x186a0";
      if (method === "eth_sendTransaction") return "0x" + "1".repeat(64);
      if (method === "eth_getTransactionReceipt") return options.pending ? null : {
        status: options.reverted ? "0x0" : "0x1", to: prepared.claim.vaultAddress,
        logs: options.noTransfer ? [] : [{
          address: prepared.tokenAddress,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            "0x" + prepared.claim.vaultAddress.slice(2).padStart(64, "0"),
            "0x" + (options.wrongRecipient ? "b".repeat(40) : recipient.slice(2)).padStart(64, "0")
          ],
          data: "0x" + BigInt(options.wrongAmount ? "1" : prepared.claim.amount).toString(16).padStart(64, "0")
        }]
      };
      return "0x";
    }
  };
  runInNewContext(script, {
    document: { getElementById: id => elements[id] },
    window: options.noWallet ? {} : { ethereum },
    fetch: async () => ({ ok: !options.issuerError, json: async () =>
      options.issuerError ? { error: "Issuer unavailable" } : prepared }),
    setTimeout: callback => callback()
  });
  return { ...elements, calls };
}

test("No-wallet and unavailable issuer never enable a transaction", async () => {
  for (const options of [{ noWallet: true }, { issuerError: true }]) {
    const ui = page(options);
    await ui.connect.click();
    assert.equal(ui.send.disabled, true);
    assert.equal(ui.calls.some(c => c.method === "eth_sendTransaction"), false);
    assert.doesNotMatch(ui.status.textContent, /confirmed:/);
  }
});
test("Recipient or network mismatch blocks spending", async () => {
  for (const options of [{ account: "0x" + "b".repeat(40) }, { chain: "0x89" }]) {
    const ui = page(options);
    await ui.connect.click();
    assert.equal(ui.send.disabled, true);
    assert.equal(ui.calls.some(c => c.method === "eth_sendTransaction"), false);
  }
});
test("Issuer authorization is not reported as payment", async () => {
  const ui = page();
  await ui.connect.click();
  assert.equal(ui.send.disabled, false);
  assert.match(ui.status.textContent, /Not paid yet/);
});
test("Simulation failure or wallet rejection does not confirm payment", async () => {
  for (const reject of ["eth_call", "eth_sendTransaction"]) {
    const ui = page({ reject });
    await ui.connect.click();
    await ui.send.click();
    assert.match(ui.status.textContent, /No confirmed reward/);
    assert.doesNotMatch(ui.status.textContent, /transfer confirmed/);
  }
});
test("Successful receipt confirms only after a simulated, zero-value vault claim", async () => {
  const ui = page();
  await ui.connect.click();
  await ui.send.click();
  const tx = ui.calls.find(c => c.method === "eth_sendTransaction").params[0];
  assert.equal(tx.to, "0x1e4f6e4a382adbdb662733a19ae773d3ab8f497d");
  assert.equal(tx.value, "0x0");
  assert.equal(tx.from, recipient);
  assert.ok(ui.calls.findIndex(c => c.method === "eth_call") <
            ui.calls.findIndex(c => c.method === "eth_sendTransaction"));
  assert.match(ui.status.textContent, /10 A1870 transfer confirmed/);
  assert.equal(ui.send.disabled, true);
  assert.equal(ui.connect.disabled, true);
});
test("Reverted or pending transactions stay unconfirmed and cannot be resubmitted", async () => {
  for (const options of [{ reverted: true }, { pending: true }]) {
    const ui = page(options);
    await ui.connect.click();
    await ui.send.click();
    assert.doesNotMatch(ui.status.textContent, /transfer confirmed/);
    assert.equal(ui.send.disabled, true);
    assert.equal(ui.connect.disabled, true);
  }
});
test("Undeployed vault blocks submission; missing or incorrect transfers block reward confirmation", async () => {
  for (const options of [{ noCode: true }, { noTransfer: true }, { wrongRecipient: true }, { wrongAmount: true }]) {
    const ui = page(options);
    await ui.connect.click();
    await ui.send.click();
    assert.doesNotMatch(ui.status.textContent, /transfer confirmed/);
    if (options.noCode) assert.equal(ui.calls.some(c => c.method === "eth_sendTransaction"), false);
    else {
      assert.equal(ui.send.disabled, true);
      assert.equal(ui.connect.disabled, true);
      assert.match(ui.status.textContent, /expected A1870 transfer was not found/);
    }
  }
});
