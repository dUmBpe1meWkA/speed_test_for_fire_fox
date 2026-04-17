# NetSpeed

NetSpeed is a Firefox extension for quick internet speed testing directly from the browser toolbar.

It shows:

- download speed
- upload speed
- ping
- public IP
- country

The extension has a live speedometer UI and displays metrics in real time while the test is running.

## Features

- Real-time download measurement
- Real-time upload measurement
- Ping measurement
- Public IP detection
- Country detection
- Clean popup interface with gauge/speedometer
- Firefox Manifest V3 support

## How it works

NetSpeed uses public Cloudflare speed test endpoints:

- download test
- upload test
- ping test
- IP/country lookup via Cloudflare trace

The extension does not require a custom backend.

## Project structure

```text
manifest.json   # Firefox extension manifest
popup.html      # popup UI
popup.js        # measurement logic and UI updates
icon.svg        # extension icon
