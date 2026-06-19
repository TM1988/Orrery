import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { SUN, PLANETS } from "./planets.js"
import "./style.css"

/* ================================================================
   Renderer, scene, camera
   ================================================================ */
const canvas = document.getElementById("scene")

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  2000,
)
camera.position.set(0, 45, 95)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.minDistance = 10
controls.maxDistance = 400

/* ================================================================
   Resize handler
   ================================================================ */
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

/* ================================================================
   Texture loader + loading manager (drives the overlay)
   ================================================================ */
const loaderEl = document.getElementById("loader")
let loaderHidden = false

function hideLoader() {
  if (loaderHidden) return
  loaderHidden = true
  loaderEl.classList.add("is-hidden")
}

const manager = new THREE.LoadingManager()
manager.onLoad = hideLoader
manager.onError = (url) => console.warn("texture failed:", url)

// Safety net — never trap the user on the loading screen
setTimeout(hideLoader, 6000)

const texLoader = new THREE.TextureLoader(manager)

function loadTex(url) {
  const t = texLoader.load(url)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/* ================================================================
   Lighting
   ================================================================ */
// Soft fill so the dark side of planets isn't pure black
scene.add(new THREE.AmbientLight(0xffffff, 0.18))

// Key light coming from the Sun position
const sunLight = new THREE.PointLight(0xfff2d6, 3.2, 0, 0.6)
scene.add(sunLight)

/* ================================================================
   Starfield — texture mapped to the inside of a huge sphere
   ================================================================ */
{
  const geo = new THREE.SphereGeometry(900, 64, 64)
  const mat = new THREE.MeshBasicMaterial({
    map: loadTex("/textures/stars.png"),
    side: THREE.BackSide,
  })
  scene.add(new THREE.Mesh(geo, mat))
}

/* ================================================================
   Helper: procedural Sun glow texture
   ================================================================ */
function makeGlowTexture() {
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const ctx = c.getContext("2d")
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, "rgba(255,228,168,0.9)")
  g.addColorStop(0.25, "rgba(255,176,74,0.5)")
  g.addColorStop(1, "rgba(255,140,40,0)")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ================================================================
   Helper: procedural ring banding texture
   ================================================================ */
function makeRingTexture() {
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 8
  const ctx = c.getContext("2d")
  for (let x = 0; x < 256; x++) {
    const a = 0.35 + 0.5 * Math.abs(Math.sin(x * 0.18)) * (x / 256)
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
    ctx.fillRect(x, 0, 1, 8)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ================================================================
   Sun mesh + glow sprite
   ================================================================ */
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(SUN.radius, 64, 64),
  new THREE.MeshBasicMaterial({ map: loadTex(SUN.texture) }),
)
sunMesh.userData.body = SUN
scene.add(sunMesh)

const glow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xffb04a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
)
glow.scale.set(SUN.radius * 6, SUN.radius * 6, 1)
sunMesh.add(glow)

/* ================================================================
   Build planets, rings, moons, orbit lines
   ================================================================ */
const selectable = [sunMesh] // meshes the raycaster can hit
const planetGroups = []      // { pivot, mesh, data, moons, angle }
const orbitLines = []        // orbit ring meshes (for toggle)

const ringTex = makeRingTexture()

for (const data of PLANETS) {
  // Pivot at origin — rotating it moves the planet around the Sun
  const pivot = new THREE.Object3D()
  scene.add(pivot)

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(data.radius, 48, 48),
    new THREE.MeshStandardMaterial({
      map: loadTex(data.texture),
      roughness: 1,
      metalness: 0,
    }),
  )
  mesh.position.x = data.distance
  mesh.rotation.z = data.tilt
  mesh.userData.body = data
  pivot.add(mesh)
  selectable.push(mesh)

  // Ring system (Saturn / Uranus)
  if (data.ring) {
    const ringGeo = new THREE.RingGeometry(data.ring.inner, data.ring.outer, 96)

    // Remap UVs so the texture runs radially across the ring width
    const pos = ringGeo.attributes.position
    const uv = ringGeo.attributes.uv
    const mid = (data.ring.inner + data.ring.outer) / 2
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      uv.setXY(i, v.length() < mid ? 0 : 1, 1)
    }

    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        map: ringTex,
        color: data.ring.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      }),
    )
    ring.rotation.x = Math.PI / 2 - 0.2
    mesh.add(ring)
  }

  // Moons
  const moons = []
  if (data.moons) {
    for (const m of data.moons) {
      const moonPivot = new THREE.Object3D()
      mesh.add(moonPivot)

      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(m.radius, 24, 24),
        new THREE.MeshStandardMaterial({ color: m.color, roughness: 1 }),
      )
      moon.position.x = m.distance
      moonPivot.add(moon)
      moons.push({ pivot: moonPivot, speed: m.speed })
    }
  }

  // Orbital path — a flat ring lying on the XZ plane
  const orbitGeo = new THREE.RingGeometry(
    data.distance - 0.03,
    data.distance + 0.03,
    128,
  )
  const orbit = new THREE.Mesh(
    orbitGeo,
    new THREE.MeshBasicMaterial({
      color: 0x4a6bb0,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    }),
  )
  orbit.rotation.x = Math.PI / 2
  scene.add(orbit)
  orbitLines.push(orbit)

  planetGroups.push({
    pivot,
    mesh,
    data,
    moons,
    angle: Math.random() * Math.PI * 2, // randomise starting position
  })
}

