import { afterEach, describe, expect, it, vi } from "vitest"

import { importRestaurantFromWebsite } from "@/lib/website-import"

vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }))

const sourceUrl = "https://example-restaurant.test/"

function htmlResponse(html: string) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  }
}

function windows1254Response(html: string) {
  const turkishBytes: Record<string, number> = { Ç: 0xc7, ç: 0xe7, Ğ: 0xd0, ğ: 0xf0, İ: 0xdd, ı: 0xfd, Ö: 0xd6, ö: 0xf6, Ş: 0xde, ş: 0xfe, Ü: 0xdc, ü: 0xfc }
  const bytes = Uint8Array.from(Array.from(html).flatMap((character) => {
    const code = turkishBytes[character]
    return code === undefined ? Array.from(new TextEncoder().encode(character)) : [code]
  }))
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    arrayBuffer: async () => bytes.buffer,
  }
}

describe("website importer visible-content fallbacks", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("extracts contact details and hours when structured data is absent", async () => {
    const home = `
      <html lang="tr">
        <head>
          <title>Deniz Restaurant - Tomtom Suites Istanbul</title>
          <meta name="description" content="A seasonal restaurant by the sea." />
          <script type="application/ld+json">{ malformed json ld }</script>
        </head>
        <body>
          <h1>SPRING MENU SIGNATURE TASTES</h1>
          <p>Fresh Turkish ingredients and a relaxed dining room.</p>
          <a href="/contact">İletişim</a>
          <footer>
            <div>Şehit Muhtar Mahallesi İstiklal Caddesi Bekar Sokak No: 28, 34430 Beyoğlu / İstanbul</div>
            <p>Pazartesi-Cumartesi açıktır. Restaurant açılış 18:00 – kapanış 24:00.</p>
            <a href="tel:+90%20(212)%20293%205656">+90 (212) 293 5656</a>
            <a href="mailto:reservations@example-restaurant.test?subject=Reserve">reservations@example-restaurant.test</a>
            <a href="/menu">Menu</a>
            <a href="https://maps.google.com/?q=example">Location</a>
          </footer>
        </body>
      </html>
    `

    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(home)))

    const result = await importRestaurantFromWebsite(sourceUrl)

    expect(result.profile.name).toBe("Deniz Restaurant")
    expect(result.profile.hours).toBe("18:00–24:00")
    expect(result.profile.phone).toBe("+90 (212) 293 5656")
    expect(result.profile.business_contact_email).toBe("reservations@example-restaurant.test")
    expect(result.profile.menu_url).toBe("https://example-restaurant.test/menu")
    expect(result.profile.location_url).toContain("maps.google.com")
    expect(result.profile.location).toContain("34430")
    expect(result.missingFields).not.toContain("hours")
    expect(result.missingFields).not.toContain("phone")
    expect(result.missingFields).not.toContain("location")
  })

  it("carries structured address and coordinates into the profile draft", async () => {
    const home = `
      <html><head><title>Harbor House</title></head><body>
        <script type="application/ld+json">${JSON.stringify({
          "@type": "Restaurant",
          name: "Harbor House",
          url: sourceUrl,
          telephone: "+90 252 000 00 00",
          address: { "@type": "PostalAddress", streetAddress: "Marina Street 4", addressLocality: "Bodrum", addressRegion: "Muğla", postalCode: "48400", addressCountry: "TR" },
          geo: { "@type": "GeoCoordinates", latitude: 37.0344, longitude: 27.4305 },
        })}</script>
      </body></html>
    `

    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(home)))

    const result = await importRestaurantFromWebsite(sourceUrl)

    expect(result.profile.address_line1).toBe("Marina Street 4")
    expect(result.profile.address_locality).toBe("Bodrum")
    expect(result.profile.address_country).toBe("TR")
    expect(result.profile.latitude).toBe(37.0344)
    expect(result.profile.longitude).toBe(27.4305)
    expect(result.profile.official_website_url).toBe(sourceUrl)
  })

  it("recovers Turkish text from legacy bytes when the website omits charset", async () => {
    const home = `
      <html><head><title>Anadolu Mutfakları Laboratuvarı</title></head><body>
        <h1>Anadolu Mutfakları Laboratuvarı</h1>
        <p>Diğeri ise yöresel mutfak konusunda hizmet veren üç restorandan oluşan bir laboratuvar.</p>
      </body></html>
    `

    vi.stubGlobal("fetch", vi.fn(async () => windows1254Response(home)))

    const result = await importRestaurantFromWebsite(sourceUrl)

    expect(result.profile.name).toBe("Anadolu Mutfakları Laboratuvarı")
    expect(result.profile.description).toContain("Diğeri ise yöresel mutfak")
    expect(result.profile.description).not.toContain("�")
  })

  it("prefers readable page copy over malformed metadata and decodes Turkish entities", async () => {
    const home = `
      <html><head>
        <title>&Ccedil;iya Kebap Lahmacun</title>
        <meta name="description" content="&Ccedil;iya Kebap Lahmacun - Kadï¿½kï¿½y'de, diï¿½eri ise yï¿½resel mutfak konusunda hizmet veren bir laboratuvarï¿½" />
      </head><body>
        <p>Çiya Kebap Lahmacun, Kadıköy'de diğeri ise yöresel mutfak konusunda hizmet veren bir laboratuvarı.</p>
      </body></html>
    `

    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(home)))

    const result = await importRestaurantFromWebsite(sourceUrl)

    expect(result.profile.name).toBe("Çiya Kebap Lahmacun")
    expect(result.profile.description).toContain("Kadıköy'de diğeri ise yöresel mutfak")
    expect(result.profile.description).not.toContain("ï¿½")
  })
})
