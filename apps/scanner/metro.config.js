const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const config = getDefaultConfig(__dirname);
// React Native's Windows release command passes index.ts relative to the app root.
// Keep native entry resolution there even though dependencies live in workspaces.
config.server.unstable_serverRoot = __dirname;
const root = path
  .resolve(__dirname, "../..")
  .split(path.sep)
  .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("[/\\\\]");
// Workspace-local tool caches and rendered evidence are never application modules.
config.resolver.blockList = [
  new RegExp(
    `${root}[/\\\\](?:\\.cache|\\.tools|tmp|docs|output|fixtures)[/\\\\]`,
  ),
];
config.resolver.useWatchman = false;
if (process.env.TALA_METRO_DIAGNOSTICS === "1") {
  const logger = (label) => ({
    start() {},
    end() {},
    annotate() {},
    point(name) {
      console.log(`[metro:${label}] ${name}`);
    },
    subSpan(name) {
      return logger(`${label}/${name}`);
    },
  });
  config.unstable_perfLoggerFactory = logger;
}
module.exports = config;
