"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

export type ZenVariant = "mug" | "beans" | "particles";

const COFFEE = {
  roast: 0x9a5a28,
  roastDark: 0x7a4118,
  liquid: 0x3b2310,
  cream: 0xd7b98a,
  glaze: 0xc98a4b,
  accent: 0xf0a860,
};

type SceneState = {
  group: THREE.Group;
  steam?: THREE.Mesh[];
  beans?: THREE.Group[];
  particles?: THREE.Points;
  tilt?: { target: THREE.Euler; ease: number; vy: number };
};

function buildScene(variant: ZenVariant, dark: boolean): SceneState {
  const group = new THREE.Group();
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const materials: THREE.Material[] = [];

  const std = (color: number, rough = 0.5, metal = 0.05) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    materials.push(m);
    return m;
  };

  if (variant === "mug") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.74, 1.05, 40), std(COFFEE.roast, 0.35, 0.12));
    body.position.y = 1.15;
    group.add(body);

    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 18, 30), std(COFFEE.glaze, 0.4, 0.1));
    handle.position.set(0.78, 1.3, 0);
    handle.rotation.z = Math.PI / 2;
    group.add(handle);

    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.6, 0.1, 40), std(COFFEE.cream, 0.5));
    saucer.position.y = 0.52;
    group.add(saucer);

    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.78, 36), std(COFFEE.liquid, 0.18, 0.9));
    coffee.position.y = 1.62;
    coffee.rotation.x = -Math.PI / 2;
    group.add(coffee);

    const steam = Array.from({ length: 5 }, () => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(rand(0.03, 0.05), 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
      );
      materials.push(m.material as THREE.MeshBasicMaterial);
      m.position.set(rand(-0.2, 0.2), 1.85, rand(-0.2, 0.2));
      group.add(m);
      return m;
    });

    return { group, steam, tilt: { target: new THREE.Euler(0, 0, 0), ease: 0.08, vy: 0.55 } };
  }

  if (variant === "beans") {
    const colors = [COFFEE.roast, COFFEE.roastDark, COFFEE.glaze, 0x6b4423];
    const beans: THREE.Group[] = [];
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group();
      const bean = new THREE.Mesh(
        new THREE.SphereGeometry(rand(0.3, 0.42), 24, 16),
        std(colors[i % colors.length], 0.55)
      );
      bean.scale.set(0.62, 1, 0.62);
      b.add(bean);
      b.position.set(rand(-1.4, 1.4), rand(-0.3, 1.3), rand(-0.6, 0.6));
      b.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));
      b.userData.spin = { x: rand(-0.5, 0.5), y: rand(-0.5, 0.5) };
      group.add(b);
      beans.push(b);
    }
    return { group, beans, tilt: { target: new THREE.Euler(0, 0, 0), ease: 0.06, vy: 0.3 } };
  }

  const count = 130;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = rand(-5, 5);
    positions[i * 3 + 1] = rand(-2.5, 2.5);
    positions[i * 3 + 2] = rand(-2.5, 2.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: dark ? 0xffb46b : 0xb5651d,
    size: 0.09,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  materials.push(mat);
  const points = new THREE.Points(geo, mat);
  points.position.y = 0;
  group.add(points);
  return { group, particles: points };
}

export default function ZenScene({
  variant = "beans",
  interactive = false,
  className,
}: {
  variant?: ZenVariant;
  interactive?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);

    let dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
    const observer = new MutationObserver(() => {
      dark = document.documentElement.classList.contains("dark");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.4, 5.4);
    camera.lookAt(0, 0.8, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(dark ? 0xffd9ab : 0xfff3e6, 0.6);
    rim.position.set(-3, 2, -3);
    scene.add(rim);

    const state = buildScene(variant, dark);
    scene.add(state.group);

    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);

    const fit = () => {
      const w = Math.min(el.clientWidth || 1, 640);
      const h = Math.min(el.clientHeight || 1, 640);
      renderer!.setSize(w, h, false);
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);

    el.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const clock = new THREE.Clock();
    let raf = 0;
    let tiltX = 0;
    let tiltY = 0;

    const onPointer = (e: PointerEvent) => {
      if (!state.tilt || reduced) return;
      const rect = el.getBoundingClientRect();
      tiltX = ((e.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2;
      tiltY = ((e.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2;
    };
    const onLeave = () => {
      tiltX = 0;
      tiltY = 0;
    };
    if (interactive && state.tilt) {
      window.addEventListener("pointermove", onPointer);
      window.addEventListener("pointerout", onLeave);
    }

    const visible = () => !document.hidden;
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      if (!document.hidden) {
        clock.getDelta();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const disposeObject = (o: THREE.Object3D) => {
      o.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else if (m) m.dispose();
      });
    };

    function tick() {
      if (visible()) {
        const t = clock.getElapsedTime();
        const dt = clock.getDelta();

        if (state.tilt) {
          if (reduced && !interactive) {
            state.tilt.vy = 0;
          }
          if (!reduced || !state.tilt.vy) {
            state.group.rotation.y += (state.tilt.vy || 0) * dt;
          }
          state.tilt.target.set(
            state.tilt.ease * tiltY * 0.35,
            state.tilt.target.y,
            state.tilt.ease * tiltX * 0.35
          );
          state.group.rotation.x += (state.tilt.target.x - state.group.rotation.x) * state.tilt.ease;
          state.group.rotation.z += (state.tilt.target.z - state.group.rotation.z) * state.tilt.ease;
        }

        if (state.steam) {
          state.steam.forEach((s, i) => {
            const phase = (t * 0.9 + i * 1.7) % 1;
            s.position.y = 1.95 + phase * 1.4;
            s.position.x = Math.sin(t * 1.4 + i) * 0.22;
            s.position.z = Math.cos(t * 1.2 + i) * 0.15;
            const mat = s.material as THREE.MeshBasicMaterial;
            mat.opacity = 0.35 * Math.sin(phase * Math.PI);
            s.scale.setScalar(1 + phase * 0.5);
          });
        }

        if (state.beans) {
          state.beans.forEach((b) => {
            b.rotation.x += (b.userData.spin?.x || 0) * dt;
            b.rotation.y += (b.userData.spin?.y || 0) * dt;
          });
          state.group.position.y = Math.sin(t * 0.8) * 0.06;
        }

        if (state.particles) {
          const pos = state.particles.geometry.attributes.position as THREE.BufferAttribute;
          const arr = pos.array as Float32Array;
          for (let i = 0; i < arr.length; i += 3) {
            arr[i + 1] += dt * 0.12;
            if (arr[i + 1] > 2.6) arr[i + 1] = -2.6;
          }
          pos.needsUpdate = true;
        }

        state.group.rotation.y = state.tilt ? state.group.rotation.y : state.group.rotation.y + dt * 0.3;

        renderer!.render(scene, camera);
      }
      raf = requestAnimationFrame(tick);
    }

    if (reduced) {
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (state.tilt) {
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("pointerout", onLeave);
      }
      disposeObject(scene);
      renderer!.dispose();
      if (canvas.parentNode === el) el.removeChild(canvas);
    };
  }, [variant, interactive]);

  return <div ref={ref} aria-hidden="true" className={cn("pointer-events-none overflow-hidden", className)} />;
}