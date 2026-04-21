# Tranquilo Claude Desktop Bundle

This directory is the source for a Claude Desktop `.mcpb` bundle. Release builds should copy the compiled `dist/` directory here and run:

```sh
bunx @anthropic-ai/mcpb pack
```

`@anthropic-ai/mcpb` is only for MCPB init/pack workflows. It does not prevent agent-doc or tool-schema drift. Keep `packages/product/src/agent-catalog.ts` as the source of truth and run `bun run generate` to update `manifest.json`, docs, landing metadata, and shipped agent assets.

`manifest.json` is generated from `package.json`: `version` follows the Tranquilo package version, while `dxt_version` and `compatibility.platforms` come from `tranquilo.mcpb`. The current MCPB compatibility list is macOS and Windows because it targets Claude Desktop, while CLI releases also include Linux.

Users should prefer the prebuilt `.mcpb` from Tranquilo releases.
