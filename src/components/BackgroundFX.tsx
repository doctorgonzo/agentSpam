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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const lastSpawnRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
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
      ctx.scale(dpr, dpr);
    }

    function onMove(e: MouseEvent) {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      if (wrapper) {
        wrapper.style.setProperty("--mx", `${e.clientX}px`);
        wrapper.style.setProperty("--my", `${e.clientY}px`);
      }
      const now = performance.now();
      // Throttle ripple spawn to ~every 60ms so fast moves don't flood
      if (now - lastSpawnRef.current > 60) {
        lastSpawnRef.current = now;
        ripplesRef.current.push({
          x: e.clientX,
          y: e.clientY,
          radius: 4,
          alpha: 0.55,
          hue: 270 + Math.random() * 60, // purple → fuchsia
        });
        // Cap total ripples for perf
        if (ripplesRef.current.length > 40) {
          ripplesRef.current.splice(0, ripplesRef.current.length - 40);
        }
      }
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

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
        ctx.strokeStyle = `hsla(${r.hue}, 90%, 65%, ${r.alpha})`;
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
      ref={wrapperRef}
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
      aria-hidden
    >
      {/* Slow-drifting mesh gradient */}
      <div className="absolute inset-0 bg-zinc-950" />
      <div className="absolute inset-0 mesh-a" />
      <div className="absolute inset-0 mesh-b" />
      <div className="absolute inset-0 mesh-c" />
      {/* Mouse-follow glow */}
      <div
        className="absolute pointer-events-none transition-opacity duration-300"
        style={{
          left: "var(--mx, 50%)",
          top: "var(--my, 50%)",
          width: 600,
          height: 600,
          transform: "translate(-50%, -50%)",
          background:
            "radial-gradient(circle, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0) 60%)",
        }}
      />
      {/* Ripple canvas */}
      <canvas ref={canvasRef} className="absolute inset-0" />

      <style jsx>{`
        .mesh-a,
        .mesh-b,
        .mesh-c {
          filter: blur(60px);
          opacity: 0.55;
        }
        .mesh-a {
          background: radial-gradient(
            circle at 20% 30%,
            rgba(168, 85, 247, 0.45) 0%,
            transparent 40%
          );
          animation: drift-a 22s ease-in-out infinite;
        }
        .mesh-b {
          background: radial-gradient(
            circle at 80% 70%,
            rgba(217, 70, 239, 0.35) 0%,
            transparent 40%
          );
          animation: drift-b 28s ease-in-out infinite;
        }
        .mesh-c {
          background: radial-gradient(
            circle at 60% 20%,
            rgba(59, 130, 246, 0.28) 0%,
            transparent 40%
          );
          animation: drift-c 34s ease-in-out infinite;
        }
        @keyframes drift-a {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(15vw, 10vh) scale(1.15);
          }
        }
        @keyframes drift-b {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(-12vw, -8vh) scale(1.1);
          }
        }
        @keyframes drift-c {
          0%,
          100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(-8vw, 12vh) scale(1.2);
          }
        }
      `}</style>
    </div>
  );
}
