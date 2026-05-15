"use client";

import { useEffect, useRef } from "react";

interface Ripple {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  hue: number;
}

export default function BackgroundFX() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const lastSpawnRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const glow = glowRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = window.devicePixelRatio || 1;

    function resize() {
      if (!canvas || !ctx) return;
      dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    function onMove(e: MouseEvent) {
      if (glow) {
        glow.style.left = `${e.clientX}px`;
        glow.style.top = `${e.clientY}px`;
      }
      const now = performance.now();
      if (now - lastSpawnRef.current > 60) {
        lastSpawnRef.current = now;
        ripplesRef.current.push({
          x: e.clientX,
          y: e.clientY,
          radius: 4,
          alpha: 0.65,
          hue: 270 + Math.random() * 60,
        });
        if (ripplesRef.current.length > 40) {
          ripplesRef.current.splice(0, ripplesRef.current.length - 40);
        }
      }
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.radius += 2.4;
        r.alpha *= 0.97;
        if (r.alpha < 0.01) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${r.hue}, 95%, 70%, ${r.alpha})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
      aria-hidden
    >
      <div
        className="absolute bgfx-mesh-a"
        style={{
          inset: "-20%",
          background:
            "radial-gradient(circle at 20% 30%, rgba(168,85,247,1) 0%, rgba(168,85,247,0.3) 25%, transparent 55%)",
          filter: "blur(80px)",
          willChange: "transform",
        }}
      />
      <div
        className="absolute bgfx-mesh-b"
        style={{
          inset: "-20%",
          background:
            "radial-gradient(circle at 80% 70%, rgba(217,70,239,0.9) 0%, rgba(217,70,239,0.25) 25%, transparent 55%)",
          filter: "blur(80px)",
          willChange: "transform",
        }}
      />
      <div
        className="absolute bgfx-mesh-c"
        style={{
          inset: "-20%",
          background:
            "radial-gradient(circle at 60% 20%, rgba(59,130,246,0.8) 0%, rgba(59,130,246,0.2) 25%, transparent 55%)",
          filter: "blur(80px)",
          willChange: "transform",
        }}
      />
      <div
        ref={glowRef}
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: 600,
          height: 600,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(168,85,247,0.3) 0%, rgba(168,85,247,0) 60%)",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
