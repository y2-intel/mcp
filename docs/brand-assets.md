# Y2 Intel brand assets

Use these assets and copy consistently for the Claude connector and OpenAI listing.

| Listing field | Exact copy |
| --- | --- |
| Display name | Y2 Intel |
| Subtitle / short description | Profiles, maps, and signals |
| Brand color | `#292929` |
| Website | `https://y2.dev` |
| Support | `https://y2.dev/contact` |

Description: Connect your Y2 workspace to find intelligence profiles, read reports with
sources, explore signals and entities, and map public events. Access follows your workspace
permissions and plan. Source coverage and freshness vary.

Conversation starters, matching the OpenAI manifest:

- Find my Y2 intelligence profiles.
- Show the latest signals from my workspace with sources.
- Map recent geographic intelligence events in the United States.

## Owned logo

The existing Y2 orbital mark is white on black. The source is the Y2 platform repository's
`apps/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`.
It is a **1024 × 1024 PNG**, RGB, 140,315 bytes. These are byte-identical copies:

- [OpenAI listing and composer icon](../plugins/openai/assets/logo.png)
- [Claude bundle logo](../plugins/claude/assets/logo.png)
- [Embedded UI logo](../ui/public/logo.png)

SHA-256: `6d6969a1a7068cd37482361f6dce5141c9b9478abaaffdbc156237fa75a58ec3`.

Preserve its aspect ratio, artwork, and black background. The embedded view displays it at
36 × 36 CSS pixels. It uses Y2's existing neutral palette from the platform's
`apps/web/src/app.css`: `#292929` primary, `#5d5d5d` secondary text, white/black surfaces,
and gray borders. Assistant-provided theme and font tokens take precedence. Event severity
colors describe data; they are not alternative brand colors. No extra font or banner is loaded.

## Review and marketing captures

The logo and listing copy are prepared assets. Local synthetic bridge previews are development
evidence; they do not establish actual Claude or ChatGPT rendering, approved screenshots,
directory approval, or public availability.

Capture screenshots and the connection/workflow recording in each actual host after deployment
and authentication. Use the isolated review workspace, retain its **REVIEW FIXTURE** labels,
and keep credentials and other customers' data out of every capture. Show profiles, a sourced
report or signal, and the map with its country context and event list. Preserve genuine empty
or unsupported-map states when they occur. Do not substitute mock host chrome or imply a
provider endorsement. Track those captures and provider decisions in the release record.