/* ================================================================
   Raycasting — click to select, hover cursor
   ================================================================ */
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function updatePointer(e) {
  const src = e.touches ? e.touches[0] : e
  pointer.x = (src.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(src.clientY / window.innerHeight) * 2 + 1
}

// Hover: change cursor
window.addEventListener("pointermove", (e) => {
  updatePointer(e)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects(selectable, false)[0]
  canvas.style.cursor = hit ? "pointer" : "grab"
})

// Click: only register if pointer didn't move much (not a drag)
let downPos = null
canvas.addEventListener("pointerdown", (e) => {
  downPos = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener("pointerup", (e) => {
  if (!downPos) return
  const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
  downPos = null
  if (dist > 6) return // was a drag

  updatePointer(e)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects(selectable, false)[0]
  if (hit) selectBody(hit.object)
})

/* ================================================================
   Info panel + camera focus
   ================================================================ */
const infoEl = document.getElementById("info")
const focusLabel = document.getElementById("focus-label")
let focusTarget = null // mesh the camera lerps toward

function selectBody(mesh) {
  const body = mesh.userData.body
  if (!body) return
  focusTarget = mesh
  focusLabel.textContent = `Following ${body.name}`
  showInfo(body)
}

function showInfo(body) {
  document.getElementById("info-name").textContent = body.name
  document.getElementById("info-tag").textContent = body.tag
  document.getElementById("info-desc").textContent = body.desc

  const dl = document.getElementById("info-stats")
  dl.innerHTML = ""
  for (const [key, val] of Object.entries(body.stats)) {
    const div = document.createElement("div")
    div.innerHTML = `<dt>${key}</dt><dd>${val}</dd>`
    dl.appendChild(div)
  }

  infoEl.hidden = false
}

document.getElementById("info-close").addEventListener("click", () => {
  infoEl.hidden = true
  focusTarget = null
  focusLabel.textContent = "Free camera"
})

/* ================================================================
   UI controls
   ================================================================ */
let speedFactor = 1
let motionOn = true

document.getElementById("speed").addEventListener("input", (e) => {
  speedFactor = parseFloat(e.target.value)
})

const orbitsBtn = document.getElementById("toggle-orbits")
orbitsBtn.addEventListener("click", () => {
  const isOn = orbitsBtn.getAttribute("aria-pressed") === "true"
  orbitsBtn.setAttribute("aria-pressed", String(!isOn))
  orbitsBtn.textContent = `Orbit lines: ${!isOn ? "On" : "Off"}`
  orbitLines.forEach((o) => (o.visible = !isOn))
})

const motionBtn = document.getElementById("toggle-spin")
motionBtn.addEventListener("click", () => {
  motionOn = !motionOn
  motionBtn.setAttribute("aria-pressed", String(motionOn))
  motionBtn.textContent = `Motion: ${motionOn ? "On" : "Off"}`
})

// Keyboard shortcuts — 0 = Sun, 1-8 = planets, Esc = deselect
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    infoEl.hidden = true
    focusTarget = null
    focusLabel.textContent = "Free camera"
    return
  }
  const n = parseInt(e.key, 10)
  if (Number.isNaN(n)) return
  if (n === 0) selectBody(sunMesh)
  else if (planetGroups[n - 1]) selectBody(planetGroups[n - 1].mesh)
})

/* ================================================================
   Animation loop
   ================================================================ */
const clock = new THREE.Clock()
const worldPos = new THREE.Vector3()
const desiredCam = new THREE.Vector3()

function animate() {
  requestAnimationFrame(animate)
  const dt = clock.getDelta()

  if (motionOn) {
    sunMesh.rotation.y += 0.0015 * speedFactor * 60 * dt

    for (const p of planetGroups) {
      // Advance orbit angle and rotate pivot so the planet moves
      p.angle += p.data.orbitSpeed * 0.12 * speedFactor * dt
      p.pivot.rotation.y = p.angle

      // Self-rotation (axial spin)
      p.mesh.rotation.y += p.data.spinSpeed * speedFactor * 60 * dt

      // Moon orbits
      for (const moon of p.moons) {
        moon.pivot.rotation.y += moon.speed * speedFactor * dt
      }
    }
  }

  // Smoothly follow the selected body
  if (focusTarget) {
    focusTarget.getWorldPosition(worldPos)
    controls.target.lerp(worldPos, 0.08)

    const r = focusTarget.userData.body?.radius ?? 4
    desiredCam
      .copy(worldPos)
      .add(new THREE.Vector3(r * 4 + 6, r * 2.5 + 4, r * 4 + 6))
    camera.position.lerp(desiredCam, 0.04)
  }

  controls.update()
  renderer.render(scene, camera)
}

animate()
