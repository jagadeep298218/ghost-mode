"""
Ghost Mode Spoofer — single persistent DVT channel with built-in jitter.
Keeps one LocationSimulation channel alive and updates coordinates on it.
Communicates via stdin/stdout for the Electron app.

Commands (via stdin):
  set LAT LNG        - Set/update simulated location (instant teleport)
  travel LAT LNG     - Gradually move to target (realistic speed)
  jitter on          - Enable GPS jitter (random 2-5m drift every 2s)
  jitter off         - Disable GPS jitter
  clear              - Clear simulated location
  quit               - Exit cleanly

Output (via stdout):
  READY              - Channel is open, ready for commands
  OK set LAT LNG     - Location set successfully
  OK clear           - Location cleared
  OK jitter on/off   - Jitter toggled
  TRAVELING LAT LNG PROGRESS  - Travel progress update (0-100)
  OK travel LAT LNG  - Arrived at destination
  ERROR message      - Something went wrong
"""

import sys
import asyncio
import random
import signal
import math
import warnings

warnings.filterwarnings('ignore')


def haversine_km(lat1, lng1, lat2, lng2):
    """Distance between two points in km."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--rsd-host', required=True)
    parser.add_argument('--rsd-port', required=True, type=int)
    parser.add_argument('--lat', type=float, default=None)
    parser.add_argument('--lng', type=float, default=None)
    args = parser.parse_args()

    try:
        from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
        from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
        from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    except ImportError as e:
        print(f"ERROR import failed: {e}", flush=True)
        sys.exit(1)

    current_lat = args.lat
    current_lng = args.lng
    jitter_enabled = True
    stop_event = asyncio.Event()
    travel_task = None
    travel_cancel = asyncio.Event()

    # Connect RSD
    try:
        rsd = RemoteServiceDiscoveryService((args.rsd_host, args.rsd_port))
        await rsd.connect()
    except Exception as e:
        print(f"ERROR connect failed: {e}", flush=True)
        sys.exit(1)

    async with DvtProvider(rsd) as dvt:
        async with LocationSimulation(dvt) as location_sim:

            async def set_location(lat, lng):
                nonlocal current_lat, current_lng
                try:
                    await location_sim.set(lat, lng)
                    current_lat = lat
                    current_lng = lng
                    return True
                except Exception as e:
                    print(f"ERROR set failed: {e}", flush=True)
                    return False

            async def clear_location():
                nonlocal current_lat, current_lng
                try:
                    await location_sim.clear()
                    current_lat = None
                    current_lng = None
                    return True
                except Exception as e:
                    print(f"ERROR clear failed: {e}", flush=True)
                    return False

            async def do_travel(target_lat, target_lng):
                """Gradually move from current position to target at realistic speed."""
                nonlocal current_lat, current_lng

                if current_lat is None or current_lng is None:
                    # No current position, just set directly
                    if await set_location(target_lat, target_lng):
                        print(f"OK travel {target_lat} {target_lng}", flush=True)
                    return

                start_lat = current_lat
                start_lng = current_lng
                dist_km = haversine_km(start_lat, start_lng, target_lat, target_lng)

                if dist_km < 0.01:
                    # Already there
                    if await set_location(target_lat, target_lng):
                        print(f"OK travel {target_lat} {target_lng}", flush=True)
                    return

                # Pick speed based on distance
                if dist_km < 0.5:
                    speed_kmh = 4 + random.random() * 2      # Walking: 4-6 km/h
                elif dist_km < 5:
                    speed_kmh = 25 + random.random() * 15     # City driving: 25-40 km/h
                elif dist_km < 50:
                    speed_kmh = 50 + random.random() * 30     # Highway: 50-80 km/h
                else:
                    speed_kmh = 80 + random.random() * 40     # Fast highway: 80-120 km/h

                travel_time_s = (dist_km / speed_kmh) * 3600
                # Cap at 10 minutes for very long distances
                travel_time_s = min(travel_time_s, 600)
                # Minimum 5 seconds
                travel_time_s = max(travel_time_s, 5)

                step_interval = 1.5  # Update every 1.5 seconds
                num_steps = max(int(travel_time_s / step_interval), 3)
                last_progress = -1

                for i in range(num_steps + 1):
                    if travel_cancel.is_set() or stop_event.is_set():
                        return

                    t = i / num_steps
                    # Ease in-out for realistic acceleration/deceleration
                    t_ease = t * t * (3 - 2 * t)

                    lat = start_lat + (target_lat - start_lat) * t_ease
                    lng = start_lng + (target_lng - start_lng) * t_ease

                    # Add small random drift to path (not perfectly straight)
                    if 0 < i < num_steps:
                        drift = (1 - abs(2 * t - 1)) * 0.0001  # Max drift in middle
                        lat += (random.random() - 0.5) * drift
                        lng += (random.random() - 0.5) * drift

                    await set_location(lat, lng)

                    progress = int(t * 100)
                    if progress != last_progress and progress % 5 == 0:
                        print(f"TRAVELING {lat:.6f} {lng:.6f} {progress}", flush=True)
                        last_progress = progress

                    if i < num_steps:
                        # Vary step timing slightly for realism
                        await asyncio.sleep(step_interval + (random.random() - 0.5) * 0.5)

                # Ensure we land exactly on target
                await set_location(target_lat, target_lng)
                print(f"OK travel {target_lat} {target_lng}", flush=True)

            async def jitter_loop():
                while not stop_event.is_set():
                    try:
                        await asyncio.wait_for(stop_event.wait(), timeout=2)
                        break
                    except asyncio.TimeoutError:
                        pass

                    if not jitter_enabled or current_lat is None:
                        continue
                    jlat = current_lat + (random.random() - 0.5) * 0.00005
                    jlng = current_lng + (random.random() - 0.5) * 0.00005
                    try:
                        await location_sim.set(jlat, jlng)
                    except Exception:
                        pass

            # Set initial location if provided
            if current_lat is not None and current_lng is not None:
                if await set_location(current_lat, current_lng):
                    print(f"OK set {current_lat} {current_lng}", flush=True)

            # Start jitter task
            jitter_task_handle = asyncio.create_task(jitter_loop())

            print("READY", flush=True)

            loop = asyncio.get_event_loop()

            try:
                while not stop_event.is_set():
                    line = await loop.run_in_executor(None, sys.stdin.readline)
                    if not line:
                        break

                    line = line.strip()
                    if not line:
                        continue

                    parts = line.split()
                    cmd = parts[0].lower()

                    if cmd == 'set' and len(parts) >= 3:
                        # Cancel any active travel
                        if travel_task and not travel_task.done():
                            travel_cancel.set()
                            try:
                                await travel_task
                            except asyncio.CancelledError:
                                pass
                            travel_cancel.clear()

                        lat = float(parts[1])
                        lng = float(parts[2])
                        if await set_location(lat, lng):
                            print(f"OK set {lat} {lng}", flush=True)

                    elif cmd == 'travel' and len(parts) >= 3:
                        # Cancel any active travel
                        if travel_task and not travel_task.done():
                            travel_cancel.set()
                            try:
                                await travel_task
                            except asyncio.CancelledError:
                                pass
                            travel_cancel.clear()

                        lat = float(parts[1])
                        lng = float(parts[2])
                        travel_task = asyncio.create_task(do_travel(lat, lng))

                    elif cmd == 'jitter':
                        if len(parts) >= 2 and parts[1].lower() == 'off':
                            jitter_enabled = False
                            print("OK jitter off", flush=True)
                        else:
                            jitter_enabled = True
                            print("OK jitter on", flush=True)

                    elif cmd == 'clear':
                        # Cancel any active travel
                        if travel_task and not travel_task.done():
                            travel_cancel.set()
                            try:
                                await travel_task
                            except asyncio.CancelledError:
                                pass
                            travel_cancel.clear()

                        if await clear_location():
                            print("OK clear", flush=True)

                    elif cmd == 'quit':
                        break

            except (EOFError, KeyboardInterrupt):
                pass
            finally:
                stop_event.set()
                if travel_task and not travel_task.done():
                    travel_cancel.set()
                await clear_location()
                jitter_task_handle.cancel()
                try:
                    await jitter_task_handle
                except asyncio.CancelledError:
                    pass

    try:
        await rsd.close()
    except Exception:
        pass


if __name__ == '__main__':
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    asyncio.run(main())
