# Security

Report security issues privately before opening public issues.

For the v0.1 local stdio release:

- Store `Y2_API_KEY` in environment variables only.
- Do not paste API keys into prompts or tool arguments.
- Use the narrowest Y2 API scopes required by the tools you enable.
- `agent:y2` allows Agent Y2 to act on your Y2 account within plan and scope
  limits. The `y2_ask_agent` tool is hidden unless `Y2_MCP_ENABLE_AGENT=1` is
  set.
