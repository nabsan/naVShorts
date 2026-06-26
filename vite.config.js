const fs = require("node:fs");
const path = require("node:path");

const react = require("@vitejs/plugin-react");
const { defineConfig } = require("vite");

function legacyUiBridge() {
  const projectRoot = process.cwd();
  const legacyRoot = path.join(projectRoot, "ui");

  function copyRecursive(sourceDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        copyRecursive(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  return {
    name: "legacy-ui-bridge",
    configureServer(server) {
      server.middlewares.use("/legacy", (req, res, next) => {
        const requested = (req.url || "/").split("?")[0].replace(/^\/+/, "");
        const filePath = path.join(legacyRoot, requested || "reframe_assist.html");
        if (!filePath.startsWith(legacyRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          next();
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".png": "image/png",
        };
        res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
        res.end(fs.readFileSync(filePath));
      });
    },
    closeBundle() {
      const outDir = path.join(projectRoot, "dist", "legacy");
      fs.rmSync(outDir, { recursive: true, force: true });
      copyRecursive(legacyRoot, outDir);
    },
  };
}

module.exports = defineConfig({
  plugins: [react.default(), legacyUiBridge()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
