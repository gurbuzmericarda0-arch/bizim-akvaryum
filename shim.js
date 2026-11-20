// Stand-in for the Claude page runtime: db, room and user backed by Firebase Realtime Database.
(() => {
  const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
  const ls = { get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }, set(k, v){ try { localStorage.setItem(k, v); } catch(e){} } };
  const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  let myId = ls.get("aq-id"); if (!myId){ myId = "u_" + rid(); ls.set("aq-id", myId); }
  const myPeer = "p_" + rid();
  let ready = null;
  function boot(){
    if (ready) return ready;
    ready = (async () => {
      if (!window.AQ_FIREBASE) return null;
      try {
        const app = await import(FB + "firebase-app.js"), dbm = await import(FB + "firebase-database.js");
        const fa = app.initializeApp(window.AQ_FIREBASE), db = dbm.getDatabase(fa);
        let offset = 0; dbm.onValue(dbm.ref(db, ".info/serverTimeOffset"), s => { offset = s.val() || 0; });
        return { dbm, db, base: "aq/" + (window.AQ_ROOM || "default"), now: () => Date.now() + offset };
      } catch (e) { console.warn("Firebase yüklenemedi", e); return null; }
    })();
    return ready;
  }
  function askName(){
    return new Promise(res => {
      const saved = ls.get("aq-name"); if (saved) return res(saved);
      const wrap = document.createElement("div"); wrap.className = "reveal";
      wrap.innerHTML = '<div class="box"><h2>Hoş geldin</h2><p class="note">Akvaryumda adın böyle görünecek.</p><input type="text" id="aqName" maxlength="20" placeholder="Adın" style="width:100%;box-sizing:border-box"><button class="primary" id="aqNameOk">Akvaryuma gir</button></div>';
      document.body.appendChild(wrap);
      const go = () => { const v = document.getElementById("aqName").value.trim().slice(0, 20); if (!v) return; ls.set("aq-name", v); wrap.remove(); res(v); };
      document.getElementById("aqNameOk").onclick = go; document.getElementById("aqName").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      setTimeout(() => document.getElementById("aqName").focus(), 50);
    });
  }
  const makeDb = F => {
    const { dbm, db, base } = F, R = p => dbm.ref(db, base + "/" + p);
    const docSnap = s => ({ id: s.key, exists: s.exists(), data: () => s.val() ?? undefined });
    function doc(path){ const r = R(path); return { id: path.split("/").pop(), path,
      get: async () => docSnap(await dbm.get(r)), set: o => dbm.set(r, o), update: o => dbm.update(r, o), delete: () => dbm.remove(r),
      onSnapshot(cb, err){ return dbm.onValue(r, s => cb(docSnap(s)), e => err && err({ code: "unavailable", message: String(e) })); } }; }
    function collection(path, opts = {}){ const r = R(path);
      const q = () => opts.field ? dbm.query(r, dbm.orderByChild(opts.field), ...(opts.n ? [opts.desc ? dbm.limitToLast(opts.n) : dbm.limitToFirst(opts.n)] : [])) : r;
      return { path,
        add: async o => { const k = dbm.push(r); await dbm.set(k, o); return doc(path + "/" + k.key); },
        doc: id => doc(path + "/" + (id || dbm.push(r).key)),
        orderBy: (field, dir) => collection(path, { ...opts, field, desc: dir === "desc" }),
        limit: n => collection(path, { ...opts, n }),
        onSnapshot(cb, err){ return dbm.onValue(q(), s => { const docs = []; s.forEach(c => { docs.push(docSnap(c)); }); if (opts.desc) docs.reverse(); cb({ docs, size: docs.length, empty: !docs.length }); }, e => err && err({ code: "unavailable", message: String(e) })); } }; }
    return { doc, collection };
  };
  const makeRoom = F => {
    const { dbm, db, base, now } = F, evRef = dbm.ref(db, base + "/ev"), prRef = dbm.ref(db, base + "/pr"), meRef = dbm.ref(db, base + "/pr/" + myPeer);
    const handlers = {}, peerFns = []; let peerList = [];
    const start = now() - 1500;
    dbm.onChildAdded(dbm.query(evRef, dbm.orderByChild("ts"), dbm.startAt(start)), s => {
      const v = s.val(); if (!v || v.peer === myPeer) return;
      for (const fn of handlers[v.topic] || []) try { fn({ topic: v.topic, data: v.data, by: v.by, peer: v.peer, isMe: v.by === myId, sameTab: false, kind: "viewer", guest: false }); } catch(e){}
    });
    // tidy old moments so the list stays tiny
    setInterval(async () => { try { const old = await dbm.get(dbm.query(evRef, dbm.orderByChild("ts"), dbm.endAt(now() - 60000))); old.forEach(c => { dbm.remove(c.ref); }); } catch(e){} }, 30000);
    dbm.onDisconnect(meRef).remove(); dbm.set(meRef, { by: myId, at: now() });
    dbm.onValue(prRef, s => { const list = []; s.forEach(c => { const v = c.val() || {}; list.push({ peer: c.key, by: v.by || null, isMe: v.by === myId, sameTab: c.key === myPeer, kind: "viewer", guest: false, presence: v, updatedAt: v.at || 0 }); });
      peerList = list; for (const fn of peerFns) try { fn({ peers: list, joined: [], left: [], updated: [] }); } catch(e){} });
    return {
      emit(topic, data){ for (const fn of handlers[topic] || []) try { fn({ topic, data, by: myId, peer: myPeer, isMe: true, sameTab: true, kind: "viewer", guest: false }); } catch(e){}
        return dbm.push(evRef, { topic, data: data ?? null, by: myId, peer: myPeer, ts: dbm.serverTimestamp() }).then(() => {}); },
      on(topic, fn){ (handlers[topic] ||= []).push(fn); return () => { handlers[topic] = handlers[topic].filter(f => f !== fn); }; },
      presence(patch){ const clean = {}; for (const k in patch) clean[k] = patch[k] === undefined ? null : patch[k]; return dbm.update(meRef, { ...clean, by: myId, at: now() }); },
      peers: () => peerList,
      onPeers(fn){ peerFns.push(fn); fn({ peers: peerList, joined: [], left: [], updated: [] }); return () => {}; },
      connected: () => true, onConnection(fn){ fn(true); return () => {}; },
    };
  };
  const makeUser = async F => {
    const { dbm, db, base } = F, name = await askName();
    dbm.set(dbm.ref(db, base + "/users/" + myId), { name });
    let owner = null;
    try { const r = await dbm.runTransaction(dbm.ref(db, base + "/meta/owner"), cur => cur || myId); owner = r.snapshot.val(); } catch(e){}
    const cache = {};
    return {
      id: async () => myId, isOwner: async () => owner === myId, canEdit: async () => owner === myId, can: async () => true,
      me: async () => ({ id: myId, name, avatarUrl: "", color: "#ff7a6b", email: null }),
      profiles: async ids => { const out = {}; for (const id of [].concat(ids)){ if (!(id in cache)){ try { const s = await dbm.get(dbm.ref(db, base + "/users/" + id + "/name")); cache[id] = s.val() || ""; } catch(e){ cache[id] = ""; } }
        out[id] = { id, name: cache[id], avatarUrl: "", color: "#ff7a6b", email: null, isMe: id === myId, guest: false }; } return out; },
    };
  };
  let userP = null;
  window.claude = { use: async name => {
    const F = await boot(); if (!F) return null;
    if (name === "db") return makeDb(F);
    if (name === "room") return (window.__aqRoom ||= makeRoom(F));
    if (name === "user") return (userP ||= makeUser(F));
    return null;
  } };
  // first run of a fresh shared tank: copy in the fish and the surprise message
  window.AQ_SEED = async () => {
    const F = await boot(); if (!F) return;
    const { dbm, db, base } = F, flag = dbm.ref(db, base + "/meta/seeded");
    try { const r = await dbm.runTransaction(flag, cur => cur ? undefined : true); if (!r.committed) return;
      const seed = await fetch("seed.json").then(r => r.json()); const t = Date.now();
      for (const [id, f] of Object.entries(seed.fish)) await dbm.set(dbm.ref(db, base + "/fish/" + id), { ...f, fedAt: t, lastPet: 0 });
      await dbm.set(dbm.ref(db, base + "/tank/main"), { ...seed.tank.main, lastCleaned: t, plantedAt: t, heatAt: t, fertAt: 0 });
      await dbm.set(dbm.ref(db, base + "/surprise/main"), seed.surprise.main);
    } catch(e){ console.warn("seed", e); }
  };
})();
