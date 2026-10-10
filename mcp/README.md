# Explainer MCP server

Lets agents draw with the Explainer app: read the drawing guide, author drawings
or whole projects as JSON, validate them with the app's own checker, and save
them where the app's dashboard can import them.

## Run it

```bash
node mcp/server.mjs
```

Projects save to `$EXPLAINER_PROJECTS_DIR` (default `<repo>/projects/`).
Import a saved file from the app's dashboard with **Import JSON**.

## Connect an agent

**Claude Code** — `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "explainer": { "command": "node", "args": ["/absolute/path/to/explainer/mcp/server.mjs"] }
  }
}
```

**Cursor / Windsurf** — add the same command as an MCP server in settings.

**Any MCP client** — stdio transport, `node mcp/server.mjs`.

## Tools

| Tool | What it does |
|---|---|
| `validate_drawing` | Checks a drawing (or a whole project) and returns VALID or fixable problems. Run on everything before saving. |
| `list_examples` / `get_example` | The two videos that ship with the app, as project JSON + script. |
| `list_projects` / `get_project` | The project files agents have saved. |
| `save_project` | Validates and saves a project file the app can import. |

## Resource

`explainer://guide/drawing` — the drawing reference (`docs/DRAWING.md`). Read it
before authoring anything.

## The agent loop

1. Read the guide resource.
2. Write the drawing (or project) as JSON.
3. `validate_drawing` → fix what it names → repeat until VALID.
4. `save_project` → import the file from the dashboard → narrate → export.
