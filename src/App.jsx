import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_KEY   = import.meta.env.VITE_GOOGLE_KEY;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const supabase     = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Helpers ────────────────────────────────────────────────
function categoryInfo(types = []) {
  const t = types.join(" ").toLowerCase();
  if (t.includes("night_club")) return { emoji: "🎧", type: "Club" };
  if (t.includes("bar"))        return { emoji: "🍹", type: "Bar" };
  if (t.includes("pub"))        return { emoji: "🍺", type: "Pub" };
  if (t.includes("restaurant")) return { emoji: "🍽️", type: "Ristorante" };
  if (t.includes("cafe"))       return { emoji: "☕", type: "Caffè" };
  if (t.includes("casino"))     return { emoji: "🎰", type: "Casino" };
  if (t.includes("lounge"))     return { emoji: "🍸", type: "Lounge" };
  return { emoji: "🏠", type: "Locale" };
}

function crowdColor(v) {
  if (v >= 80) return "#FF4757";
  if (v >= 60) return "#FFA502";
  return "#7BED9F";
}

function timeAgo(ts) {
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60)    return "adesso";
  if (s < 3600)  return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
  return `${Math.floor(s / 86400)}g fa`;
}

function formatDist(m) {
  if (!m && m !== 0) return "";
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fakeMetrics(id) {
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    crowd:    30 + (seed % 65),
    vibe:     40 + ((seed * 3) % 55),
    checkins: 10 + (seed % 120),
    trending: (30 + (seed % 65)) > 72,
  };
}

const ACOLORS = ["#FF6B9D","#FFB347","#87CEEB","#98FF98","#A78BFA","#FB923C","#F472B6"];
function avatarColor(id = "") {
  return ACOLORS[id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % ACOLORS.length];
}

// ─── UI Atoms ───────────────────────────────────────────────
function CrowdBar({ value, color }) {
  const filled = Math.round((value / 100) * 5);
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          width: 10, height: 22, borderRadius: 3,
          background: i < filled ? color : "rgba(255,255,255,0.08)",
          boxShadow: i < filled ? `0 0 6px ${color}66` : "none",
        }} />
      ))}
    </div>
  );
}

function CrowdLabel({ value }) {
  if (value >= 85) return <span style={{ color: "#FF4757", fontWeight: 700, fontSize: 11 }}>SOLD OUT 🔥</span>;
  if (value >= 70) return <span style={{ color: "#FF6348", fontWeight: 700, fontSize: 11 }}>AFFOLLATO</span>;
  if (value >= 50) return <span style={{ color: "#FFA502", fontWeight: 700, fontSize: 11 }}>ANIMATO</span>;
  return <span style={{ color: "#7BED9F", fontWeight: 700, fontSize: 11 }}>TRANQUILLO</span>;
}

function VibeScore({ value }) {
  const emoji = value >= 90 ? "🤯" : value >= 75 ? "🔥" : value >= 55 ? "😎" : "😐";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 16 }}>{emoji}</span>
      <span style={{ color: "#fff", fontWeight: 800, fontSize: 15 }}>{value}</span>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>/100</span>
    </div>
  );
}

function Avatar({ profile, size = 42 }) {
  const letter = (profile?.full_name || profile?.username || "?")[0].toUpperCase();
  const color  = avatarColor(profile?.id || "");
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: size * 0.38, color: "#0A0A0F",
    }}>{letter}</div>
  );
}

function Skeleton() {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: "16px 18px", display: "flex", gap: 12 }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ height: 16, borderRadius: 6, background: "rgba(255,255,255,0.07)", width: "60%" }} />
        <div style={{ height: 11, borderRadius: 6, background: "rgba(255,255,255,0.05)", width: "40%" }} />
        <div style={{ height: 22, borderRadius: 6, background: "rgba(255,255,255,0.05)", width: "80%" }} />
      </div>
    </div>
  );
}

