import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

function quoteWindowsArgument(value) {
  // MSYS also splits newlines and expands unquoted globs/single quotes at startup.
  return (
    '"' +
    value
      .replace(/(\\*)"/gu, (_, slashes) => slashes + slashes + '\\"')
      .replace(/\\+$/u, (slashes) => slashes + slashes) +
    '"'
  );
}

function invocation(command, args, { cwd, env = process.env } = {}) {
  if (
    process.platform !== "win32" ||
    !["npm", "pnpm", "corepack"].includes(command)
  ) {
    return [command, args, env];
  }
  let bash = env.CORCH_BASH;
  if (!bash) {
    const git = spawnSync("git", ["--exec-path"], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 15_000,
      shell: false,
      windowsHide: true,
    });
    if (git.status === 0 && git.stdout.trim()) {
      bash = path.resolve(git.stdout.trim(), "../../../usr/bin/bash.exe");
    }
  }
  if (!bash || !path.isAbsolute(bash) || !existsSync(bash)) {
    throw new Error(
      "Git Bash is required for Windows package managers; install Git for Windows or set CORCH_BASH to an absolute path to its bash.exe",
    );
  }
  // Git's bin/bash.exe is a launcher; supervise the persistent shell itself.
  const nativeBash = path.resolve(path.dirname(bash), "../usr/bin/bash.exe");
  if (existsSync(nativeBash)) bash = nativeBash;
  // Shebangs such as /usr/bin/env bash must resolve Git Bash, not the WSL launcher.
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  let shim;
  for (const directory of (env[pathKey] || "")
    .split(path.delimiter)
    .filter(Boolean)) {
    const candidate = path.resolve(
      cwd || process.cwd(),
      directory.replace(/^"(.*)"$/u, "$1"),
      command,
    );
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
      shim = candidate.replaceAll("\\", "/");
      break;
    }
  }
  if (!shim) throw new Error("No Bash shim found for " + command + " on PATH");
  env = {
    ...env,
    [pathKey]: path.dirname(bash) + path.delimiter + (env[pathKey] || ""),
  };
  // Disable startup scripts and MSYS path rewriting to preserve literal arguments.
  // Run the shim directly: a bash -c intermediary can orphan MSYS fork descendants.
  return [
    bash,
    ["--noprofile", "--norc", shim, ...args].map(quoteWindowsArgument),
    { ...env, BASH_ENV: "", MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" },
    true,
  ];
}

export function run(command, args, options = {}) {
  const [executable, parameters, env, windowsVerbatimArguments = false] =
    invocation(command, args, options);
  return spawnSync(executable, parameters, {
    encoding: "utf8",
    timeout: 15_000,
    ...options,
    env,
    windowsVerbatimArguments,
    shell: false,
    windowsHide: true,
    ...(windowsVerbatimArguments ? { argv0: "bash" } : {}),
  });
}

// Supervise the command tree, not just its immediate parent, on timeout/interruption.
export function runCommand(
  command,
  args,
  {
    cwd,
    env: environment = process.env,
    timeoutMs = 180_000,
    maxOutput = 64_000,
  } = {},
) {
  const [executable, parameters, env, windowsVerbatimArguments = false] =
    invocation(command, args, { cwd, env: environment });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("timeoutMs must be positive");
  return new Promise((resolve) => {
    const child = spawn(executable, parameters, {
      cwd,
      env,
      windowsVerbatimArguments,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      ...(windowsVerbatimArguments ? { argv0: "bash" } : {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let failure;
    const append = (chunk) => {
      output = (output + chunk).slice(-maxOutput);
    };
    child.stdout.setEncoding("utf8").on("data", append);
    child.stderr.setEncoding("utf8").on("data", append);
    const stop = (reason) => {
      if (failure) return;
      failure = reason;
      if (!child.pid) return;
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 10_000,
        });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") child.kill("SIGKILL");
        }
      }
    };
    const interrupt = () => stop("Command interrupted");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    const timer = setTimeout(() => stop("Command timed out"), timeoutMs);
    child.once("error", (error) => {
      failure = error.message;
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      resolve({
        status,
        stdout: output,
        stderr: failure || "",
        signal,
        ...(failure ? { error: new Error(failure) } : {}),
      });
    });
  });
}
