import { spawn } from "node:child_process";

const ENCRYPTION_ID = "windows-dpapi-current-user-v1";

function dpapiScript(operation) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName 'System.Security'",
    "try {",
    "  $data = [Convert]::FromBase64String([Console]::In.ReadToEnd())",
    "  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser",
    "  $result = [System.Security.Cryptography.ProtectedData]::" + operation + "($data, $null, $scope)",
    "  [Console]::Out.Write([Convert]::ToBase64String($result))",
    "} catch { exit 1 }",
  ].join("; ");
}

function dpapi(operation, source) {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("Windows DPAPI is required."));
  }
  const command = Buffer.from(dpapiScript(operation), "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-EncodedCommand", command,
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });

    let result = "";
    let completed = false;
    const fail = () => {
      if (!completed) {
        completed = true;
        reject(new Error("Windows DPAPI operation failed."));
      }
    };
    child.on("error", fail);
    child.stdout.on("data", chunk => {
      if (result.length + chunk.length > 4_000_000) {
        child.kill();
        fail();
      } else {
        result += chunk.toString("ascii");
      }
    });
    child.on("close", code => {
      if (completed) return;
      completed = true;
      if (code !== 0 || !result.trim()) {
        reject(new Error("Windows DPAPI operation failed."));
        return;
      }
      try {
        resolve(Buffer.from(result.trim(), "base64"));
      } catch {
        reject(new Error("Invalid Windows DPAPI output."));
      }
    });
    child.stdin.on("error", fail);
    child.stdin.end(Buffer.from(source).toString("base64"));
  });
}

export function createWindowsCredentialEncryption() {
  let available;
  const encrypt = async plaintext => new Uint8Array(
    await dpapi("Protect", Buffer.from(plaintext, "utf8")),
  );
  const decrypt = async ciphertext => (
    await dpapi("Unprotect", ciphertext)
  ).toString("utf8");

  return {
    id: ENCRYPTION_ID,
    async isAvailable() {
      if (available !== undefined) return available;
      if (process.platform !== "win32") return false;
      try {
        const ciphertext = await encrypt("facts-dpapi-healthcheck");
        available = await decrypt(ciphertext) === "facts-dpapi-healthcheck";
      } catch {
        available = false;
      }
      return available;
    },
    encrypt,
    decrypt,
  };
}