// ─── Mapbox ─────────────────────────────────────────────────
function MapboxMap({ venues, userLocation, onVenueClick }) {
  const mapRef     = useRef(null);
  const mapInst    = useRef(null);
  const markersRef = useRef([]);
  const [ready, setReady] = useState(false);
  const [err,   setErr]   = useState(false);

  useEffect(() => {
    if (window.mapboxgl) { setReady(true); return; }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css";
    const script = document.createElement("script");
    script.src = "https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js";
    script.onload = () => setReady(true);
    script.onerror = () => setErr(true);
    document.head.append(link, script);
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !userLocation || mapInst.current) return;
    try {
      window.mapboxgl.accessToken = MAPBOX_TOKEN;
      mapInst.current = new window.mapboxgl.Map({
        container: mapRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [userLocation.lng, userLocation.lat],
        zoom: 14, attributionControl: false,
      });
      const dot = document.createElement("div");
      dot.style.cssText = "width:18px;height:18px;border-radius:50%;background:#A78BFA;border:3px solid white;box-shadow:0 0 0 4px rgba(167,139,250,0.3);";
      new window.mapboxgl.Marker({ element: dot }).setLngLat([userLocation.lng, userLocation.lat]).addTo(mapInst.current);
    } catch { setErr(true); }
  }, [ready, userLocation]);

  useEffect(() => {
    if (!mapInst.current || !ready) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    venues.forEach(v => {
      if (!v.lat || !v.lng) return;
      const color = crowdColor(v.crowd);
      const el = document.createElement("div");
      el.style.cssText = `width:40px;height:40px;border-radius:50%;background:${color}22;border:2px solid ${color};display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;box-shadow:0 0 14px ${color}55;transition:transform 0.15s;`;
      el.innerHTML = v.emoji;
      el.onmouseenter = () => el.style.transform = "scale(1.2)";
      el.onmouseleave = () => el.style.transform = "scale(1)";
      el.onclick = () => onVenueClick(v);
      const popup = new window.mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(`
        <div style="background:#1A1A2E;color:#fff;padding:10px 14px;border-radius:12px;font-family:sans-serif;border:1px solid rgba(255,255,255,0.1);min-width:140px;">
          <div style="font-weight:800;font-size:14px;">${v.emoji} ${v.name}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5);margin:2px 0 6px;">${v.zone} · ${v.type}</div>
          <div style="font-size:12px;color:${color};font-weight:700;">${v.crowd >= 85 ? "SOLD OUT 🔥" : v.crowd >= 70 ? "AFFOLLATO" : v.crowd >= 50 ? "ANIMATO" : "TRANQUILLO"}</div>
        </div>`);
      const marker = new window.mapboxgl.Marker({ element: el }).setLngLat([v.lng, v.lat]).setPopup(popup).addTo(mapInst.current);
      markersRef.current.push(marker);
    });
  }, [venues, ready, onVenueClick]);

  if (err) return (
    <div style={{ height: 300, borderRadius: 20, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 32 }}>🗺️</div>
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Mappa non disponibile</div>
    </div>
  );

  return (
    <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", height: 300 }}>
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      {!ready && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,15,0.9)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 32 }}>🗺️</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Caricamento mappa...</div>
        </div>
      )}
    </div>
  );
}

// ─── Auth ────────────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  const handleSubmit = async () => {
    setLoading(true); setError(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { username, full_name: username } } });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const inp = {
    width: "100%", background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14,
    padding: "14px 16px", color: "#fff", fontSize: 15,
    boxSizing: "border-box", fontFamily: "inherit", outline: "none", marginBottom: 12,
  };

  return (
    <div style={{ background: "#0A0A0F", minHeight: "100vh", maxWidth: 430, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 28px", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#fff" }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
      <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.5px", background: "linear-gradient(135deg,#A78BFA,#F472B6,#FB923C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 4 }}>CROWD ME</div>
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 40, textAlign: "center" }}>Scopri dove si sta meglio stanotte 🌙</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 24, background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 4, width: "100%" }}>
        {["login","signup"].map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, background: mode === m ? "rgba(167,139,250,0.3)" : "transparent", color: mode === m ? "#A78BFA" : "rgba(255,255,255,0.4)" }}>
            {m === "login" ? "Accedi" : "Registrati"}
          </button>
        ))}
      </div>
      {mode === "signup" && <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" style={inp} />}
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" style={inp} />
      <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" type="password" style={inp} />
      {error && <div style={{ color: "#FF4757", fontSize: 13, marginBottom: 12, textAlign: "center" }}>{error}</div>}
      <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: "16px", background: "linear-gradient(135deg,#7C3AED,#F472B6)", border: "none", borderRadius: 16, cursor: "pointer", color: "#fff", fontWeight: 800, fontSize: 16, boxShadow: "0 4px 20px rgba(124,58,237,0.4)", opacity: loading ? 0.7 : 1 }}>
        {loading ? "Caricamento..." : mode === "login" ? "Entra 🚀" : "Crea account 🎉"}
      </button>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────
