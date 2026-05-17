"use client";

import { useEffect, useRef, useState } from "react";
import { feature } from "topojson-client";
import { geoEquirectangular, geoPath, GeoPath, GeoProjection } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function CyberMap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [data, setData] = useState<PresenceData>({ active: [], recent: [], now: Date.now() });
  const dataRef = useRef(data);
  dataRef.current = data;

  // Viewport (zoom/pan) state — refs so they don't trigger re-renders on every frame.
  const viewportRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

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
      const s = viewportRef.current.scale;
      // Outer subtle glow pass: draw thick & blurred for the bloom.
      ctx!.save();
      ctx!.strokeStyle = MAP_GLOW;
      ctx!.lineWidth = 2.5 / s;
      ctx!.shadowBlur = 8;
      ctx!.shadowColor = MAP_GLOW;
      ctx!.beginPath();
      pathGen(world);
      ctx!.stroke();
      // Crisp inner line.
      ctx!.shadowBlur = 0;
      ctx!.strokeStyle = MAP_STROKE;
      ctx!.lineWidth = 0.75 / s;
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
      const s = viewportRef.current.scale;
      // Inverse-scale radius so markers stay visually constant at any zoom.
      const r = radius / s;
      // Pulse ring (only for active).
      if (pulseT !== null) {
        const ringR = r + (pulseT * 14) / s;
        const ringA = (1 - pulseT) * 0.7;
        ctx!.save();
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = ringA;
        ctx!.lineWidth = 1.5 / s;
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
      ctx!.arc(x, y, r, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    function step(t: number) {
      if (!ctx) return;
      // Clear in screen-space BEFORE applying viewport transform.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Apply DPR, then viewport translate, then viewport scale.
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(viewportRef.current.tx, viewportRef.current.ty);
      ctx.scale(viewportRef.current.scale, viewportRef.current.scale);

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
      ctx.restore();
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

    const onVisibleCanvas = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(step);
    };
    document.addEventListener("visibilitychange", onVisibleCanvas);

    // --- Interaction handlers ---

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const vp = viewportRef.current;
      const newScale = clamp(vp.scale * (1 - e.deltaY * 0.001), 1, 8);
      // Keep the point under the cursor stationary while zooming.
      vp.tx = mx - (newScale * (mx - vp.tx)) / vp.scale;
      vp.ty = my - (newScale * (my - vp.ty)) / vp.scale;
      vp.scale = newScale;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: viewportRef.current.tx,
        ty: viewportRef.current.ty,
      };
      canvas.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const ds = dragStartRef.current;
      viewportRef.current.tx = ds.tx + (e.clientX - ds.x);
      viewportRef.current.ty = ds.ty + (e.clientY - ds.y);
    };

    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      canvas.style.cursor = "grab";
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      viewportRef.current.scale = 1;
      viewportRef.current.tx = 0;
      viewportRef.current.ty = 0;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("dblclick", onDblClick);

    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibleCanvas);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("dblclick", onDblClick);
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
        pointerEvents: "auto",
        cursor: "grab",
        zIndex: 0,
        display: "block",
      }}
    />
  );
}
