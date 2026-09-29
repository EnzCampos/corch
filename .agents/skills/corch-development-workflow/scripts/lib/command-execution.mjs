import { spawn, spawnSync } from "node:child_process";

function invocation(command, args) {
  if (process.platform !== "win32" || !["npm", "pnpm", "corepack"].includes(command)) {
    return [command, args];
  }
  // Only simple tokens reach cmd.exe. Executable paths and cwd may contain spaces.
  if ([command, ...args].some((value) => !/^[a-zA-Z0-9@._/:-]+$/u.test(value))) {
    throw new Error("Unsupported Corepack argument");
  }
  return ["cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")]];
}

export function run(command, args, options = {}) {
  const [executable, parameters] = invocation(command, args);
  return spawnSync(executable, parameters, {
    encoding: "utf8", timeout: 15_000, ...options, shell: false, windowsHide: true,
  });
}

// Supervise the command tree, not just its immediate parent, on timeout/interruption.
export function runCommand(command, args, { cwd, timeoutMs = 180_000, maxOutput = 64_000 } = {}) {
  const [executable, parameters] = invocation(command, args);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  return new Promise((resolve) => {
    const child = spawn(executable, parameters, {
      cwd, shell: false, windowsHide: true, detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let failure;
    const append = (chunk) => { output = (output + chunk).slice(-maxOutput); };
    child.stdout.setEncoding("utf8").on("data", append);
    child.stderr.setEncoding("utf8").on("data", append);
    const stop = (reason) => {
      if (failure) return;
      failure = reason;
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true, timeout: 10_000,
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL"); }
      }
    };
    const interrupt = () => stop("Command interrupted");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => stop("Command timed out"), timeoutMs);
    child.once("error", (error) => { failure = error.message; });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      resolve({ status, stdout: output, stderr: failure || "", signal,
        ...(failure ? { error: new Error(failure) } : {}) });
    });
  });
}