export default function CrowdMe() {
  const [session, setSession]           = useState(null);
  const [profile, setProfile]           = useState(null);
  const [tab, setTab]                   = useState("discover");
  const [venues, setVenues]             = useState([]);
  const [loadingVenues, setLoadingVenues] = useState(true);
  const [venueError, setVenueError]     = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [cityName, setCityName]         = useState("Caricamento...");
  const [checkedIn, setCheckedIn]       = useState(null);
  const [feed, setFeed]                 = useState([]);
  const [loadingFeed, setLoadingFeed]   = useState(false);
  const [likedPosts, setLikedPosts]     = useState({});
  const [showCheckin, setShowCheckin]   = useState(false);
  const [checkinVenue, setCheckinVenue] = useState(null);
  const [crowdSlider, setCrowdSlider]   = useState(70);
  const [vibeSlider, setVibeSlider]     = useState(75);
  const [checkinMsg, setCheckinMsg]     = useState("");
  const [checkinDone, setCheckinDone]   = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [filterType, setFilterType]     = useState("Tutti");
  const [searchRadius, setSearchRadius] = useState(1000);
  const [notifPulse, setNotifPulse]     = useState(true);
  const [following, setFollowing]       = useState([]);
  const [followers, setFollowers]       = useState([]);

  // Auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from("profiles").select("*").eq("id", session.user.id).single().then(({ data }) => setProfile(data));
  }, [session]);

  // Geolocation
  useEffect(() => {
    if (!session) return;
    if (!navigator.geolocation) { setUserLocation({ lat: 45.4642, lng: 9.1900 }); setCityName("Milano (default)"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => { setUserLocation({ lat: 45.4642, lng: 9.1900 }); setCityName("Milano (default)"); },
      { timeout: 8000 }
    );
  }, [session]);

  // Google Places API (New) - supporta CORS nativamente
  const fetchVenues = useCallback(async (lat, lng, radius) => {
    setLoadingVenues(true); setVenueError(null);
    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.types,places.formattedAddress,places.location,places.shortFormattedAddress",
        },
        body: JSON.stringify({
          includedTypes: ["bar", "night_club", "cafe"],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: parseFloat(radius)
            }
          }
        })
      });

      if (!res.ok) throw new Error(`Errore ${res.status}`);
      const data = await res.json();

      if (!data.places?.length) {
        setVenueError("Nessun locale trovato. Prova ad allargare il raggio.");
        setVenues([]); setLoadingVenues(false); return;
      }

      // Città
      if (data.places[0]?.formattedAddress) {
        const parts = data.places[0].formattedAddress.split(",");
        setCityName(parts[parts.length - 2]?.trim() || "Milano");
      }

      const mapped = data.places.map(place => {
        const { emoji, type } = categoryInfo(place.types || []);
        const metrics = fakeMetrics(place.id);
        const placeLat = place.location?.latitude;
        const placeLng = place.location?.longitude;
        const dist = (placeLat && placeLng) ? getDistance(lat, lng, placeLat, placeLng) : null;
        const short = place.shortFormattedAddress || "";
        const vicinity = place.formattedAddress || short;
        const zone = short.split(",")[0] || vicinity.split(",")[0] || "—";

        return {
          id: place.id,
          name: place.displayName?.text || "Locale",
          type, emoji,
          zone,
          address: vicinity,
          distance: dist,
          lat: placeLat,
          lng: placeLng,
          tags: (place.types || []).slice(0, 3).map(t => t.replace(/_/g, " ")),
          ...metrics,
        };
      });

      setVenues(mapped);

      // Salva su Supabase
      const rows = mapped.map(v => ({ id: v.id, name: v.name, type: v.type, emoji: v.emoji, address: v.address, zone: v.zone, lat: v.lat, lng: v.lng, tags: v.tags }));
      supabase.from("venues").upsert(rows, { onConflict: "id" });

    } catch (e) {
      console.error(e);
      setVenueError("Impossibile caricare i locali: " + e.message);
    } finally {
      setLoadingVenues(false);
    }
  }, []);

  useEffect(() => {
    if (userLocation) fetchVenues(userLocation.lat, userLocation.lng, searchRadius);
  }, [userLocation, searchRadius, fetchVenues]);

  // Feed
  const fetchFeed = useCallback(async () => {
    if (!session) return;
    setLoadingFeed(true);
    const { data } = await supabase.from("friend_feed").select("*").order("created_at", { ascending: false }).limit(30);
    if (data) setFeed(data);
    setLoadingFeed(false);
  }, [session]);

  useEffect(() => { if (tab === "feed") fetchFeed(); }, [tab, fetchFeed]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel("checkins-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins" }, () => fetchFeed())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, fetchFeed]);

  // Followers
  useEffect(() => {
    if (!session) return;
    supabase.from("follows").select("following_id").eq("follower_id", session.user.id).then(({ data }) => setFollowing((data || []).map(r => r.following_id)));
    supabase.from("follows").select("follower_id").eq("following_id", session.user.id).then(({ data }) => setFollowers((data || []).map(r => r.follower_id)));
  }, [session]);

  // Like
  const toggleLike = async (checkinId) => {
    if (!session) return;
    const liked = likedPosts[checkinId];
    setLikedPosts(p => ({ ...p, [checkinId]: !liked }));
    if (liked) await supabase.from("checkin_likes").delete().eq("user_id", session.user.id).eq("checkin_id", checkinId);
    else await supabase.from("checkin_likes").insert({ user_id: session.user.id, checkin_id: checkinId });
  };

  // Check-in
  const openCheckin = (venue) => {
    setCheckinVenue(venue); setShowCheckin(true);
    setCrowdSlider(venue.crowd); setVibeSlider(venue.vibe); setCheckinMsg("");
  };

  const submitCheckin = async () => {
    if (!session || !checkinVenue) return;
    setCheckinLoading(true);
    const { error } = await supabase.from("checkins").insert({
      user_id: session.user.id, venue_id: checkinVenue.id,
      crowd: crowdSlider, vibe: vibeSlider, message: checkinMsg || null,
    });
    if (!error) { setCheckedIn(checkinVenue.id); setCheckinDone(true); setTimeout(() => { setShowCheckin(false); setCheckinDone(false); }, 2200); }
    setCheckinLoading(false);
  };

  const types    = ["Tutti", ...Array.from(new Set(venues.map(v => v.type)))];
  const filtered = venues.filter(v => filterType === "Tutti" || v.type === filterType).sort((a, b) => b.crowd - a.crowd);

  if (!session) return <AuthScreen />;

  return (
    <div style={{ background: "#0A0A0F", minHeight: "100vh", maxWidth: 430, margin: "0 auto", fontFamily: "'DM Sans','Segoe UI',sans-serif", position: "relative", overflowX: "hidden", color: "#fff" }}>
      <div style={{ position: "fixed", top: -80, left: "50%", transform: "translateX(-50%)", width: 300, height: 200, background: "radial-gradient(ellipse,#7C3AED44 0%,transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, padding: "16px 20px 12px", background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.5px", background: "linear-gradient(135deg,#A78BFA,#F472B6,#FB923C)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>CROWD ME</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: -2 }}>📍 {cityName}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={{ position: "relative", background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 12, width: 40, height: 40, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }} onClick={() => setNotifPulse(false)}>
              🔔
              {notifPulse && <div style={{ position: "absolute", top: 8, right: 9, width: 8, height: 8, background: "#F472B6", borderRadius: "50%", animation: "pulse 1.5s infinite" }} />}
            </button>
            <div onClick={() => setTab("profile")} style={{ cursor: "pointer" }}><Avatar profile={profile} size={40} /></div>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 0 100px" }}>

        {/* DISCOVER */}
        {tab === "discover" && (
          <div>
            <div style={{ padding: "16px 20px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: 1 }}>📡 RAGGIO DI RICERCA</div>
                <span style={{ fontSize: 12, color: "#A78BFA", fontWeight: 700 }}>{searchRadius >= 1000 ? `${searchRadius/1000}km` : `${searchRadius}m`}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[500,1000,2000,5000].map(r => (
                  <button key={r} onClick={() => setSearchRadius(r)} style={{ flex: 1, padding: "7px 0", borderRadius: 12, border: "1px solid", borderColor: searchRadius === r ? "#A78BFA" : "rgba(255,255,255,0.1)", background: searchRadius === r ? "rgba(167,139,250,0.2)" : "transparent", color: searchRadius === r ? "#A78BFA" : "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    {r >= 1000 ? `${r/1000}km` : `${r}m`}
                  </button>
                ))}
              </div>
            </div>

            {!loadingVenues && venues.filter(v => v.trending).length > 0 && (
              <div style={{ padding: "16px 20px 0" }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>🔥 IN TREND VICINO A TE</div>
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
                  {venues.filter(v => v.trending).slice(0, 5).map(v => (
                    <div key={v.id} onClick={() => openCheckin(v)} style={{ minWidth: 180, background: "linear-gradient(135deg,rgba(124,58,237,0.3),rgba(244,114,182,0.2))", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 18, padding: "14px 16px", cursor: "pointer" }}>
                      <div style={{ fontSize: 26, marginBottom: 4 }}>{v.emoji}</div>
                      <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>{v.zone} · {formatDist(v.distance)}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><CrowdBar value={v.crowd} color="#A78BFA" /><CrowdLabel value={v.crowd} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ padding: "12px 20px 0" }}>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                {types.map(t => (
                  <button key={t} onClick={() => setFilterType(t)} style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid", borderColor: filterType === t ? "#A78BFA" : "rgba(255,255,255,0.1)", background: filterType === t ? "rgba(167,139,250,0.2)" : "transparent", color: filterType === t ? "#A78BFA" : "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{t}</button>
                ))}
              </div>
            </div>

            <div style={{ padding: "14px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
              {loadingVenues && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)}
              {venueError && !loadingVenues && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.4)" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>😕</div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{venueError}</div>
                  <button onClick={() => userLocation && fetchVenues(userLocation.lat, userLocation.lng, searchRadius)} style={{ marginTop: 12, padding: "10px 24px", background: "rgba(167,139,250,0.2)", border: "1px solid #A78BFA", borderRadius: 12, color: "#A78BFA", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Riprova</button>
                </div>
              )}
              {!loadingVenues && !venueError && filtered.map(v => (
                <div key={v.id} onClick={() => openCheckin(v)} style={{ background: "rgba(255,255,255,0.04)", border: checkedIn === v.id ? "1px solid rgba(123,237,159,0.4)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: "16px 18px", cursor: "pointer", position: "relative", overflow: "hidden" }}>
                  {checkedIn === v.id && <div style={{ position: "absolute", top: 10, right: 12, background: "rgba(123,237,159,0.15)", border: "1px solid #7BED9F", borderRadius: 8, padding: "2px 8px", fontSize: 10, color: "#7BED9F", fontWeight: 700 }}>✓ CI SEI</div>}
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, flexShrink: 0, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>{v.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                          <div style={{ fontWeight: 800, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{v.type} · {v.zone}{v.distance != null ? <span style={{ color: "#A78BFA", marginLeft: 4 }}>· {formatDist(v.distance)}</span> : ""}</div>
                        </div>
                        <VibeScore value={v.vibe} />
                      </div>
                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div><div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>FOLLA</div><CrowdBar value={v.crowd} color="#F472B6" /></div>
                        <div style={{ textAlign: "right" }}><CrowdLabel value={v.crowd} /><div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{v.checkins} check-in</div></div>
                      </div>
                      {v.tags.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {v.tags.map(t => <span key={t} style={{ fontSize: 10, background: "rgba(255,255,255,0.07)", padding: "2px 8px", borderRadius: 6, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>#{t}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FEED */}
        {tab === "feed" && (
          <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>📡 AGGIORNAMENTI IN TEMPO REALE</div>
            {loadingFeed && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)}
            {!loadingFeed && feed.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "rgba(255,255,255,0.3)" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👀</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Nessun aggiornamento</div>
                <div style={{ fontSize: 13 }}>Fai un check-in per primo!</div>
              </div>
            )}
            {feed.map(post => (
              <div key={post.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: "16px 18px" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                  <Avatar profile={{ id: post.user_id, username: post.username, full_name: post.full_name }} size={42} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{post.full_name || post.username}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>è a <span style={{ color: "#A78BFA", fontWeight: 700 }}>{post.venue_emoji} {post.venue_name}</span> · {timeAgo(post.created_at)}</div>
                  </div>
                </div>
                {post.message && <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "10px 14px", fontSize: 14, marginBottom: 12, color: "rgba(255,255,255,0.85)", lineHeight: 1.4 }}>{post.message}</div>}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>FOLLA:</span>
                    <CrowdBar value={post.crowd} color="#F472B6" />
                    <CrowdLabel value={post.crowd} />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => toggleLike(post.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, opacity: likedPosts[post.id] ? 1 : 0.4, transition: "all 0.15s", transform: likedPosts[post.id] ? "scale(1.2)" : "scale(1)" }}>❤️</button>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{post.likes_count || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MAP */}
        {tab === "map" && (
          <div style={{ padding: "16px 20px 0" }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: 1, marginBottom: 12 }}>🗺️ LOCALI VICINO A TE</div>
            <MapboxMap venues={venues} userLocation={userLocation} onVenueClick={v => openCheckin(v)} />
            <div style={{ display: "flex", gap: 16, marginTop: 12, justifyContent: "center" }}>
              {[["#FF4757","Sold out"],["#FFA502","Animato"],["#7BED9F","Tranquillo"]].map(([c,l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {loadingVenues ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />) :
                venues.slice(0, 8).map(v => (
                  <div key={v.id} onClick={() => openCheckin(v)} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "12px 16px", cursor: "pointer" }}>
                    <span style={{ fontSize: 22 }}>{v.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{v.zone} · <span style={{ color: "#A78BFA" }}>{formatDist(v.distance)}</span></div>
                    </div>
                    <CrowdLabel value={v.crowd} />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* PROFILE */}
        {tab === "profile" && (
          <div style={{ padding: "16px 20px 0" }}>
            <div style={{ background: "linear-gradient(135deg,rgba(124,58,237,0.3),rgba(244,114,182,0.2))", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 24, padding: "24px 20px", textAlign: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><Avatar profile={profile} size={70} /></div>
              <div style={{ fontWeight: 800, fontSize: 20 }}>{profile?.full_name || profile?.username || "Utente"}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 14 }}>@{profile?.username} · {cityName}</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 30 }}>
                {[["—","Check-in"],[followers.length,"Follower"],[following.length,"Following"]].map(([n,l]) => (
                  <div key={l}><div style={{ fontWeight: 800, fontSize: 20 }}>{n}</div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{l}</div></div>
                ))}
              </div>
            </div>
            <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "14px", background: "rgba(255,71,87,0.15)", border: "1px solid rgba(255,71,87,0.3)", borderRadius: 16, color: "#FF4757", fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 16 }}>
              Esci dall'account
            </button>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>📍 LOCALI VICINO A TE</div>
            {loadingVenues ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />) :
              venues.slice(0, 5).map(v => (
                <div key={v.id} onClick={() => openCheckin(v)} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "12px 16px", marginBottom: 10, cursor: "pointer" }}>
                  <span style={{ fontSize: 22 }}>{v.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{v.zone} · {formatDist(v.distance)}</div>
                  </div>
                  <VibeScore value={v.vibe} />
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "10px 0 20px", zIndex: 200 }}>
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
          {[{key:"discover",icon:"🔍",label:"Scopri"},{key:"feed",icon:"📡",label:"Feed"},{key:"map",icon:"🗺️",label:"Mappa"},{key:"profile",icon:"👤",label:"Profilo"}].map(item => (
            <button key={item.key} onClick={() => setTab(item.key)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: "4px 16px", borderRadius: 12 }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: tab === item.key ? "#A78BFA" : "rgba(255,255,255,0.3)" }}>{item.label}</span>
              {tab === item.key && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#A78BFA" }} />}
            </button>
          ))}
        </div>
      </div>

      {/* Check-in Modal */}
      {showCheckin && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end" }} onClick={e => e.target === e.currentTarget && setShowCheckin(false)}>
          <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", background: "#13131A", borderRadius: "28px 28px 0 0", border: "1px solid rgba(255,255,255,0.1)", padding: "24px 24px 40px", animation: "slideUp 0.3s ease" }}>
            {checkinDone ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 60, marginBottom: 12 }}>🎉</div>
                <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 6 }}>Check-in fatto!</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>Tutti sanno che sei a <strong>{checkinVenue?.name}</strong></div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 20 }}>Check-in</div>
                    <div style={{ color: "#A78BFA", fontWeight: 700, fontSize: 15 }}>{checkinVenue?.emoji} {checkinVenue?.name}</div>
                    {checkinVenue?.address && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{checkinVenue.address}</div>}
                  </div>
                  <button onClick={() => setShowCheckin(false)} style={{ background: "rgba(255,255,255,0.07)", border: "none", borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 18 }}>×</button>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: 10 }}>COM'È LA FOLLA?</div>
                  <input type="range" min="0" max="100" value={crowdSlider} onChange={e => setCrowdSlider(+e.target.value)} style={{ width: "100%", accentColor: "#F472B6" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    <span>Vuoto</span><CrowdLabel value={crowdSlider} /><span>Sold out</span>
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: 10 }}>QUANTO CI SI DIVERTE?</div>
                  <input type="range" min="0" max="100" value={vibeSlider} onChange={e => setVibeSlider(+e.target.value)} style={{ width: "100%", accentColor: "#A78BFA" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                    <span>😐 Noioso</span><VibeScore value={vibeSlider} /><span>🤯 Pazzesco</span>
                  </div>
                </div>
                <div style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: 8 }}>LASCIA UN MESSAGGIO (opzionale)</div>
                  <textarea value={checkinMsg} onChange={e => setCheckinMsg(e.target.value)} placeholder="Come la stai passando? Dillo ai tuoi amici..." style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "12px 14px", color: "#fff", fontSize: 14, resize: "none", height: 80, boxSizing: "border-box", fontFamily: "inherit", outline: "none" }} />
                </div>
                <button onClick={submitCheckin} disabled={checkinLoading} style={{ width: "100%", padding: "16px", background: "linear-gradient(135deg,#7C3AED,#F472B6)", border: "none", borderRadius: 16, cursor: "pointer", color: "#fff", fontWeight: 800, fontSize: 16, boxShadow: "0 4px 20px rgba(124,58,237,0.4)", opacity: checkinLoading ? 0.7 : 1 }}>
                  {checkinLoading ? "Salvataggio..." : "📍 Fai Check-in"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        * { -webkit-tap-highlight-color:transparent; }
        ::-webkit-scrollbar { display:none; }
        input[type=range] { height:4px; border-radius:2px; }
        .mapboxgl-popup-content { background:transparent!important; padding:0!important; box-shadow:none!important; }
        .mapboxgl-popup-tip { display:none!important; }
        .mapboxgl-ctrl-attrib { display:none!important; }
      `}</style>
    </div>
  );
}
