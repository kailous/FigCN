#!/usr/bin/env node

const path = require("path");
const { spawnSync } = require("child_process");

const SKIP_WINDOWS_BUILD = process.env.SKIP_WINDOWS_BUILD === "1";

function resolveBuilderBinary() {
  const binName = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
  return path.join(__dirname, "..", "node_modules", ".bin", binName);
}

function runBuilder(args) {
  const binary = resolveBuilderBinary();
  const result = spawnSync(binary, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildMacArtifacts() {
  runBuilder(["--mac", "dmg", "zip", "--arm64"]);
  runBuilder(["--mac", "dmg", "zip", "--x64"]);
}

function buildWindowsArtifacts() {
  runBuilder(["--win", "nsis", "zip", "--x64", "--arm64"]);
}

function buildForHost() {
  if (process.platform === "darwin") {
    buildMacArtifacts();
    if (SKIP_WINDOWS_BUILD) {
      console.log("[dist] SKIP_WINDOWS_BUILD=1, skipping Windows artifacts.");
      return;
    }
    buildWindowsArtifacts();
    return;
  }

  if (process.platform === "win32") {
    buildWindowsArtifacts();
    return;
  }

  console.error("Unsupported platform: only macOS and Windows builds are automated.");
  process.exit(1);
}

buildForHost();
