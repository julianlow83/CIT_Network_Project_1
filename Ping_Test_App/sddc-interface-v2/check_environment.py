#!/usr/bin/env python3
import importlib.util
mods=['fastapi','uvicorn']
for m in mods:
    print(f"{m}: {'OK' if importlib.util.find_spec(m) else 'MISSING'}")
print("Standalone static preview does not require either package.")
