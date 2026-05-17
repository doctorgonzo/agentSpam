"use client";

import { useEffect, useRef, useState } from "react";
import { feature } from "topojson-client";
import { geoEquirectangular, geoPath, GeoPath, GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";

interface Ping {
  lat: number;
  lng: number;
  city?: string;
  country?: string;
  lastSeen: number;
}

interface PresenceData {
  active: Ping[];
  recent: Ping[];
  now: number;
}

// Cyberpunk palette: deep magenta borders, cyan active pulses, dim purple recent dots.
const MAP_STROKE = "rgba(217, 70, 239, 0.45)"; // fuchsia-500 with alpha
const MAP_GLOW = "rgba(217, 70, 239, 0.18)";
const ACTIVE_COLOR = "rgba(34, 211, 238, 1)"; // cyan-400
const ACTIVE_GLOW = "rgba(34, 211, 238, 0.6)";
const RECENT_COLOR = "rgba(168, 85, 247, 0.7)"; // purple-500 dim
const RECENT_GLOW = "rgba(168, 85, 247, 0.3)";

// Fetch the world topojson once and cache it module-level so multiple
// mounts (HMR, route changes) don't re-fetch.
let cachedWorld: FeatureCollection<Geometry> | null = null;
let worldPromise: Promise<FeatureCollection<Geometry>> | null = null;

async function loadWorld(): Promise<FeatureCollection<Geometry>> {
  if (cachedWorld) return cachedWorld;
  if (worldPromise) return worldPromise;
  worldPromise = (async () => {
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
    );
    const topo = await res.json();
    // @ts-expect-error — topojson types are awkward; this is correct at runtime.
    const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry>;
    cachedWorld = fc;
    return fc;
  })();
  return worldPromise;
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = sessionStorage.getItem("agentSpam.sessionId");
    if (existing) return existing;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem("agentSpam.sessionId", fresh);
    return fresh;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function CyberMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [data, setData] = useState<PresenceData>({ active: [], recent: [], now: Date.now() });
  const dataRef = useRef(data);
  dataRef.current = data;

  // Heartbeat + poll loops.
  useEffect(() => {
    const sessionId = getOrCreateSessionId();
    let cancelled = false;

    async function ping() {
      try {
        await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch {
        // ignore network errors
      }
    }

    async function poll() {
      try {
        const res = await fetch("/api/presence", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as PresenceData;
        if (!cancelled) setData(d);
      } catch {
        // ignore
      }
    }

    // Initial ping + poll.
    ping();
    poll();

    const pingInterval = setInterval(ping, 30_000);
    const pollInterval = setInterval(poll, 10_000);

    // Re-ping when tab regains focus so the dot pops back to "active".
    const onVisible = () => {
      if (!document.hidden) {
        ping();
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(pingInterval);
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Canvas render loop.
  useEffect(() => {
    const canvasMaybe = canvasRef.current;
    if (!canvasMaybe) return;
    const canvas: HTMLCanvasElement = canvasMaybe;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let world: FeatureCollection<Geometry> | null = null;
    let projection: GeoProjection | null = null;
    let pathGen: GeoPath | null = null;

    function rebuildProjection() {
      if (!world) return;
      // Equirectangular fitted to viewport, slightly cropped vertically so
      // antarctica doesn't gobble screen real estate.
      const proj = geoEquirectangular();
      // Fit to a virtual box slightly larger than viewport so coastlines
      // bleed past the edges (more cinematic).
      proj.fitExtent(
        [
          [-40, -60],
          [width + 40, height + 60],
        ],
        world,
      );
      projection = proj;
      pathGen = geoPath(proj, ctx!);
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.scale(dpr, dpr);
      rebuildProjection();
    }

    function drawMap() {
      if (!world || !pathGen) return;
      // Outer subtle glow pass: draw thick & blurred for the bloom.
      ctx!.save();
      ctx!.strokeStyle = MAP_GLOW;
      ctx!.lineWidth = 2.5;
      ctx!.shadowBlur = 8;
      ctx!.shadowColor = MAP_GLOW;
      ctx!.beginPath();
      pathGen(world);
      ctx!.stroke();
      // Crisp inner line.
      ctx!.shadowBlur = 0;
      ctx!.strokeStyle = MAP_STROKE;
      ctx!.lineWidth = 0.75;
      ctx!.beginPath();
      pathGen(world);
      ctx!.stroke();
      ctx!.restore();
    }

    function drawMarker(
      lng: number,
      lat: number,
      color: string,
      glow: string,
      radius: number,
      pulseT: number | null,
    ) {
      if (!projection) return;
      const xy = projection([lng, lat]);
      if (!xy) return;
      const [x, y] = xy;
      // Pulse ring (only for active).
      if (pulseT !== null) {
        const ringR = radius + pulseT * 14;
        const ringA = (1 - pulseT) * 0.7;
        ctx!.save();
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = ringA;
        ctx!.lineWidth = 1.5;
        ctx!.shadowBlur = 12;
        ctx!.shadowColor = glow;
        ctx!.beginPath();
        ctx!.arc(x, y, ringR, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.restore();
      }
      // Glow halo
      ctx!.save();
      ctx!.fillStyle = color;
      ctx!.shadowBlur = pulseT !== null ? 14 : 6;
      ctx!.shadowColor = glow;
      ctx!.beginPath();
      ctx!.arc(x, y, radius, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    function step(t: number) {
      if (!ctx) return;
      // Fully clear — we want crisp map + markers, no smear like the rain has.
      ctx.clearRect(0, 0, width, height);
      drawMap();
      const d = dataRef.current;
      // Recent (drawn first, under active).
      for (const p of d.recent) {
        drawMarker(p.lng, p.lat, RECENT_COLOR, RECENT_GLOW, 2.2, null);
      }
      // Active (pulsing).
      for (let i = 0; i < d.active.length; i++) {
        const p = d.active[i];
        // Stagger pulses so they don't all sync.
        const cyclePeriod = 1800;
        const pulseT = (((t + i * 380) % cyclePeriod) / cyclePeriod);
        drawMarker(p.lng, p.lat, ACTIVE_COLOR, ACTIVE_GLOW, 3.2, pulseT);
      }
      raf = requestAnimationFrame(step);
    }

    let mounted = true;
    loadWorld().then((w) => {
      if (!mounted) return;
      world = w;
      resize();
      raf = requestAnimationFrame(step);
    });

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    const onVisible = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(step);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
        display: "block",
      }}
    />
  );
}
