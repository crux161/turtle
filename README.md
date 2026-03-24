# Turtle

![Turtle Splash](resources/turtle-preview.gif)

Turtle is a love letter to anime, watch parties, and the idea that not everyone wants to live in a terminal to watch a show.

At its core, Turtle is a GUI-first front-end built around **Anima**, which is itself a TypeScript port of the scraping heart behind the much more popular [ani-cli](https://github.com/pystardust/ani-cli). That means the spirit is still very much `ani-cli`: fetch HTML, parse the page, resolve the episode, get the stream, and go watch your show. The difference is that Turtle wraps that backend in a proper interface so it can feel slick, social, and honestly... kind of gorgeous.

This whole thing exists because a lot of people either:

- do not like the terminal
- do not know how to use the terminal
- or simply want anime in a prettier bottle

And while yes, I still want those people to grow... this is the bottle.

## Why "Turtle"?

The name came out of a silly little play on words that made me laugh:

`ani-cli -> ani-gui -> GUI -> 龜 gui ("turtle") -> Turtle`

So Turtle became the name for the front-end, and **Anima** became the backend that does the heavy lifting.

Turtle can run in two ways:

- as a **standalone Electron app**
- as a **gamelette** inside a larger Electron app, where it lives in a sandboxed iframe and talks to the host over `postMessage`

That second mode is part of a bigger idea I’m weirdly fond of: little quarantined modules that can be games, watch-party tools, emulators, or whatever else fits. Kinda like Discord Activities, but for my own mad-scientist purposes.

## What Lives In This Repo

This repo is the Turtle workspace. The important pieces are:

- [`anima/`](anima)  
  The standalone desktop backend and Electron shell. This is where the scraper, local API server, media proxy, persistence, and packaging logic live.

- [`games/Turtle/`](games/Turtle)  
  The distributable Turtle gamelette module and build/export glue.

- [`games/Turtle/web/`](games/Turtle/web)  
  The shared React/Vite frontend used by both standalone Turtle and the gamelette build.

- [`resources/themes/`](resources/themes)  
  Proteus-style theme files used by Turtle for both dark mode and light mode.

- [`resources/DM-Sans/`](resources/DM-Sans) and [`resources/HarmonyOS-Sans/`](resources/HarmonyOS-Sans)  
  The fonts Turtle uses in the interface.

- [`games/manifest.json`](games/manifest.json) and [`resources/games/manifest.json`](resources/games/manifest.json)  
  Gamelette library manifests that register Turtle alongside the other modules in this workspace.

## What Turtle Does

Right now Turtle is built around a few main ideas:

- searchable anime discovery with AniList-backed suggestions
- a shared frontend that works in both standalone mode and gamelette mode
- local stream resolution through Anima
- resume/history tracking
- favorites
- artwork caching
- theme support based on the same `resources/themes` model used by Proteus
- a custom player UI instead of just punting everything to the native video element

In standalone mode, Turtle also runs its own local API server and media proxy so the frontend can stay clean and browser-like while the backend handles scraping, headers, redirects, referers, caching, and all the cursed little details.

## Development

This repo uses **Bun** for the workspace scripts.

Install dependencies:

```bash
bun install
```

### Run the standalone local server

```bash
bun run turtle:server
```

This builds the Turtle web frontend, starts the Anima backend, and opens the standalone Turtle client.

### Build the shared Turtle frontend

```bash
bun run turtle:web
```

That produces:

- `games/Turtle/dist/standalone`
- `games/Turtle/dist/gamelette`

### Build the standalone app code

```bash
bun run turtle:build
```

This builds the frontend, compiles the Anima/Electron code, and copies the Turtle assets plus theme files into the packaged app tree.

### Build the standalone `.app`

```bash
bun run turtle:app
```

Output lands under:

- `release/mac-arm64/Turtle.app`

### Build the packaged installer flow

```bash
bun run build-electron
```

That runs the full standalone packaging path from the root workspace.

### Export the gamelette bundle

```bash
bun run turtle:export-proteus
```

That prepares a ready-to-copy Turtle export for host integration.

## Architecture

The stack looks like this:

1. **Frontend**  
   React/Vite app in `games/Turtle/web`

2. **Shared Runtime Layer**  
   Decides whether Turtle should talk to:
   - the standalone local HTTP API
   - or a parent Electron host via `postMessage`

3. **Anima Backend**  
   Handles search, episode resolution, stream extraction, image caching, persistence, and local media proxying

4. **Electron Shell**  
   Hosts the standalone app and gives Turtle its desktop window

So yes, the frontend is mostly a consumer. The weirdness and hard work live below it.

## Themes

Turtle follows the same theme-file idea used by Proteus.

Theme files live in:

- `resources/themes`

And Turtle supports both:

- dark mode
- light mode

The frontend loads those CSS token files at runtime and maps Turtle’s UI onto them, instead of pretending it lives in its own totally separate design universe.

## A Small Thank You

The `ani-cli` team deserves real credit here.

Without their work, their design instincts, and their absurd amount of terminal anime excellence, none of this would exist in the form it does now. Anima exists because of that lineage, and Turtle exists because I wanted to dive head-first into a different front-end for the same core idea.

So: thank you, genuinely.

## Final Note

This is still a bit of a mixed bag. Some of it is elegant. Some of it is cursed. Some of it is both at the same time.

But the heart is in the right place.

If you made it this far, leave a star! ✨

Thanks for reading.
