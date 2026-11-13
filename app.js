/* The Collective · Sunday Team app
   One static page. Content lives in Supabase (one JSON document per area).
   On localhost with no config.js values it runs in preview mode from data/seed.json. */
(function () {
  'use strict';

  const CFG = window.COLLECTIVE_CONFIG || {};
  const live = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const sb = live ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

  const $ = (s, r) => (r || document).querySelector(s);
  const view = $('#view'), cover = $('#cover'), banner = $('#banner');
  const BASE = location.origin + location.pathname;

  const LS = {
    get(k, d) { try { const v = localStorage.getItem('tc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tc.' + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem('tc.' + k); } catch (e) {} }
  };

  /* ---------- text helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Stored text may contain only two bits of markup: <b>…</b> and <span class='k'>…</span>. Everything else is escaped.
  const rich = s => esc(s)
    .replace(/&lt;span class=(?:&#39;|&quot;)k(?:&#39;|&quot;)&gt;([\s\S]*?)&lt;\/span&gt;/g, '<span class="k">$1</span>')
    .replace(/&lt;(\/?)b&gt;/g, '<$1b>');
  // What editors type: [Button] and *bold*
  const toPlain = s => String(s || '').replace(/<span class=['"]k['"]>([\s\S]*?)<\/span>/g, '[$1]').replace(/<b>([\s\S]*?)<\/b>/g, '*$1*');
  const fromPlain = s => String(s || '').replace(/\[([^\[\]]+)\]/g, "<span class='k'>$1</span>").replace(/\*([^*]+)\*/g, '<b>$1</b>');
  const safeImg = u => /^(img\/[\w.\-]+|https:\/\/[^\s"'<>]+|data:image\/jpeg;base64,[A-Za-z0-9+\/=]+)$/.test(u || '') ? u : '';
  const rand = () => Math.random().toString(36).slice(2, 10);
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  /* ---------- state ---------- */
  const S = { areas: [], overseer: false, me: null, editing: false, keys: [] };
  const person = () => S.me && S.me.person;
  const canEdit = a => !!(person() && (person().is_admin || (person().areas || []).includes(a.id)));

  /* ---------- data layer ---------- */
  function must(r) { if (r.error) throw r.error; return r.data; }

  const liveApi = {
    async me() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const r = await sb.rpc('me');
      return { email: session.user.email, person: (r.data || [])[0] || null };
    },
    async areas(keys) {
      const out = new Map(); let overseer = false;
      if (keys.length) {
        const r = await sb.rpc('get_areas', { ks: keys });
        if (r.data) { overseer = !!r.data.overseer; (r.data.areas || []).forEach(a => out.set(a.id, a)); }
      }
      if (person()) { const r = await sb.from('areas').select('*'); (r.data || []).forEach(a => out.set(a.id, a)); }
      return { areas: [...out.values()].sort((x, y) => x.sort - y.sort), overseer };
    },
    async publicAreas() { return must(await sb.rpc('public_areas')) || []; },
    async saveArea(a) {
      const rows = must(await sb.from('areas').update({ content: a.content, needs_help: !!a.needs_help, help_note: a.help_note || '' }).eq('id', a.id).select('id'));
      if (!rows || !rows.length) throw new Error('You do not have edit rights for this area.');
    },
    async uploadShot(areaId, blob) {
      const path = areaId + '/' + Date.now() + '-' + rand() + '.jpg';
      must(await sb.storage.from('shots').upload(path, blob, { contentType: 'image/jpeg' }));
      return sb.storage.from('shots').getPublicUrl(path).data.publicUrl;
    },
    async signIn(email) { must(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: BASE } })); },
    async verify(email, token) { must(await sb.auth.verifyOtp({ email, token, type: 'email' })); },
    async signOut() { await sb.auth.signOut(); },
    async addSignup(s) { must(await sb.from('signups').insert(s)); },
    async signups() { return must(await sb.from('signups').select('*').order('created_at', { ascending: false })) || []; },
    async updateSignup(id, patch) { must(await sb.from('signups').update(patch).eq('id', id)); },
    async deleteSignup(id) { must(await sb.from('signups').delete().eq('id', id)); },
    async people() { return must(await sb.from('people').select('*').order('email')) || []; },
    async savePerson(p) { must(await sb.from('people').upsert(p, { onConflict: 'email' })); },
    async deletePerson(email) { must(await sb.from('people').delete().eq('email', email)); },
    async overseerKey() { const r = await sb.from('settings').select('value').eq('key', 'overseer_key').maybeSingle(); return r.data ? r.data.value : ''; }
  };

  // Preview: same interface, everything kept in this browser only.
  let seed = null;
  const pv = {
    areas() { return LS.get('pv.areas', null) || seed.areas.map((a, i) => Object.assign({ sort: i, access_key: 'demo-' + a.id }, a)); },
    put(list) { LS.set('pv.areas', list); }
  };
  const previewApi = {
    async me() { return LS.get('pv.in', false) ? { email: 'you@preview', person: { email: 'you@preview', name: 'Preview', is_admin: true, can_see_signups: true, areas: [] } } : null; },
    async areas(keys) {
      const all = pv.areas(), overseer = keys.includes('demo-all');
      return { areas: all.filter(a => person() || overseer || keys.includes(a.access_key)), overseer };
    },
    async publicAreas() { return pv.areas(); },
    async saveArea(a) { pv.put(pv.areas().map(x => x.id === a.id ? a : x)); },
    async uploadShot(areaId, blob) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); },
    async signIn() { LS.set('pv.in', true); },
    async verify() {},
    async signOut() { LS.del('pv.in'); },
    async addSignup(s) { const l = LS.get('pv.su', []); l.unshift(Object.assign({ id: rand(), created_at: new Date().toISOString(), status: 'new' }, s)); LS.set('pv.su', l); },
    async signups() { return LS.get('pv.su', []); },
    async updateSignup(id, patch) { LS.set('pv.su', LS.get('pv.su', []).map(s => s.id === id ? Object.assign(s, patch) : s)); },
    async deleteSignup(id) { LS.set('pv.su', LS.get('pv.su', []).filter(s => s.id !== id)); },
    async people() { return LS.get('pv.people', [{ email: 'you@preview', name: 'Preview', is_admin: true, can_see_signups: true, areas: [] }]); },
    async savePerson(p) { const l = (await this.people()).filter(x => x.email !== p.email); l.push(p); LS.set('pv.people', l); },
    async deletePerson(email) { LS.set('pv.people', (await this.people()).filter(x => x.email !== email)); },
    async overseerKey() { return 'demo-all'; }
  };
  const api = live ? liveApi : previewApi;

  async function refresh() {
    S.me = await api.me();
    const r = await api.areas(S.keys);
    S.areas = r.areas; S.overseer = r.overseer;
  }

  /* ---------- shared bits ---------- */
  function setCover(script, title, text) {
    cover.innerHTML = `<div class="wordmark">The<span class="slash">/</span>Collective<small>Church</small></div><div class="script">${esc(script)}</div><h1>${esc(title)}</h1><p>${esc(text)}</p>`;
    document.title = title + ' · The Collective';
  }
  function topnav() {
    const many = S.areas.length > 1 || S.me;
    return `<div class="topnav">${many ? '<a href="#/">‹ All areas</a>' : '<span></span>'}${person() ? '<a href="#/admin">Team space</a>' : ''}</div>`;
  }

  /* ---------- home ---------- */
  function renderHome() {
    if (S.areas.length === 1 && !S.me && !S.overseer) { location.replace('#/a/' + S.areas[0].id); return; }
    setCover('volunteer guide', 'Sunday Team', 'Everything you need for the area you are serving in, in one place.');
    let h = `<div class="home">`;
    if (S.areas.length) {
      h += `<p class="eyebrow" style="margin-top:0;background:var(--white);border-radius:14px;padding:14px 20px;box-shadow:0 6px 24px rgba(0,0,0,.08)">Where are you serving today?</p>`;
      h += S.areas.map(a => `<a class="areacard" href="#/a/${esc(a.id)}"><span><b>${esc(a.title)}</b><span class="d">${esc(a.blurb)}</span></span></a>`).join('');
    } else {
      h += `<div class="card"><h3>Serving this Sunday?</h3><p>Open the link your team lead sent you. It takes you straight to the checklist for your area.</p><p>Can't find it? Ask your team lead to send it again.</p></div>`;
    }
    h += `<div class="card"><h3>Want to join a team?</h3><p>See where help is needed and tell us where you'd like to serve.</p><a class="btn" href="#/signup">See the teams</a></div>`;
    if (person()) h += `<div class="card"><h3>Team space</h3><p>Links to share, sign-ups, and who can edit.</p><a class="btn ghost" href="#/admin">Open team space</a></div>`;
    h += `</div>`;
    view.innerHTML = h;
  }

  /* ---------- area view ---------- */
  function tools(kind, d) {
    return `<div class="tools" data-kind="${kind}" data-s="${d.s}" data-g="${d.g == null ? '' : d.g}" data-i="${d.i == null ? '' : d.i}"><button type="button" data-act="edit">Edit</button><button type="button" data-act="up" aria-label="Move up">↑</button><button type="button" data-act="down" aria-label="Move down">↓</button><button type="button" class="del" data-act="del">Delete</button></div>`;
  }
  const addBtn = (kind, label, d) => `<button type="button" class="addbtn" data-add="${kind}" data-s="${d.s == null ? '' : d.s}" data-g="${d.g == null ? '' : d.g}">+ ${label}</button>`;

  function shot(st) {
    const src = safeImg(st.img); if (!src) return '';
    const marks = (st.marks || []).map(m => m.box
      ? `<span class="mark box" style="left:${+m.x}%;top:${+m.y}%;width:${+m.w}%;height:${+m.h}%"></span>`
      : `<span class="mark" style="left:${+m.x}%;top:${+m.y}%">${m.n ? `<i>${esc(m.n)}</i>` : ''}</span>`).join('');
    return `<button type="button" class="shot" aria-label="Open picture full screen"><img src="${esc(src)}" alt="" loading="lazy">${marks}<span class="zoomhint">Tap to enlarge</span></button>`;
  }

  function renderArea(id) {
    const a = S.areas.find(x => x.id === id);
    if (!a) {
      setCover('volunteer guide', 'Sunday Team', '');
      view.innerHTML = topnav() + `<div class="card" style="margin-top:16px"><h3>This area isn't open on this phone</h3><p>Open the link your team lead sent you, or ask them to send it again.</p><a class="btn ghost" href="#/">Back</a></div>`;
      return;
    }
    const ed = S.editing && canEdit(a);
    const secs = (a.content && a.content.sections) || [];
    const ticks = LS.get('ticks.' + a.id + '.' + today(), []);
    setCover('volunteer guide', a.title, a.blurb || '');

    let h = topnav();
    if (ed) h += `<div class="banner">Editing. Changes save straight away and everyone with the link sees them.</div>`;
    h += `<nav class="toc" aria-label="Contents" style="margin-top:14px"><h2>Contents</h2><ol>${secs.map(s => `<li><a href="#" data-jump="sec-${esc(s.id)}">${esc(s.title)}</a></li>`).join('')}</ol><p class="printnote">Tap any picture to see it full screen and pinch to zoom. To print on A4, use your browser's Print option.</p></nav>`;

    secs.forEach((sec, si) => {
      h += `<section class="part" id="sec-${esc(sec.id)}"><p class="kicker">Part ${si + 1}</p><h2>${esc(sec.title)}</h2>`;
      if (ed) h += tools('section', { s: si });
      if (sec.intro) h += `<p class="intro"${ed ? ' style="margin-top:10px"' : ''}>${rich(sec.intro)}</p>`;

      if (sec.type === 'role') {
        h += `<div class="role">` + (sec.items || []).map((it, i) => `<div class="rolecard"><div class="ic">${i + 1}</div><div><b>${esc(it.title)}</b><p>${rich(it.text)}</p>${ed ? tools('card', { s: si, i }) : ''}</div></div>`).join('') + `</div>`;
        if (ed) h += `<div style="margin-top:12px">${addBtn('card', 'Add a note', { s: si })}</div>`;
      }
      if (sec.order) {
        h += `<div class="order"><h4>Running order</h4><ol>` + sec.order.map(o => `<li class="${o.tag ? 'tag' : ''}">${esc(o.t)}${o.tag ? `<span class="pill">${esc(o.tag)}</span>` : ''}</li>`).join('') + `</ol></div>`;
      }
      if (sec.groups) {
        let n = 0;
        sec.groups.forEach((grp, gi) => {
          h += `<h3 class="group" id="g-${esc(grp.id)}"><span class="l">${String.fromCharCode(65 + gi)}.</span>${esc(grp.title)}</h3>`;
          if (ed) h += `<div style="margin:-4px 0 12px">${tools('group', { s: si, g: gi })}</div>`;
          if (grp.tip) h += `<div class="tip">${rich(grp.tip)}${grp.swatches ? `<div class="swatches">${grp.swatches.map(s => `<span class="sw"><i style="background:${/^#[0-9a-f]{3,8}$/i.test(s[1]) ? s[1] : '#888'}"></i>${esc(s[0])}</span>`).join('')}</div>` : ''}</div>`;
          (grp.steps || []).forEach((st, i) => {
            n++;
            h += `<article class="step"><div class="txt"><div class="num">${n}</div><div><h4>${rich(st.h)}</h4>${st.p ? `<p>${rich(st.p)}</p>` : ''}${ed ? tools('step', { s: si, g: gi, i }) : ''}</div></div>${shot(st)}</article>`;
          });
          if (ed) h += addBtn('step', 'Add a step', { s: si, g: gi });
        });
        if (ed) h += addBtn('group', 'Add a heading', { s: si });
      }
      if (sec.type === 'placeholder') h += `<div class="placeholder">${esc(sec.text)}</div>`;
      if (sec.type === 'checklist') {
        const items = sec.items || [];
        const done = items.filter(i => ticks.includes(i.t)).length;
        if (!ed && items.length) h += `<div class="checkbar"><span>Tap each item as you go. <b data-count="${si}">${done} of ${items.length}</b> done.</span>${done ? `<button type="button" class="link" data-clear="${si}">Clear ticks</button>` : ''}</div>`;
        h += `<ul class="check">` + items.map((it, i) => `<li ${ed ? '' : `data-tick="${esc(it.t)}" role="checkbox" tabindex="0" aria-checked="${ticks.includes(it.t)}"`} class="${!ed && ticks.includes(it.t) ? 'done' : ''}"><b>${esc(it.t)}</b>${it.s ? `<small>${esc(it.s)}</small>` : ''}${ed ? tools('check', { s: si, i }) : ''}</li>`).join('') + `</ul>`;
        if (ed) h += `<div style="margin-top:12px">${addBtn('check', 'Add item', { s: si })}</div>`;
      }
      h += `</section>`;
    });
    if (ed) h += `<div style="margin-top:34px">${addBtn('section', 'Add a new part', {})}</div>`;
    if (!secs.length && !ed) h += `<div class="placeholder">Nothing written here yet.</div>`;
    if (canEdit(a)) h += `<button type="button" class="btn editfab noprint" data-editmode>${ed ? 'Done editing' : 'Edit this guide'}</button>`;
    view.innerHTML = h;
  }

  /* ---------- editing ---------- */
  const KINDS = {
    card: { label: 'note', fields: [{ n: 'title', l: 'Heading', req: 1 }, { n: 'text', l: 'Description', t: 'area', rich: 1 }] },
    step: { label: 'step', fields: [{ n: 'h', l: 'Instruction', t: 'area', rich: 1, req: 1 }, { n: 'p', l: 'Extra detail (optional)', t: 'area', rich: 1 }, { n: 'img', l: 'Picture (optional)', t: 'photo' }] },
    check: { label: 'checklist item', fields: [{ n: 't', l: 'Item', req: 1 }, { n: 's', l: 'Detail (optional)' }] },
    group: { label: 'heading', fields: [{ n: 'title', l: 'Heading', req: 1 }, { n: 'tip', l: 'Tip shown under the heading (optional)', t: 'area', rich: 1 }] },
    section: { label: 'part', fields: [{ n: 'title', l: 'Title', req: 1 }, { n: 'intro', l: 'Intro (optional)', t: 'area', rich: 1 }] }
  };

  function fieldHTML(f) {
    const id = 'f_' + f.n, v = f.v == null ? '' : f.v;
    if (f.t === 'area') return `<label for="${id}">${esc(f.l)}</label><textarea id="${id}" name="${f.n}" ${f.req ? 'required' : ''}>${esc(v)}</textarea>${f.rich ? '<p class="hint">Put button names in [square brackets] and *stars* around bold words.</p>' : ''}`;
    if (f.t === 'photo') return `<label for="${id}">${esc(f.l)}</label>${safeImg(v) ? `<img class="cur" src="${esc(safeImg(v))}" alt=""><label class="inline"><input type="checkbox" name="${f.n}__rm"> Remove this picture</label>` : ''}<input type="file" id="${id}" name="${f.n}" accept="image/*"><p class="hint">Take a photo or choose a screenshot from your phone.</p>`;
    if (f.t === 'select') return `<label for="${id}">${esc(f.l)}</label><select id="${id}" name="${f.n}">${f.opts.map(o => `<option value="${esc(o[0])}" ${o[0] === v ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    if (f.t === 'check') return `<label class="inline"><input type="checkbox" name="${f.n}" ${v ? 'checked' : ''}> <span>${esc(f.l)}</span></label>`;
    if (f.t === 'multi') return `<label>${esc(f.l)}</label>${f.opts.map(o => `<label class="inline"><input type="checkbox" name="${f.n}" value="${esc(o[0])}" ${(v || []).includes(o[0]) ? 'checked' : ''}> <span>${esc(o[1])}</span></label>`).join('')}`;
    return `<label for="${id}">${esc(f.l)}</label><input type="${f.t || 'text'}" id="${id}" name="${f.n}" value="${esc(v)}" ${f.req ? 'required' : ''} ${f.ro ? 'readonly' : ''}>${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}`;
  }

  function openForm(title, fields) {
    return new Promise(res => {
      const dlg = $('#dlg');
      dlg.innerHTML = `<form class="form" novalidate><h3>${esc(title)}</h3>${fields.map(fieldHTML).join('')}<div class="row"><button type="button" class="btn ghost" data-x>Cancel</button><button type="submit" class="btn">Save</button></div></form>`;
      const form = $('form', dlg);
      const done = v => { dlg.close(); dlg.innerHTML = ''; res(v); };
      $('[data-x]', dlg).onclick = () => done(null);
      dlg.oncancel = e => { e.preventDefault(); done(null); };
      form.onsubmit = e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const out = {};
        for (const f of fields) {
          const el = form.elements[f.n];
          if (f.t === 'photo') out[f.n] = { file: el.files[0] || null, remove: !!(form.elements[f.n + '__rm'] && form.elements[f.n + '__rm'].checked) };
          else if (f.t === 'check') out[f.n] = el.checked;
          else if (f.t === 'multi') out[f.n] = [...form.querySelectorAll(`input[name="${f.n}"]:checked`)].map(x => x.value);
          else out[f.n] = f.rich ? fromPlain(el.value.trim()) : el.value.trim();
        }
        done(out);
      };
      dlg.showModal();
    });
  }

  // Shrink a phone photo before upload (max 1600px wide, JPEG).
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error('Could not read that picture.')), 'image/jpeg', 0.82);
      };
      img.onerror = () => rej(new Error('Could not read that picture.'));
      img.src = url;
    });
  }

  async function itemForm(a, kind, item, isNew) {
    const def = KINDS[kind];
    const fields = def.fields.map(f => Object.assign({}, f, { v: f.rich ? toPlain(item[f.n]) : item[f.n] }));
    if (kind === 'section' && isNew) fields.push({ n: '_kind', l: 'What goes in it?', t: 'select', v: 'checklist', opts: [['checklist', 'A tick-off checklist'], ['steps', 'Steps, with pictures if you like'], ['cards', 'Short notes']] });
    const out = await openForm((isNew ? 'Add ' : 'Edit ') + def.label, fields);
    if (!out) return null;
    const patch = {};
    for (const f of fields) {
      if (f.t !== 'photo') { patch[f.n] = out[f.n]; continue; }
      if (out[f.n].file) { toast('Uploading picture…'); patch.img = await api.uploadShot(a.id, await shrink(out[f.n].file)); patch.marks = null; }
      else if (out[f.n].remove) { patch.img = null; patch.marks = null; }
    }
    return patch;
  }
  function applyPatch(item, patch) { for (const k in patch) { if (patch[k] == null || patch[k] === '') delete item[k]; else item[k] = patch[k]; } return item; }

  function listFor(a, kind, d) {
    const secs = a.content.sections;
    if (kind === 'section') return secs;
    const sec = secs[d.s];
    if (kind === 'group') return sec.groups;
    if (kind === 'step') return sec.groups[d.g].steps || (sec.groups[d.g].steps = []);
    return sec.items || (sec.items = []);
  }

  async function persist(a) {
    try { await api.saveArea(a); toast('Saved'); }
    catch (e) { toast('Not saved: ' + (e.message || e)); await refresh(); }
    route();
  }

  async function editAction(a, kind, d, action) {
    const list = listFor(a, kind, d);
    const i = kind === 'section' ? d.s : kind === 'group' ? d.g : d.i;
    if (action === 'up' || action === 'down') {
      const j = i + (action === 'up' ? -1 : 1);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    } else if (action === 'del') {
      if (!confirm('Delete this ' + KINDS[kind].label + '?' + (kind === 'section' || kind === 'group' ? ' Everything inside it goes too.' : ''))) return;
      list.splice(i, 1);
    } else {
      const patch = await itemForm(a, kind, list[i], false);
      if (!patch) return;
      applyPatch(list[i], patch);
    }
    await persist(a);
  }

  async function addAction(a, kind, d) {
    if (!a.content) a.content = { sections: [] };
    if (!a.content.sections) a.content.sections = [];
    const patch = await itemForm(a, kind, {}, true);
    if (!patch) return;
    let item = {};
    if (kind === 'section') {
      const k = patch._kind; delete patch._kind;
      item = { id: 's' + rand() };
      if (k === 'steps') item.groups = [{ id: 'g' + rand(), title: 'Steps', steps: [] }];
      else { item.type = k === 'cards' ? 'role' : 'checklist'; item.items = []; }
    }
    if (kind === 'group') item = { id: 'g' + rand(), steps: [] };
    applyPatch(item, patch);
    listFor(a, kind, d).push(item);
    await persist(a);
  }

  /* ---------- sign-up ---------- */
  async function renderSignup() {
    setCover('come and serve', 'Join a team', 'Sundays happen because lots of people each do a little. Here is where you could fit in.');
    view.innerHTML = topnav() + `<p style="text-align:center;color:var(--muted);margin-top:30px">Loading…</p>`;
    let areas;
    try { areas = await api.publicAreas(); } catch (e) { view.innerHTML = topnav() + `<div class="card" style="margin-top:16px"><p>Could not load the teams. Please try again in a moment.</p></div>`; return; }
    const opts = areas.map(a => `<label class="inline"><input type="checkbox" name="areas" value="${esc(a.id)}"> <span><b>${esc(a.title)}</b>${a.needs_help ? '<span class="pill">Helpers needed</span>' : ''}<br><span style="color:var(--muted);font-size:15px">${esc(a.help_note || a.blurb || '')}</span></span></label>`).join('');
    view.innerHTML = topnav() + `<form class="form card" id="suform" style="margin-top:16px">
      <h3>Where would you like to serve?</h3>
      <p>Tick anything that interests you. Ticking a box is not a commitment; it just starts a conversation.</p>
      ${opts}
      <label class="inline"><input type="checkbox" name="areas" value="anywhere"> <span><b>Wherever I'm needed</b></span></label>
      <label for="su_name">Your name</label><input type="text" id="su_name" name="name" required maxlength="80" autocomplete="name">
      <label for="su_contact">Phone number or email</label><input type="text" id="su_contact" name="contact" required maxlength="120">
      <label for="su_note">Anything you'd like us to know? (optional)</label><textarea id="su_note" name="note" maxlength="500"></textarea>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="hint">We only use this to get in touch about serving. Only the people organising the teams can see it.</p>
      <div class="row"><button type="submit" class="btn">Send</button></div>
    </form>`;
    $('#suform').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, picked = [...f.querySelectorAll('input[name="areas"]:checked')].map(x => x.value);
      if (!picked.length) { toast('Tick at least one team'); return; }
      if (f.website.value) return; // bots
      const btn = $('button[type=submit]', f); btn.disabled = true;
      try {
        await api.addSignup({ name: f.name.value.trim(), contact: f.contact.value.trim(), note: f.note.value.trim(), areas: picked });
        view.innerHTML = topnav() + `<div class="card" style="margin-top:16px"><h3>Thank you, ${esc(f.name.value.trim().split(' ')[0])}!</h3><p><b>What happens next:</b> someone from the team will get in touch with you to say hello and work out a Sunday that suits you.</p><p>You're also welcome to come and chat to us on a Sunday.</p></div>`;
        window.scrollTo(0, 0);
      } catch (err) { btn.disabled = false; toast('Sorry, that did not send. Please try again.'); }
    };
  }

  /* ---------- team space (links, sign-ups, people) ---------- */
  const linkRow = (label, url) => `<div><b>${esc(label)}</b><div class="linkrow"><input type="text" readonly value="${esc(url)}" aria-label="${esc(label)} link"><button type="button" class="btn small" data-copy="${esc(url)}">Copy</button></div></div>`;
  const contactLink = c => /@/.test(c) ? `<a href="mailto:${esc(c)}">${esc(c)}</a>` : /^[+\d][\d\s()-]{6,}$/.test(c) ? `<a href="tel:${esc(c.replace(/[^\d+]/g, ''))}">${esc(c)}</a>` : esc(c);
  let cache = { signups: [], people: [] };

  async function renderAdmin() {
    setCover('team leads', 'Team space', 'Links to share, sign-ups, and who can edit.');
    if (!S.me) {
      const sent = LS.get('otpEmail', '');
      view.innerHTML = topnav() + `<form class="form card" id="signin" style="margin-top:16px"><h3>Team lead sign in</h3><p>Enter your email and we'll send you a sign-in link. No password needed.</p><label for="si_email">Email</label><input type="email" id="si_email" name="email" required value="${esc(sent)}" autocomplete="email"><div class="row"><button type="submit" class="btn">Email me a link</button></div></form>` +
        (sent ? `<form class="form card" id="otp"><h3>Check your email</h3><p>Tap the link in the email we sent to <b>${esc(sent)}</b>. If the email shows a code instead, enter it here.</p><label for="si_code">Code</label><input type="text" id="si_code" name="code" inputmode="numeric" autocomplete="one-time-code" required><div class="row"><button type="submit" class="btn ghost">Sign in with code</button></div></form>` : '');
      $('#signin').onsubmit = async e => {
        e.preventDefault(); const email = e.target.email.value.trim().toLowerCase();
        try { await api.signIn(email); LS.set('otpEmail', email); LS.set('wantAdmin', true); if (!live) { await refresh(); } toast('Sent. Check your email.'); renderAdmin(); }
        catch (err) { toast(err.message || 'Could not send the email'); }
      };
      if ($('#otp')) $('#otp').onsubmit = async e => {
        e.preventDefault();
        try { await api.verify(sent, e.target.code.value.trim()); await refresh(); renderAdmin(); } catch (err) { toast('That code did not work'); }
      };
      return;
    }
    LS.del('otpEmail'); LS.del('wantAdmin');
    const p = person();
    const who = `<p class="tags" style="margin-top:14px">Signed in as <b>${esc(S.me.email)}</b> · <button type="button" class="link" data-signout>Sign out</button></p>`;
    if (!p) { view.innerHTML = topnav() + who + `<div class="card"><h3>Almost there</h3><p>That email isn't on the team list yet. Ask the Sunday overseer to add you, then reload this page.</p></div>`; return; }

    let h = topnav() + who;
    const mine = S.areas.filter(canEdit);

    h += `<section class="part" style="margin-top:20px"><h2>Links to share</h2><p class="intro">Each team gets its own link. It opens only that team's area, with no sign-in.</p><div class="card">`;
    if (p.is_admin) h += linkRow('Everything (overseer only)', BASE + '?k=' + await api.overseerKey());
    h += linkRow('Join a team (public sign-up)', BASE + '#/signup') + `</div>`;
    for (const a of mine) {
      h += `<div class="card"><h3>${esc(a.title)}</h3>${linkRow('Volunteer link', BASE + '?k=' + a.access_key)}
        <label class="form inline" style="display:flex;gap:10px;margin:10px 0"><input type="checkbox" data-help="${esc(a.id)}" ${a.needs_help ? 'checked' : ''} style="width:18px;height:18px;margin-top:5px;accent-color:var(--gold)"> <span>Show "Helpers needed" on the sign-up page</span></label>
        <div class="row"><a class="btn ghost small" href="#/a/${esc(a.id)}">Open</a><button type="button" class="btn ghost small" data-helpnote="${esc(a.id)}">Edit sign-up wording</button></div></div>`;
    }
    h += `</section>`;

    if (p.is_admin || p.can_see_signups) {
      let rows = [], names = {};
      try { rows = await api.signups(); (await api.publicAreas()).forEach(a => names[a.id] = a.title); } catch (e) {}
      names.anywhere = "Wherever I'm needed"; cache.signups = rows; cache.names = names;
      h += `<section class="part"><h2>Sign-ups</h2><p class="intro">${rows.length ? rows.filter(r => r.status === 'new').length + ' new, ' + rows.length + ' in total.' : 'Nobody has signed up yet.'}</p>`;
      if (rows.length) h += `<p><button type="button" class="btn ghost small" data-csv>Download as spreadsheet (CSV)</button></p>`;
      h += rows.map(r => `<div class="card su ${esc(r.status)}"><div class="row" style="justify-content:space-between"><b style="font-size:18px">${esc(r.name)}</b><select class="status" data-status="${esc(r.id)}" aria-label="Status">${['new', 'contacted', 'rostered'].map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <p style="margin:4px 0">${contactLink(r.contact)}</p><p class="tags" style="margin:0">${(r.areas || []).map(x => esc(names[x] || x)).join(' · ')}</p>${r.note ? `<p style="margin:6px 0 0;color:var(--ink)">“${esc(r.note)}”</p>` : ''}
        <p class="meta" style="margin:8px 0 0">${new Date(r.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · <button type="button" class="link" data-delsu="${esc(r.id)}">Delete</button></p></div>`).join('');
      h += `</section>`;
    }

    if (p.is_admin) {
      let ppl = []; try { ppl = await api.people(); } catch (e) {}
      cache.people = ppl;
      const titles = {}; S.areas.forEach(a => titles[a.id] = a.title);
      h += `<section class="part"><h2>Who can edit</h2><p class="intro">Add a team lead by email. They sign in with that email and can then edit their own area.</p>`;
      h += ppl.map(x => `<div class="card"><b>${esc(x.name || x.email)}</b><p style="margin:0">${esc(x.email)}</p><p class="tags" style="margin:4px 0 8px">${[x.is_admin ? 'Overseer: sees and edits everything' : '', !x.is_admin && x.can_see_signups ? 'Sees sign-ups' : '', !x.is_admin && (x.areas || []).length ? 'Edits ' + x.areas.map(i => titles[i] || i).join(', ') : ''].filter(Boolean).join(' · ') || 'No rights yet'}</p>
        <div class="row"><button type="button" class="btn ghost small" data-person="${esc(x.email)}">Change</button>${x.email !== p.email ? `<button type="button" class="link" data-delperson="${esc(x.email)}">Remove</button>` : ''}</div></div>`).join('');
      h += `<button type="button" class="addbtn" data-person="">+ Add a person</button></section>`;
    }
    view.innerHTML = h;
  }

  async function personForm(email) {
    const x = cache.people.find(q => q.email === email) || { areas: [] };
    const out = await openForm(email ? 'Change rights' : 'Add a person', [
      { n: 'name', l: 'Name', v: x.name, req: 1 },
      { n: 'email', l: 'Email', t: 'email', v: x.email, req: 1, ro: !!email, hint: email ? '' : 'They sign in with this exact email address.' },
      { n: 'areas', l: 'Can edit these areas', t: 'multi', v: x.areas, opts: S.areas.map(a => [a.id, a.title]) },
      { n: 'can_see_signups', l: 'Can see volunteer sign-ups (names and contact details)', t: 'check', v: x.can_see_signups },
      { n: 'is_admin', l: 'Overseer: sees and edits everything, and manages this list', t: 'check', v: x.is_admin }
    ]);
    if (!out) return;
    out.email = out.email.toLowerCase();
    if (email && email === person().email && !out.is_admin && !confirm('This removes your own overseer rights. Continue?')) return;
    try { await api.savePerson(out); toast('Saved'); } catch (e) { toast('Not saved: ' + (e.message || e)); }
    await refresh(); renderAdmin();
  }

  function downloadCsv() {
    const cell = v => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const lines = [['Date', 'Name', 'Contact', 'Areas', 'Note', 'Status']].concat(cache.signups.map(r => [r.created_at.slice(0, 10), r.name, r.contact, (r.areas || []).map(x => cache.names[x] || x).join('; '), r.note, r.status]));
    const blob = new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'volunteer-sign-ups.csv'; a.click();
  }

  /* ---------- events ---------- */
  const curArea = () => { const m = location.hash.match(/^#\/a\/([\w-]+)/); return m && S.areas.find(a => a.id === m[1]); };
  const num = v => v === '' || v == null ? null : +v;

  view.addEventListener('click', async e => {
    const t = e.target, q = sel => t.closest(sel);
    let el;
    if ((el = q('[data-jump]'))) { e.preventDefault(); const n = document.getElementById(el.dataset.jump); if (n) n.scrollIntoView(); return; }
    if ((el = q('[data-act]'))) { const box = el.closest('.tools'), a = curArea(); if (a) await editAction(a, box.dataset.kind, { s: num(box.dataset.s), g: num(box.dataset.g), i: num(box.dataset.i) }, el.dataset.act); return; }
    if ((el = q('[data-add]'))) { const a = curArea(); if (a) await addAction(a, el.dataset.add, { s: num(el.dataset.s), g: num(el.dataset.g) }); return; }
    if (q('[data-editmode]')) { S.editing = !S.editing; const y = window.scrollY; route(); window.scrollTo(0, y); return; }
    if ((el = q('[data-tick]'))) { tick(el); return; }
    if ((el = q('[data-clear]'))) { const a = curArea(); LS.del('ticks.' + a.id + '.' + today()); route(); return; }
    if ((el = q('.shot'))) { openShot(el); return; }
    if ((el = q('[data-copy]'))) { try { await navigator.clipboard.writeText(el.dataset.copy); toast('Link copied'); } catch (err) { el.previousElementSibling.select(); toast('Press and hold to copy'); } return; }
    if (q('[data-signout]')) { await api.signOut(); S.editing = false; await refresh(); route(); return; }
    if (q('[data-csv]')) { downloadCsv(); return; }
    if ((el = q('[data-delsu]'))) { if (confirm("Delete this sign-up and the person's contact details? This cannot be undone.")) { try { await api.deleteSignup(el.dataset.delsu); } catch (err) { toast('Could not delete'); } renderAdmin(); } return; }
    if ((el = q('[data-person]'))) { await personForm(el.dataset.person); return; }
    if ((el = q('[data-delperson]'))) { if (confirm('Remove ' + el.dataset.delperson + ' from the team list?')) { try { await api.deletePerson(el.dataset.delperson); } catch (err) { toast('Could not remove'); } renderAdmin(); } return; }
    if ((el = q('[data-helpnote]'))) {
      const a = S.areas.find(x => x.id === el.dataset.helpnote);
      const out = await openForm('Sign-up wording: ' + a.title, [{ n: 'help_note', l: 'What helping in this team involves', t: 'area', v: a.help_note || a.blurb }]);
      if (out) { a.help_note = out.help_note; try { await api.saveArea(a); toast('Saved'); } catch (err) { toast('Not saved'); } }
      return;
    }
  });
  view.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.help) { const a = S.areas.find(x => x.id === t.dataset.help); a.needs_help = t.checked; try { await api.saveArea(a); toast('Saved'); } catch (err) { toast('Not saved'); } }
    if (t.dataset.status) { try { await api.updateSignup(t.dataset.status, { status: t.value }); t.closest('.su').className = 'card su ' + t.value; toast('Saved'); } catch (err) { toast('Not saved'); } }
  });
  view.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.dataset && e.target.dataset.tick != null) { e.preventDefault(); tick(e.target); } });

  function tick(li) {
    const a = curArea(), key = 'ticks.' + a.id + '.' + today();
    let l = LS.get(key, []); const v = li.dataset.tick;
    l = l.includes(v) ? l.filter(x => x !== v) : l.concat(v);
    LS.set(key, l);
    const y = window.scrollY; route(); window.scrollTo(0, y);
  }

  /* ---------- lightbox ---------- */
  const lb = $('#lb'), frame = $('#lbframe');
  let z = 1;
  function setZ(v) { z = Math.min(4, Math.max(1, v)); frame.style.width = (z * 100) + '%'; frame.style.maxWidth = (z * 1600) + 'px'; }
  function openShot(b) {
    const clone = b.cloneNode(true); const hint = clone.querySelector('.zoomhint'); if (hint) hint.remove();
    clone.style.cursor = 'default';
    frame.innerHTML = ''; frame.appendChild(clone); setZ(1);
    lb.classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function closeShot() { lb.classList.remove('open'); document.body.style.overflow = ''; frame.innerHTML = ''; }
  lb.querySelector('.close').addEventListener('click', closeShot);
  lb.querySelectorAll('[data-z]').forEach(btn => btn.addEventListener('click', () => setZ(z + Number(btn.dataset.z))));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && lb.classList.contains('open')) closeShot(); });

  /* ---------- routing and start ---------- */
  function route() {
    const m = location.hash.match(/^#\/(a|signup|admin)(?:\/([\w-]+))?$/);
    if (!m) { if (S.me && LS.get('wantAdmin', false)) { location.replace('#/admin'); return; } renderHome(); }
    else if (m[1] === 'a') renderArea(m[2]);
    else if (m[1] === 'signup') renderSignup();
    else renderAdmin();
  }

  async function start() {
    const k = new URLSearchParams(location.search).get('k');
    S.keys = LS.get('keys', []);
    if (k && /^[\w-]{6,64}$/.test(k) && !S.keys.includes(k)) { S.keys = [k].concat(S.keys).slice(0, 10); LS.set('keys', S.keys); }

    if (!live) {
      if (!isLocal) { setCover('volunteer guide', 'Sunday Team', ''); view.innerHTML = `<div class="card" style="margin-top:20px"><h3>Nearly ready</h3><p>This page is still being set up. Please check back soon.</p></div>`; return; }
      seed = await (await fetch('data/seed.json')).json();
      banner.innerHTML = `<div class="banner noprint">Preview on this computer only. Nothing is saved online. Volunteer view: add <b>?k=demo-slides</b>; overseer: <b>?k=demo-all</b>.</div>`;
    }
    try { await refresh(); }
    catch (e) { view.innerHTML = `<div class="card" style="margin-top:20px"><p>Could not load. Check your connection and try again.</p></div>`; return; }

    window.addEventListener('hashchange', () => { S.editing = false; window.scrollTo(0, 0); route(); });
    route();
    if (live) sb.auth.onAuthStateChange((ev, session) => {
      const email = session && session.user ? session.user.email : null;
      if (email === (S.me ? S.me.email : null)) return;
      setTimeout(async () => { await refresh(); route(); }, 0);
    });
  }
  start();
})();
