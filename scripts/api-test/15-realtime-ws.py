#!/usr/bin/env python3
"""Watches realtime-gateway push events live, as the customer from 09.

Run this FIRST, in its own terminal, then run 09/10/11 in another one —
watch ride.assigned.v1 (etc.) arrive here in real time instead of polling.
Uses the `websocket-client` package (already available in this environment;
`pip install websocket-client` if not).

Code to read alongside this: apps/realtime-gateway/internal/httpapi/ws.go
(ServeCustomer) and internal/relay/*.go (one handler per Kafka topic,
each just calls hub.SendToCustomer — see internal/hub/hub.go for the
actual fan-out).
"""
import json
import os
import re
import sys
import time

import websocket

STATE_FILE = os.path.join(os.path.dirname(__file__), ".state")


def load_state():
    # .state is written by lib.sh's save() using bash's `printf '%q'`, so
    # values are backslash-escaped for shell re-sourcing (e.g. Sanctum
    # tokens contain a literal `|`, written as `\|`) — undo that here.
    state = {}
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            for line in f:
                line = line.strip()
                if line and "=" in line:
                    k, v = line.split("=", 1)
                    state[k] = re.sub(r"\\(.)", r"\1", v)
    return state


def main():
    state = load_state()
    token = state.get("CUSTOMER_TOKEN")
    if not token:
        print("No CUSTOMER_TOKEN in .state — run 01-register-customer.sh first.", file=sys.stderr)
        sys.exit(1)

    realtime_url = os.environ.get("REALTIME_URL", "http://127.0.0.1:8083")
    ws_url = realtime_url.replace("http://", "ws://").replace("https://", "wss://")
    ws_url = f"{ws_url}/v1/ws/customer?token={token}"

    print(f"Connecting to {ws_url} ...")
    ws = websocket.create_connection(ws_url)
    print("Connected. Waiting for events (Ctrl+C to stop) — now go run 09/11 in another terminal.\n")

    try:
        while True:
            raw = ws.recv()
            ts = time.strftime("%H:%M:%S")
            try:
                parsed = json.loads(raw)
                print(f"[{ts}] {json.dumps(parsed, indent=2)}")
            except json.JSONDecodeError:
                print(f"[{ts}] (non-JSON) {raw}")
    except KeyboardInterrupt:
        print("\nClosing.")
    finally:
        ws.close()


if __name__ == "__main__":
    main()
