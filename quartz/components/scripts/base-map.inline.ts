const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@5.8.0/dist/maplibre-gl.css"
const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@5.8.0/dist/maplibre-gl.js"

interface MapMarker {
  lat: number
  lon: number
  title: string
  slug: string
  icon?: string
  color?: string
  popupFields: Record<string, unknown>
}

interface MapConfig {
  defaultZoom: number
  defaultCenter?: [number, number]
  clustering: boolean
}

function loadCSS(href: string): Promise<void> {
  if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve()
  return new Promise((resolve) => {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    link.onload = () => resolve()
    document.head.appendChild(link)
  })
}

function loadScript(src: string): Promise<void> {
  if ((window as any).maplibregl) return Promise.resolve()
  if (document.querySelector(`script[src="${src}"]`)) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if ((window as any).maplibregl) {
          clearInterval(check)
          resolve()
        }
      }, 50)
    })
  }
  return new Promise((resolve) => {
    const script = document.createElement("script")
    script.src = src
    script.onload = () => resolve()
    document.head.appendChild(script)
  })
}

function getComputedColor(color: string): string {
  if (color.startsWith("var(")) {
    const temp = document.createElement("div")
    temp.style.color = color
    document.body.appendChild(temp)
    const computed = getComputedStyle(temp).color
    document.body.removeChild(temp)
    return computed
  }
  return color
}

function createMarkerElement(color?: string): HTMLDivElement {
  const el = document.createElement("div")
  el.className = "base-map-marker"
  const resolvedColor = color ? getComputedColor(color) : "var(--secondary)"
  el.style.cssText = `
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: ${resolvedColor};
    border: 2px solid rgba(255,255,255,0.8);
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  `
  return el
}

function buildPopupHTML(marker: MapMarker, _currentSlug: string): string {
  const parts: string[] = []
  const href = `/${marker.slug}`
  parts.push(`<a class="base-map-popup-title" href="${href}">${escapeHtml(marker.title)}</a>`)

  for (const [key, value] of Object.entries(marker.popupFields)) {
    if (value == null) continue
    const label = key.replace(/^(note\.|formula\.)/, "")
    parts.push(
      `<div class="base-map-popup-field"><span class="base-map-popup-label">${escapeHtml(label)}:</span> ${escapeHtml(String(value))}</div>`,
    )
  }

  return `<div class="base-map-popup">${parts.join("")}</div>`
}

function escapeHtml(str: string): string {
  const div = document.createElement("div")
  div.textContent = str
  return div.innerHTML
}

async function initMaps() {
  const containers = document.querySelectorAll<HTMLDivElement>(".base-map")
  if (containers.length === 0) return

  await Promise.all([loadCSS(MAPLIBRE_CSS), loadScript(MAPLIBRE_JS)])

  const maplibregl = (window as any).maplibregl

  containers.forEach((container) => {
    if (container.dataset.initialized === "true") return
    container.dataset.initialized = "true"

    const markers: MapMarker[] = JSON.parse(container.dataset.markers || "[]")
    const config: MapConfig = JSON.parse(container.dataset.config || "{}")
    const currentSlug = container.dataset.currentSlug || ""

    if (markers.length === 0) {
      container.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--darkgray);font-size:0.875rem;">No markers to display</div>'
      return
    }

    const isDark = document.documentElement.getAttribute("saved-theme") === "dark"
    const styleUrl = isDark
      ? "https://tiles.openfreemap.org/styles/dark"
      : "https://tiles.openfreemap.org/styles/bright"

    let center: [number, number]
    if (config.defaultCenter) {
      center = [config.defaultCenter[1], config.defaultCenter[0]]
    } else {
      const avgLon = markers.reduce((s, m) => s + m.lon, 0) / markers.length
      const avgLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length
      center = [avgLon, avgLat]
    }

    container.style.height = "500px"
    container.style.minHeight = "300px"

    const map = new maplibregl.Map({
      container,
      style: styleUrl,
      center,
      zoom: config.defaultZoom ?? 2,
    })

    map.addControl(new maplibregl.NavigationControl(), "top-right")

    map.on("load", () => {
      const popup = new maplibregl.Popup({
        offset: 25,
        closeButton: false,
        maxWidth: "300px",
      })

      for (const marker of markers) {
        const el = createMarkerElement(marker.color)

        el.addEventListener("mouseenter", () => {
          popup.setLngLat([marker.lon, marker.lat])
            .setHTML(buildPopupHTML(marker, currentSlug))
            .addTo(map)
        })

        el.addEventListener("mouseleave", () => {
          setTimeout(() => {
            const popupEl = popup.getElement()
            if (popupEl && !popupEl.matches(":hover")) {
              popup.remove()
            }
          }, 150)
        })

        el.addEventListener("click", () => {
          window.location.href = `/${marker.slug}`
        })

        new maplibregl.Marker({ element: el })
          .setLngLat([marker.lon, marker.lat])
          .addTo(map)
      }

      popup.on("close", () => {})
      document.addEventListener("mouseover", (e: MouseEvent) => {
        const popupEl = popup.getElement()
        if (!popupEl) return
        const target = e.target as HTMLElement
        if (!popupEl.contains(target) && !target.closest(".base-map-marker")) {
          popup.remove()
        }
      })

      if (markers.length > 1) {
        const bounds = new maplibregl.LngLatBounds()
        markers.forEach((m) => bounds.extend([m.lon, m.lat]))
        map.fitBounds(bounds, { padding: 50, maxZoom: 12 })
      }
    })

    window.addCleanup(() => {
      map.remove()
      container.removeAttribute("data-initialized")
    })
  })
}

document.addEventListener("nav", () => {
  initMaps()

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.querySelector(".base-map")) {
            initMaps()
            return
          }
        }
      }
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  window.addCleanup(() => observer.disconnect())
})
