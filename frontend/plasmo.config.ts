import * as path from "path";

export default {
  vite: (config) => {
    const repoRoot = path.resolve(__dirname, "..");
    const packagesRoot = path.resolve(repoRoot, "packages");
    const vestiContentPackageEntry = path.resolve(
      packagesRoot,
      "vesti-content-package",
      "src",
      "index.ts"
    );
    const vestiUiEntry = path.resolve(packagesRoot, "vesti-ui", "src", "index.ts");
    const localNodeModules = path.resolve(__dirname, "node_modules");

    config.resolve = config.resolve || {};
    config.resolve.preserveSymlinks = false;
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@vesti/content-package": vestiContentPackageEntry,
      // Force the extension to consume the shared UI through a frontend-controlled
      // entrypoint so all React imports resolve to the frontend's React 18 runtime.
      "@vesti/ui": vestiUiEntry,
      react: path.join(localNodeModules, "react"),
      "react-dom": path.join(localNodeModules, "react-dom"),
      "react/jsx-runtime": path.join(localNodeModules, "react/jsx-runtime"),
      "react/jsx-dev-runtime": path.join(localNodeModules, "react/jsx-dev-runtime"),
      "lucide-react": path.join(localNodeModules, "lucide-react"),
    };
    config.resolve.dedupe = [
      ...(config.resolve.dedupe || []),
      "react",
      "react-dom",
      "lucide-react",
    ];

    config.server = config.server || {};
    config.server.fs = config.server.fs || {};
    const allowList = config.server.fs.allow ?? [];
    config.server.fs.allow = Array.from(new Set([...allowList, repoRoot, packagesRoot]));

    return config;
  },
};
