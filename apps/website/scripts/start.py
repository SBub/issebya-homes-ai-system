#!/usr/bin/env python3
"""
Launch local Supabase, Next.js development server, and Stripe webhook listener.
Press Ctrl+C to gracefully terminate all processes.
"""

import subprocess
import signal
import sys
import os
import time

pids = []
shutting_down = False


def ensure_supabase_running(project_root: str) -> None:
    """Start local Supabase if not already running."""
    print("Checking local Supabase status...")
    result = subprocess.run(
        ["yarn", "supabase", "status"],
        cwd=project_root,
        capture_output=True,
        text=True,
    )

    # Check if Supabase is running by looking for the status output
    if result.returncode != 0 or "not running" in result.stdout.lower():
        print("Starting local Supabase...")
        start_result = subprocess.run(
            ["yarn", "supabase", "start"],
            cwd=project_root,
        )
        if start_result.returncode != 0:
            print("ERROR: Failed to start Supabase. Is Docker running?")
            sys.exit(1)
        print("Supabase started successfully")
    else:
        print("Supabase already running")


def kill_tree(pid):
    """Kill a process and all its children using pkill."""
    try:
        # First try to kill child processes
        subprocess.run(["pkill", "-P", str(pid)], capture_output=True)
        # Then kill the process itself
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def force_kill_tree(pid):
    """Force kill a process and all its children."""
    try:
        subprocess.run(["pkill", "-9", "-P", str(pid)], capture_output=True)
        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def cleanup(signum=None, frame=None):
    """Terminate all child processes."""
    global shutting_down
    if shutting_down:
        return
    shutting_down = True

    print("\nShutting down...")

    # Send SIGTERM to all process trees
    for pid in pids:
        kill_tree(pid)

    # Wait a moment for graceful shutdown
    time.sleep(1)

    # Force kill anything still running
    for pid in pids:
        force_kill_tree(pid)

    print("Done.")
    sys.exit(0)


def main():
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Kill any process already using port 3000
    pids_on_3000 = subprocess.run(["lsof", "-ti", ":3000"], capture_output=True, text=True).stdout.strip()
    if pids_on_3000:
        print("Killing process on port 3000...")
        subprocess.run(["kill", "-9"] + pids_on_3000.split("\n"), capture_output=True)

    # Ensure local Supabase is running before starting the app
    ensure_supabase_running(project_root)

    print("Starting Next.js development server...")
    app_proc = subprocess.Popen(
        ["yarn", "dev"],
        cwd=project_root,
        preexec_fn=os.setsid,
    )
    pids.append(app_proc.pid)

    print("Starting Stripe webhook listener...")
    webhook_proc = subprocess.Popen(
        ["yarn", "webhook"],
        cwd=project_root,
        preexec_fn=os.setsid,
    )
    pids.append(webhook_proc.pid)

    print("\nBoth processes running. Press Ctrl+C to stop.\n")

    # Wait for either process to exit
    while True:
        if app_proc.poll() is not None or webhook_proc.poll() is not None:
            break
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        cleanup()
