# Shuttle Cockpit

A Claude Code theme that turns the desktop and mobile apps into a space shuttle flight deck at orbital night. You look out three forward windows at Earth's glowing edge and a drifting star field. Every so often, the Claude Code mascot floats past in a space suit.

The cockpit monitors show this session's real Claude Code usage. They update after every turn:

| Monitor | Shows |
| --- | --- |
| CONTEXT | How full the context window is, with tokens used and the window size |
| SESSION COST | Session cost in US dollars, plus time since the session started |
| MISSION LOG | Prompts sent and tool calls made |
| 7-DAY LIMIT | Weekly rate-limit usage (subscription plans only) |
| FLIGHT COMPUTER | The current model |
| THRUST · EFFORT | The effort level of the current request |

Gauges turn amber at 70% and red at 90%. The CAUTION and MASTER alarm lights come on at those levels too. The monitors switch to a compact layout in narrow windows, for example when the sidebar is open. The theme is dark-only, and its animations stop when your system is set to reduce motion. The terminal and editor extensions don't draw themes.

## Install

At the prompt of a terminal session:

```
/plugin install shuttle-cockpit --marketplace kdkyum/shuttle-cockpit
```

From a shell:

```
claude plugin install shuttle-cockpit --marketplace kdkyum/shuttle-cockpit
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins** → **Add marketplace** with `kdkyum/shuttle-cockpit`, then **Add plugin**.

The theme takes effect when a new session starts.
