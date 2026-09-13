"""Local visual fixture: exact repository templates/assets, synthetic HA data.

No Home Assistant client, credentials, or household data are loaded.
"""
import asyncio
import colorsys
import copy
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent
app = FastAPI()
environments = {}
queues = {key: set() for key in ("before", "after")}
for key in queues:
    environments[key] = Environment(loader=FileSystemLoader(ROOT / key / "templates"), autoescape=select_autoescape())
    app.mount(f"/{key}/static", StaticFiles(directory=ROOT / key / "static"))

FIXTURE = {
    "light.color_lamp": {"state": "on", "attributes": {"friendly_name": "Color lamp", "supported_color_modes": ["rgb", "color_temp"], "color_mode": "rgb", "brightness": 191, "rgb_color": [107, 255, 193], "hs_color": [155, 58], "color_temp_kelvin": None, "min_color_temp_kelvin": 2000, "max_color_temp_kelvin": 6500}},
    "light.white_lamp": {"state": "on", "attributes": {"friendly_name": "White ambiance lamp", "supported_color_modes": ["color_temp"], "color_mode": "color_temp", "brightness": 140, "color_temp_kelvin": 4200, "min_color_temp_kelvin": 2200, "max_color_temp_kelvin": 6500}},
    "light.dimmable_lamp": {"state": "on", "attributes": {"friendly_name": "Dimmable reading lamp with a deliberately long name", "supported_color_modes": ["brightness"], "brightness": 102}},
    "light.simple_lamp": {"state": "on", "attributes": {"friendly_name": "On/off lamp", "supported_color_modes": ["onoff"]}},
    "light.off_lamp": {"state": "off", "attributes": {"friendly_name": "Color lamp (off)", "supported_color_modes": ["rgb"], "brightness": 200, "rgb_color": [64, 128, 255]}},
    "light.unavailable_lamp": {"state": "unavailable", "attributes": {"friendly_name": "Unavailable lamp", "supported_color_modes": ["color_temp"], "min_mireds": 153, "max_mireds": 500}},
}
states = {key: copy.deepcopy(FIXTURE) for key in queues}

def require_variant(variant):
    if variant not in states:
        raise HTTPException(404)

@app.get("/g/{variant}", response_class=HTMLResponse)
async def guest(request: Request, variant: str):
    require_variant(variant)
    return environments[variant].get_template("guest_pwa.html").render(
        request=request, slug=variant, label="Guest lighting demo", app_name="HAPass",
        brand_bg="#F2F0E9", brand_bg_dark="#211411", brand_primary="#D9523C", brand_css="",
        csp_nonce="local-visual-fixture", base_path=f"/{variant}", expires_at=2147483647,
        never_expires=2147483647, contact_message="This is a synthetic preview.",
    )

@app.get("/g/{variant}/state")
async def state(variant: str):
    require_variant(variant)
    return {"states": states[variant], "entities": list(states[variant])}

@app.get("/g/{variant}/stream")
async def stream(variant: str):
    require_variant(variant)
    queue = asyncio.Queue()
    queues[variant].add(queue)
    async def events():
        try:
            yield 'event: connected\ndata: {}\n\n'
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"event: state_change\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ': keepalive\n\n'
        finally:
            queues[variant].discard(queue)
    return StreamingResponse(events(), media_type="text/event-stream")

@app.post("/g/{variant}/command")
async def command(request: Request, variant: str):
    require_variant(variant)
    payload = await request.json()
    entity = payload.get("entity_id")
    if entity not in states[variant]:
        raise HTTPException(400)
    with (ROOT / "commands.jsonl").open("a") as out:
        out.write(json.dumps({"variant": variant, **payload}) + "\n")
    current = states[variant][entity]
    current["state"] = "off" if payload["service"].endswith("turn_off") else "on"
    data = payload.get("data", {})
    current["attributes"].update(data)
    if "rgb_color" in data:
        hue, saturation, _ = colorsys.rgb_to_hsv(*(channel / 255 for channel in data["rgb_color"]))
        current["attributes"].update(color_mode="rgb", hs_color=[hue * 360, saturation * 100], color_temp_kelvin=None, color_temp=None)
    elif "color_temp_kelvin" in data:
        current["attributes"].update(color_mode="color_temp", hs_color=None, rgb_color=None)
    if "brightness_pct" in data:
        current["attributes"]["brightness"] = round(data["brightness_pct"] * 255 / 100)
    for queue in queues[variant]:
        await queue.put({"entity_id": entity, "state": copy.deepcopy(current)})
    return {"success": True}

@app.get("/{variant}/g/{slug}/manifest.json")
async def manifest(variant: str, slug: str):
    require_variant(variant)
    return {"name": "HAPass visual fixture", "start_url": f"/g/{variant}", "display": "standalone"}

@app.post("/preview/reset")
async def reset():
    for key in states:
        states[key] = copy.deepcopy(FIXTURE)
    return {"reset": True}

@app.post("/preview/state/{variant}/{entity}")
async def fixture_update(request: Request, variant: str, entity: str):
    require_variant(variant)
    if entity not in states[variant]:
        raise HTTPException(400)
    states[variant][entity].update(await request.json())
    for queue in queues[variant]:
        await queue.put({"entity_id": entity, "state": copy.deepcopy(states[variant][entity])})
    return {"updated": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
