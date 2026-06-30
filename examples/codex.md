# Codex

Install the Y2 MCP server with the Codex CLI:

```sh
export Y2_API_KEY=y2_...

codex mcp add y2 --env Y2_API_KEY=$Y2_API_KEY -- npx -y @y2-intel/mcp
```

Equivalent `config.toml`:

```toml
[mcp_servers.y2]
command = "npx"
args = ["-y", "@y2-intel/mcp"]
env_vars = ["Y2_API_KEY"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"
```

Use the default prompt approval mode until you are comfortable with which Y2
tools are enabled for the API key.
